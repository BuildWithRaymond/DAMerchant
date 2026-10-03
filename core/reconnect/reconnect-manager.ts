import { EventEmitter } from 'events';
import { ConnectionPhase } from '../proxy/connection-state';
import { ServerOpCode } from '../network/packets/op-codes';
import { BinaryReader } from '../network/serialization/binary-reader';

export interface ReconnectEntry {
  characterName: string;
  username: string;
  password: string;
  attempt: number;
  state: 'queued' | 'waiting' | 'launching' | 'connected' | 'cancelled';
  nextAttemptAt: number;
}
export interface ReconnectStatusEvent {
  characterName: string;
  attempt: number;
  state: ReconnectEntry['state'] | 'failed';
  delay: number;
}
export interface ReconnectAttempt {
  characterName: string;
  attempt: number;
  signal: AbortSignal;
  processId?: number;
}
interface LoginConnection {
  connectionState: { phase: ConnectionPhase; username: string };
  once(event: 'disposed', listener: () => void): unknown;
  dispose(): void;
}
type LaunchFn = (username: string, password: string, attempt: ReconnectAttempt) => Promise<{
  success: boolean; processId?: number; error?: string;
}>;
interface ActiveAttempt {
  entry: ReconnectEntry;
  context: ReconnectAttempt;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  connections: Set<LoginConnection>;
  connected: boolean;
}
const BACKOFF_DELAYS = [5_000, 15_000, 30_000];
const ATTEMPT_TIMEOUT = 90_000;
const CHAOS_RESET_WAIT = 300_000;

/** One owner for each launch/login, with bounded attempts and fair retries. */
export class ReconnectManager extends EventEmitter {
  private entries = new Map<string, ReconnectEntry>();
  private queue: string[] = [];
  private active: ActiveAttempt | null = null;
  private queueTimer?: ReturnType<typeof setTimeout>;
  private resetNotBefore = 0;
  private stopping = false;
  private loginConnections = new WeakSet<LoginConnection>();

  constructor(private launchFn: LaunchFn, private closeProcess: (processId: number) => void = () => {}) {
    super();
  }

  scheduleReconnect(characterName: string, username: string, password: string): void {
    if (this.entries.has(characterName)) return;
    this.entries.set(characterName, { characterName, username, password, attempt: 0, state: 'queued', nextAttemptAt: 0 });
    this.queue.push(characterName);
    this.emitStatus(characterName, 'queued');
    this.processQueue();
  }

  /** Repeated broadcasts from the same reset must not prolong its cooldown. */
  notifyServerReset(): void {
    if (this.resetNotBefore > Date.now()) return;
    this.resetNotBefore = Date.now() + CHAOS_RESET_WAIT;
    console.log('[Reconnect] Chaos reset detected; waiting five minutes before login');
    if (this.active?.entry.state === 'launching') this.scheduleRetry(this.active.entry.characterName);
    else if (this.active) this.waitForLaunch(this.active);
  }

  observeServerPacket(opCode: number, data: Uint8Array): boolean {
    if (opCode !== ServerOpCode.ServerMessage) return false;
    try {
      const reader = new BinaryReader(data);
      reader.readUint8(); // world-message display type
      if (!reader.readString16().startsWith('Chaos is rising')) return false;
      this.notifyServerReset();
      return true;
    } catch { return false; }
  }

  cancelReconnect(characterName: string): void {
    const entry = this.entries.get(characterName);
    if (!entry) return;
    entry.state = 'cancelled';
    this.emitStatus(characterName, 'cancelled');
    this.entries.delete(characterName);
    this.queue = this.queue.filter(name => name !== characterName);
    if (this.active?.entry === entry) this.releaseAttempt(true);
    this.processQueue();
  }

  cancelAll(): void {
    this.stopping = true;
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = undefined;
    for (const name of [...this.entries.keys()]) this.cancelReconnect(name);
    this.queue = [];
    this.stopping = false;
  }

  onCharacterConnected(characterName: string): void {
    const entry = this.entries.get(characterName);
    if (!entry) return;
    entry.state = 'connected';
    this.emitStatus(characterName, 'connected');
    this.entries.delete(characterName);
    this.queue = this.queue.filter(name => name !== characterName);
    if (this.active?.entry === entry) {
      this.active.connected = true;
      this.releaseAttempt(false);
      // Avoid overlapping the final login packets with the next client launch.
      this.queueTimer = setTimeout(() => { this.queueTimer = undefined; this.processQueue(); }, 5000);
      this.queueTimer.unref?.();
    }
  }

  isReconnecting(characterName?: string): boolean {
    return characterName ? this.entries.has(characterName) : this.entries.size > 0;
  }

  getReconnectingCredentials(characterName: string): { username: string; password: string } | null {
    const entry = this.entries.get(characterName);
    return entry ? { username: entry.username, password: entry.password } : null;
  }

  getCurrentlyLaunching(): string | null { return this.getCurrentAttempt()?.characterName ?? null; }

  getCurrentAttempt(): ReconnectAttempt | null {
    return this.active?.entry.state === 'launching' ? this.active.context : null;
  }

  getState(): ReconnectStatusEvent[] {
    return [...this.entries.values()].map(entry => ({
      characterName: entry.characterName, attempt: entry.attempt, state: entry.state,
      delay: entry.state === 'waiting' ? Math.max(0, entry.nextAttemptAt - Date.now()) : 0,
    }));
  }

  /** Bind delayed login to this attempt and transport, rather than a global timer. */
  loginWhenReady(connection: LoginConnection, screensReady: Promise<unknown>, sendLogin: (username: string, password: string) => void): void {
    const active = this.active;
    if (!active || active.entry.state !== 'launching' || this.loginConnections.has(connection)) return;
    const capturedUser = connection.connectionState.username;
    if (capturedUser && capturedUser.toLowerCase() !== active.entry.username.toLowerCase()) return;
    this.loginConnections.add(connection);
    active.connections.add(connection);
    connection.once('disposed', () => {
      active.connections.delete(connection);
      if (this.isCurrent(active) && connection.connectionState.phase !== ConnectionPhase.REDIRECTING)
        this.scheduleRetry(active.entry.characterName);
    });
    screensReady.then(() => {
      if (!this.isCurrent(active) || active.controller.signal.aborted || !active.connections.has(connection) ||
          connection.connectionState.phase === ConnectionPhase.IN_GAME || connection.connectionState.phase === ConnectionPhase.REDIRECTING) return;
      sendLogin(active.entry.username, active.entry.password);
    }).catch(() => { if (this.isCurrent(active)) this.scheduleRetry(active.entry.characterName); });
  }

  scheduleRetry(characterName: string): void {
    const active = this.active;
    if (!active || active.entry.characterName !== characterName || active.entry.state !== 'launching') return;
    this.emitStatus(characterName, 'failed');
    active.entry.state = 'queued';
    this.releaseAttempt(true);
    this.queue.push(characterName);
    this.emitStatus(characterName, 'queued');
    this.processQueue();
  }

  private processQueue(): void {
    if (this.stopping || this.active || this.queueTimer) return;
    while (this.queue.length) {
      const entry = this.entries.get(this.queue.shift()!);
      if (!entry || entry.state !== 'queued') continue;
      entry.attempt++;
      entry.nextAttemptAt = Date.now() + BACKOFF_DELAYS[Math.min(entry.attempt - 1, BACKOFF_DELAYS.length - 1)];
      const controller = new AbortController();
      this.active = { entry, controller, connections: new Set(), connected: false,
        context: { characterName: entry.characterName, attempt: entry.attempt, signal: controller.signal } };
      this.waitForLaunch(this.active);
      return;
    }
  }

  private waitForLaunch(active: ActiveAttempt): void {
    if (active.timer) clearTimeout(active.timer);
    active.entry.state = 'waiting';
    active.entry.nextAttemptAt = Math.max(active.entry.nextAttemptAt, this.resetNotBefore);
    const delay = Math.max(0, active.entry.nextAttemptAt - Date.now());
    this.emitStatus(active.entry.characterName, 'waiting', delay);
    active.timer = setTimeout(() => void this.launch(active), delay);
    active.timer.unref?.();
  }

  private async launch(active: ActiveAttempt): Promise<void> {
    if (!this.isCurrent(active)) return;
    active.entry.state = 'launching';
    this.emitStatus(active.entry.characterName, 'launching');
    // CreateProcess can succeed even when login fails before any character context exists.
    active.timer = setTimeout(() => {
      if (this.isCurrent(active)) {
        console.warn('[Reconnect] Login timed out for ' + active.entry.characterName);
        this.scheduleRetry(active.entry.characterName);
      }
    }, ATTEMPT_TIMEOUT);
    active.timer.unref?.();
    try {
      const result = await this.launchFn(active.entry.username, active.entry.password, active.context);
      if (!this.isCurrent(active)) {
        if (result.processId !== undefined && !active.connected) this.closeOwnedProcess(result.processId);
        return;
      }
      active.context.processId = result.processId;
      if (!result.success) {
        console.warn('[Reconnect] Launch failed for ' + active.entry.characterName + ': ' + (result.error ?? 'unknown error'));
        this.scheduleRetry(active.entry.characterName);
      }
    } catch (error) {
      if (this.isCurrent(active)) {
        console.warn('[Reconnect] Launch failed for ' + active.entry.characterName + ': ' + (error instanceof Error ? error.message : 'unknown error'));
        this.scheduleRetry(active.entry.characterName);
      }
    }
  }

  private isCurrent(active: ActiveAttempt): boolean {
    return this.active === active && this.entries.get(active.entry.characterName) === active.entry;
  }

  private releaseAttempt(close: boolean): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    if (active.timer) clearTimeout(active.timer);
    active.controller.abort();
    if (close) {
      for (const connection of active.connections) {
        try { connection.dispose(); } catch { /* continue closing the owned process */ }
      }
      if (active.context.processId !== undefined) this.closeOwnedProcess(active.context.processId);
    }
  }

  private closeOwnedProcess(processId: number): void {
    try { this.closeProcess(processId); }
    catch (error) { console.error('[Reconnect] Failed to close owned client PID ' + processId + ':', error); }
  }

  private emitStatus(characterName: string, state: ReconnectStatusEvent['state'], delay = 0): void {
    this.emit('status', { characterName, attempt: this.entries.get(characterName)?.attempt ?? 0, state, delay } satisfies ReconnectStatusEvent);
  }
}
