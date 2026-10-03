import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ReconnectManager } from '../core/reconnect/reconnect-manager';
import { ConnectionPhase } from '../core/proxy/connection-state';
import { ServerOpCode } from '../core/network/packets/op-codes';
import { BinaryWriter } from '../core/network/serialization/binary-writer';

async function settle() {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

test('a successful reconnect releases the launch queue for every remaining character', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const launched: string[] = [];
  const manager = new ReconnectManager(async username => {
    launched.push(username);
    return { success: true, processId: launched.length };
  });
  t.after(() => manager.cancelAll());
  for (const name of ['borimseller', 'missivesell', 'eggsell', 'veltsell', 'pantic asell']) {
    manager.scheduleReconnect(name, name, 'test-password');
  }
  for (const name of ['borimseller', 'missivesell', 'eggsell', 'veltsell', 'pantic asell']) {
    t.mock.timers.tick(5000);
    await settle();
    t.mock.timers.tick(5000);
    await settle();
    assert.equal(manager.getCurrentlyLaunching(), name);
    manager.onCharacterConnected(name);
  }
  assert.equal(launched.length, 5);
  assert.equal(manager.isReconnecting(), false);
});

test('a launch that never reaches a character context times out and lets the next character try', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const launched: string[] = [];
  const manager = new ReconnectManager(async username => {
    launched.push(username);
    return { success: true, processId: launched.length };
  });
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('stalled', 'stalled', 'test-password');
  manager.scheduleReconnect('next', 'next', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(launched, ['stalled']);
  t.mock.timers.tick(90_000);
  await settle();
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(launched, ['stalled', 'next']);
  assert.equal(manager.getCurrentlyLaunching(), 'next');
});

test('canceling the current reconnect unblocks the rest of the queue', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const launched: string[] = [];
  const manager = new ReconnectManager(async username => {
    launched.push(username);
    return { success: true, processId: launched.length };
  });
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('cancelled', 'cancelled', 'test-password');
  manager.scheduleReconnect('next', 'next', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  manager.cancelReconnect('cancelled');
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(launched, ['cancelled', 'next']);
});

test('failed launches rotate through the queue and duplicate retry notifications do not overlap', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const launched: string[] = [];
  const manager = new ReconnectManager(async username => {
    launched.push(username);
    return { success: username !== 'offline', processId: launched.length };
  });
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('offline', 'offline', 'test-password');
  manager.scheduleReconnect('other', 'other', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  manager.scheduleRetry('offline');
  manager.scheduleRetry('offline');
  t.mock.timers.tick(5000);
  await settle();
  assert.deepEqual(launched, ['offline', 'other']);
  assert.equal(manager.getCurrentlyLaunching(), 'other');
});

test('timed-out and cancelled attempts close only their own process; successful clients stay open', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const closed: number[] = [];
  let pid = 10;
  const manager = new ReconnectManager(async () => ({ success: true, processId: pid++ }), processId => closed.push(processId));
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('first', 'first', 'test-password');
  manager.scheduleReconnect('second', 'second', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  t.mock.timers.tick(90_000);
  await settle();
  assert.deepEqual(closed, [10]);
  t.mock.timers.tick(5000);
  await settle();
  manager.onCharacterConnected('second');
  manager.cancelAll();
  assert.deepEqual(closed, [10]);
});

test('cancel all aborts pending work and a late launch result cannot resurrect the old attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let finish!: (result: { success: boolean; processId: number }) => void;
  let attemptSignal: AbortSignal | undefined;
  const closed: number[] = [];
  let calls = 0;
  const manager = new ReconnectManager(async (_username, _password, attempt) => {
    calls++;
    attemptSignal = attempt?.signal;
    return new Promise(resolve => { finish = resolve; });
  }, processId => closed.push(processId));
  manager.scheduleReconnect('first', 'first', 'test-password');
  manager.scheduleReconnect('second', 'second', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  assert.ok(attemptSignal);
  manager.cancelAll();
  assert.equal(attemptSignal.aborted, true);
  finish({ success: true, processId: 42 });
  await settle();
  t.mock.timers.tick(300_000);
  await settle();
  assert.deepEqual(closed, [42]);
  assert.equal(calls, 1);
  assert.deepEqual(manager.getState(), []);
});

test('Chaos reset waits five minutes and repeated notices do not extend the same reset', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let launches = 0;
  const manager = new ReconnectManager(async () => { launches++; return { success: true }; });
  t.after(() => manager.cancelAll());
  assert.equal(typeof manager.notifyServerReset, 'function');
  manager.notifyServerReset();
  manager.scheduleReconnect('first', 'first', 'test-password');
  t.mock.timers.tick(60_000);
  manager.notifyServerReset();
  t.mock.timers.tick(239_999);
  await settle();
  assert.equal(launches, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(launches, 1);
});

class LoginConnection extends EventEmitter {
  connectionState = { phase: ConnectionPhase.AUTHENTICATED, username: '', characterName: 'first' };
  disposed = false;
  dispose() { this.disposed = true; this.emit('disposed'); }
}

test('login waits for screen readiness, sends once, and canceled callbacks cannot send credentials', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const manager = new ReconnectManager(async () => ({ success: true, processId: 10 }));
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('first', 'first', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(typeof manager.loginWhenReady, 'function');
  let ready!: () => void;
  const screens = new Promise<void>(resolve => { ready = resolve; });
  const connection = new LoginConnection();
  const logins: string[] = [];
  manager.loginWhenReady(connection, screens, username => logins.push(username));
  manager.loginWhenReady(connection, screens, username => logins.push(username));
  await settle();
  assert.deepEqual(logins, []);
  ready();
  await settle();
  assert.deepEqual(logins, ['first']);

  manager.scheduleRetry('first');
  t.mock.timers.tick(15_000);
  await settle();
  const stale = new LoginConnection();
  let staleReady!: () => void;
  manager.loginWhenReady(stale, new Promise<void>(resolve => { staleReady = resolve; }), () => logins.push('stale'));
  manager.cancelAll();
  staleReady();
  await settle();
  assert.deepEqual(logins, ['first']);
  assert.equal(stale.disposed, true);
});

test('a pre-game socket failure retries, but normal login redirects do not', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const manager = new ReconnectManager(async () => ({ success: true }));
  t.after(() => manager.cancelAll());
  assert.equal(typeof manager.loginWhenReady, 'function');
  manager.scheduleReconnect('first', 'first', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  const redirect = new LoginConnection();
  manager.loginWhenReady(redirect, Promise.resolve(), () => {});
  redirect.connectionState.phase = ConnectionPhase.REDIRECTING;
  redirect.dispose();
  assert.equal(manager.getCurrentlyLaunching(), 'first');
  const failed = new LoginConnection();
  manager.loginWhenReady(failed, new Promise(() => {}), () => {});
  failed.dispose();
  assert.equal(manager.getCurrentlyLaunching(), null);
  assert.equal(manager.getState()[0].attempt, 2);
});

test('only the server Chaos announcement sets the cooldown, with safe malformed-packet handling', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const manager = new ReconnectManager(async () => ({ success: true }));
  t.after(() => manager.cancelAll());
  assert.equal(typeof manager.observeServerPacket, 'function');
  const packet = (message: string, type = 3) => {
    const writer = new BinaryWriter();
    writer.writeUint8(type); writer.writeString16(message);
    return writer.toArray();
  };
  assert.equal(manager.observeServerPacket(ServerOpCode.ChatMessage, packet('Chaos is rising')), false);
  assert.equal(manager.observeServerPacket(ServerOpCode.ServerMessage, packet('Buyer" Chaos is rising', 0)), false);
  assert.equal(manager.observeServerPacket(ServerOpCode.ServerMessage, Uint8Array.of(3, 255)), false);
  assert.equal(manager.observeServerPacket(ServerOpCode.ServerMessage, packet('Chaos is rising. Server shutting down.')), true);
  manager.scheduleReconnect('first', 'first', 'test-password');
  assert.equal(manager.getState()[0].delay, 300_000);
});

test('a late result from a timed-out launch is closed even after its newer retry connects', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let finish!: (result: { success: boolean; processId: number }) => void;
  const closed: number[] = [];
  let count = 0;
  const manager = new ReconnectManager(async () => {
    if (++count === 1) return new Promise(resolve => { finish = resolve; });
    return { success: true, processId: 2 };
  }, pid => closed.push(pid));
  t.after(() => manager.cancelAll());
  manager.scheduleReconnect('first', 'first', 'test-password');
  t.mock.timers.tick(5000);
  await settle();
  t.mock.timers.tick(90_000);
  t.mock.timers.tick(15_000);
  await settle();
  manager.onCharacterConnected('first');
  finish({ success: true, processId: 1 });
  await settle();
  assert.deepEqual(closed, [1]);
});
