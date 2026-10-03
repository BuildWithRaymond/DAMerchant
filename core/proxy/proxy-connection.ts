import net from 'net';
import { EventEmitter } from 'events';
import { ClientCrypto } from '../network/encryption/client-crypto';
import { ServerCrypto } from '../network/encryption/server-crypto';
import { ServerOpCode, ClientOpCode } from '../network/packets/op-codes';
import { ConnectionState, ConnectionPhase } from './connection-state';

const SYNC_BYTE = 0xAA;

export interface DecodedPacket {
  direction: 'client' | 'server';
  opCode: number;
  data: Uint8Array;
}

/**
 * One ProxyConnection per client TCP session.
 * Matches Arbiter's ProxyConnection architecture:
 *   - Decrypt incoming packets
 *   - Inspect/handle special packets
 *   - Re-encrypt and forward to the other side
 *
 * clientEncryptor handles CLIENT packets (both decrypt from client + encrypt to server)
 * serverEncryptor handles SERVER packets (both decrypt from server + encrypt to client)
 */
export class ProxyConnection extends EventEmitter {
  connectionState = new ConnectionState();

  private clientEncryptor = new ClientCrypto(0);
  private serverEncryptor = new ServerCrypto(0);

  private clientSequence = 0;
  private serverSequence = 0;

  private clientBuffer = Buffer.alloc(0);
  private serverBuffer = Buffer.alloc(0);

  private clientSocket: net.Socket;
  private serverSocket: net.Socket | null = null;

  private localPort: number;
  private disposed = false;

  /** Why the connection was disposed — lets callers distinguish server restarts from user closes */
  disconnectReason: 'server' | 'client' | 'unknown' = 'unknown';

  private serverPacketTransformers: Map<number, (data: Uint8Array) => Uint8Array> = new Map();

  constructor(clientSocket: net.Socket, localPort: number) {
    super();
    this.clientSocket = clientSocket;
    this.clientSocket.setNoDelay(true);
    this.localPort = localPort;
    // The local client can exit while the remote TCP connect is still pending.
    clientSocket.on('close', () => {
      this.disconnectReason = 'client';
      this.emit('clientDisconnected');
      this.dispose();
    });
    clientSocket.on('error', () => {
      this.disconnectReason = 'client';
      this.dispose();
    });
  }

  async connectToRemote(host: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.disposed) { reject(new Error('Connection disposed')); return; }
      const serverSocket = net.createConnection({ host, port });
      this.serverSocket = serverSocket; // retain the pending socket so dispose can close it
      let connected = false;
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      this.once('disposed', () => finish(new Error('Connection disposed')));
      serverSocket.setTimeout(10_000);
      serverSocket.once('timeout', () => {
        this.disconnectReason = 'server';
        finish(new Error('Remote connection timed out'));
        this.dispose();
      });
      serverSocket.once('connect', () => {
        if (this.disposed) { finish(new Error('Connection disposed')); return; }
        connected = true;
        serverSocket.setTimeout(0);
        serverSocket.setNoDelay(true);
        console.log(`[Proxy] Connected to ${host}:${port}`);
        finish();
      });
      serverSocket.on('error', (err) => {
        this.disconnectReason = 'server';
        finish(err);
        this.dispose();
      });
      serverSocket.once('close', () => {
        if (connected || this.disposed) return;
        this.disconnectReason = 'server';
        finish(new Error('Remote connection closed before connect'));
        this.dispose();
      });
    });
  }

  startForwarding(): void {
    const { clientSocket, serverSocket } = this;
    if (!serverSocket) throw new Error('Not connected to remote');

    // Client -> Server
    clientSocket.on('data', (data: Buffer) => {
      if (this.disposed) return;
      this.clientBuffer = Buffer.concat([this.clientBuffer, data]);
      this.processClientPackets();
    });

    // Server -> Client
    serverSocket.on('data', (data: Buffer) => {
      if (this.disposed) return;
      this.serverBuffer = Buffer.concat([this.serverBuffer, data]);
      this.processServerPackets();
    });

    serverSocket.on('close', () => {
      console.log('[Proxy] Server disconnected');
      this.disconnectReason = 'server';
      this.emit('serverDisconnected');
      // Don't dispose during redirect — client will reconnect to proxy
      if (this.connectionState.phase !== ConnectionPhase.REDIRECTING) {
        this.dispose();
      }
    });

    serverSocket.on('error', (err) => {
      if (!this.disposed) {
        console.error('[Proxy] Server error:', err.message);
        this.disconnectReason = 'server';
        this.dispose();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.clientSocket.removeAllListeners();
    this.serverSocket?.removeAllListeners();
    this.clientSocket.destroy();
    this.serverSocket?.destroy();

    this.emit('disposed');
  }

  /** Register a transformer that modifies server->client packets before forwarding. */
  registerServerTransformer(opCode: number, fn: (data: Uint8Array) => Uint8Array): void {
    this.serverPacketTransformers.set(opCode, fn);
  }

  /** Inject a packet as if the client sent it. Used by merchant engine. */
  injectClientPacket(opCode: number, payload: Uint8Array): void {
    if (!this.serverSocket?.writable || this.disposed) return;

    // Automatic logins must retain credentials across the same redirect path
    // as manual logins, so recovery still works on a subsequent server reset.
    if (opCode === ClientOpCode.Login) this.handleLoginCapture(payload);

    let data: Uint8Array;
    if (this.clientEncryptor.shouldEncrypt(opCode)) {
      const seq = this.nextClientSequence();
      if (opCode === ClientOpCode.Login) {
        const keyHex = Buffer.from(this.clientEncryptor.key).toString('hex');
        console.log(`[Inject Login] payload=${payload.length}b, seq=${seq}, seed=${this.clientEncryptor.seed}, key=${keyHex}, keySalts=${this.clientEncryptor.keySalts}, phase=${this.connectionState.phase}`);
      }
      data = this.clientEncryptor.encrypt(payload, opCode, seq);
      if (opCode === ClientOpCode.Login) {
        const encHex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
        console.log(`[Inject Login] encrypted=${data.length}b: ${encHex}`);
      }
    } else {
      data = payload;
    }

    this.writeFrame(this.serverSocket, opCode, data);
  }

  /** Inject a packet as if the server sent it. */
  injectServerPacket(opCode: number, payload: Uint8Array): void {
    if (!this.clientSocket?.writable || this.disposed) return;

    let data: Uint8Array;
    if (this.serverEncryptor.shouldEncrypt(opCode)) {
      const seq = this.nextServerSequence();
      data = this.serverEncryptor.encrypt(payload, opCode, seq);
    } else {
      data = payload;
    }

    this.writeFrame(this.clientSocket, opCode, data);
  }

  // ─── Client -> Server packet processing ───

  private processClientPackets(): void {
    while (this.clientBuffer.length >= 4) {
      if (this.clientBuffer[0] !== SYNC_BYTE) {
        this.clientBuffer = this.clientBuffer.subarray(1);
        continue;
      }

      const length = (this.clientBuffer[1] << 8) | this.clientBuffer[2];
      const totalLength = length + 3;

      if (this.clientBuffer.length < totalLength) break;

      const opCode = this.clientBuffer[3];
      const encryptedData = this.clientBuffer.subarray(4, totalLength);

      // Decrypt
      let decrypted: Uint8Array;
      if (ClientCrypto.isEncrypted(opCode)) {
        try {
          decrypted = this.clientEncryptor.decrypt(Uint8Array.from(encryptedData), opCode);
        } catch {
          // Forward raw on failure
          this.forwardRawToServer(this.clientBuffer.subarray(0, totalLength));
          this.clientBuffer = this.clientBuffer.subarray(totalLength);
          continue;
        }
      } else {
        decrypted = Uint8Array.from(encryptedData);
      }

      // Handle special packets
      if (opCode === ClientOpCode.Login) {
        this.handleLoginCapture(decrypted);
        // Debug: log the re-encrypted Login for comparison with injected Login
        const keyHex = Buffer.from(this.clientEncryptor.key).toString('hex');
        console.log(`[Manual Login] decrypted=${decrypted.length}b, nextSeq=${this.clientSequence}, seed=${this.clientEncryptor.seed}, key=${keyHex}, keySalts=${this.clientEncryptor.keySalts}`);
      }
      if (opCode === ClientOpCode.ClientRedirected) {
        this.handleClientAuth(decrypted);
      }

      // Emit for inspection
      this.emit('packet', 'client', opCode, decrypted);

      // Re-encrypt and forward to server
      if (ClientCrypto.isEncrypted(opCode)) {
        const seq = this.nextClientSequence();
        const reEncrypted = this.clientEncryptor.encrypt(decrypted, opCode, seq);
        this.writeFrame(this.serverSocket!, opCode, reEncrypted);
      } else {
        // Unencrypted — forward as-is
        this.writeFrame(this.serverSocket!, opCode, decrypted);
      }

      this.clientBuffer = this.clientBuffer.subarray(totalLength);
    }
  }

  // ─── Server -> Client packet processing ───

  private processServerPackets(): void {
    while (this.serverBuffer.length >= 4) {
      if (this.serverBuffer[0] !== SYNC_BYTE) {
        this.serverBuffer = this.serverBuffer.subarray(1);
        continue;
      }

      const length = (this.serverBuffer[1] << 8) | this.serverBuffer[2];
      const totalLength = length + 3;

      if (this.serverBuffer.length < totalLength) break;

      const opCode = this.serverBuffer[3];
      const encryptedData = this.serverBuffer.subarray(4, totalLength);

      // Handle unencrypted special packets
      if (opCode === ServerOpCode.ConnectionInfo) {
        this.handleConnectionInfo(Buffer.from(encryptedData));
        this.emit('packet', 'server', opCode, Uint8Array.from(encryptedData));
        // Forward as-is (unencrypted)
        this.forwardRawToClient(this.serverBuffer.subarray(0, totalLength));
        this.serverBuffer = this.serverBuffer.subarray(totalLength);
        continue;
      }

      if (opCode === ServerOpCode.AcceptConnection) {
        this.connectionState.phase = ConnectionPhase.CONNECTED;
        this.emit('packet', 'server', opCode, Uint8Array.from(encryptedData));
        this.forwardRawToClient(this.serverBuffer.subarray(0, totalLength));
        this.serverBuffer = this.serverBuffer.subarray(totalLength);
        continue;
      }

      if (opCode === ServerOpCode.Redirect) {
        // Redirect is unencrypted but we need to MODIFY and re-send
        const modifiedFrame = this.handleRedirect(Buffer.from(this.serverBuffer.subarray(0, totalLength)));
        this.emit('packet', 'server', opCode, Uint8Array.from(encryptedData));
        if (this.clientSocket.writable) {
          this.clientSocket.write(modifiedFrame);
        }
        this.serverBuffer = this.serverBuffer.subarray(totalLength);
        continue;
      }

      // Normal encrypted server packet
      let decrypted: Uint8Array;
      if (ServerCrypto.isEncrypted(opCode)) {
        try {
          decrypted = this.serverEncryptor.decrypt(Uint8Array.from(encryptedData), opCode);
        } catch {
          this.forwardRawToClient(this.serverBuffer.subarray(0, totalLength));
          this.serverBuffer = this.serverBuffer.subarray(totalLength);
          continue;
        }
      } else {
        decrypted = Uint8Array.from(encryptedData);
      }

      // Handle special packets
      if (opCode === ServerOpCode.UserId) {
        this.connectionState.isLoggedIn = true;
        this.connectionState.phase = ConnectionPhase.IN_GAME;
      }

      // Emit for inspection
      this.emit('packet', 'server', opCode, decrypted);

      // Apply transformer if registered (e.g. merchant name display)
      let payload = decrypted;
      const transformer = this.serverPacketTransformers.get(opCode);
      if (transformer) {
        try { payload = transformer(decrypted); } catch { /* use original on error */ }
      }

      // Re-encrypt and forward to client
      if (ServerCrypto.isEncrypted(opCode)) {
        const seq = this.nextServerSequence();
        const reEncrypted = this.serverEncryptor.encrypt(payload, opCode, seq);
        this.writeFrame(this.clientSocket, opCode, reEncrypted);
      } else {
        this.writeFrame(this.clientSocket, opCode, payload);
      }

      this.serverBuffer = this.serverBuffer.subarray(totalLength);
    }
  }

  // ─── Packet handlers ───

  private handleConnectionInfo(data: Buffer): void {
    try {
      let offset = 0;
      offset += 1; // skip unknown byte
      offset += 4; // skip checksum (u32)
      const seed = data[offset++];
      const keyLength = data[offset++];
      const key = data.subarray(offset, offset + keyLength);

      this.setEncryptionParameters(seed, key);
      this.connectionState.seed = seed;
      this.connectionState.phase = ConnectionPhase.AUTHENTICATED;

      console.log(`[Interceptor] Crypto initialized: seed=${seed}, keyLen=${keyLength}`);
    } catch (err) {
      console.error('[Interceptor] Failed to parse ConnectionInfo:', err);
    }
  }

  /** Parse Login (0x03) to capture username/password for auto-reconnect */
  private handleLoginCapture(data: Buffer | Uint8Array): void {
    try {
      let offset = 0;
      const usernameLength = data[offset++];
      const username = Buffer.from(data.subarray(offset, offset + usernameLength)).toString('ascii');
      offset += usernameLength;
      const passwordLength = data[offset++];
      const password = Buffer.from(data.subarray(offset, offset + passwordLength)).toString('ascii');

      this.connectionState.username = username;
      this.connectionState.password = password;
      this.emit('credentials', { username, password });
      console.log(`[Interceptor] Captured login credentials for: ${username}`);
    } catch (err) {
      console.error('[Interceptor] Failed to parse Login packet:', err);
    }
  }

  private handleClientAuth(data: Buffer | Uint8Array): void {
    try {
      let offset = 0;
      const seed = data[offset++];
      const keyLength = data[offset++];
      const key = data.subarray(offset, offset + keyLength);
      offset += keyLength;

      const nameLength = data[offset++];
      const name = Buffer.from(data.subarray(offset, offset + nameLength)).toString('ascii');

      this.connectionState.characterName = name;
      this.setEncryptionParameters(seed, key, name);

      console.log(`[Interceptor] Client auth: name=${name}, seed=${seed}`);
    } catch (err) {
      console.error('[Interceptor] Failed to parse ClientAuth:', err);
    }
  }

  private handleRedirect(frame: Buffer): Buffer {
    try {
      const data = frame.subarray(4); // skip sync + length + opcode

      const b1 = data[3], b2 = data[2], b3 = data[1], b4 = data[0];
      const port = (data[4] << 8) | data[5];
      const host = `${b1}.${b2}.${b3}.${b4}`;

      let offset = 6;
      offset += 1; // remainingCount byte
      const seed = data[offset++];
      const keyLength = data[offset++];
      const key = data.subarray(offset, offset + keyLength);
      offset += keyLength;

      const nameLength = data[offset++];
      const name = data.subarray(offset, offset + nameLength).toString('ascii');

      console.log(`[Interceptor] Redirect: ${host}:${port} -> rewriting to localhost:${this.localPort}, name=${name}`);

      // Update crypto for the next connection
      this.setEncryptionParameters(seed, key, name);
      this.connectionState.characterName = name;
      this.connectionState.phase = ConnectionPhase.REDIRECTING;

      // Reset sequence counters (matching Arbiter)
      this.clientSequence = 0;
      this.serverSequence = 0;

      // Rewrite IP and port in the frame
      const modified = Buffer.from(frame);
      modified[4] = 1;
      modified[5] = 0;
      modified[6] = 0;
      modified[7] = 127;
      modified[8] = (this.localPort >> 8) & 0xff;
      modified[9] = this.localPort & 0xff;

      // Emit the REAL redirect target so ProxyServer can queue it
      this.emit('redirect', host, port);

      return modified;
    } catch (err) {
      console.error('[Interceptor] Failed to parse Redirect:', err);
      return frame;
    }
  }

  private setEncryptionParameters(seed: number, key: Buffer | Uint8Array, name?: string): void {
    // Arbiter creates new NetworkEncryptionParameters and assigns to both encryptors.
    // We update seed, key, and keySalts on both.
    this.clientEncryptor.seed = seed;
    this.serverEncryptor.seed = seed;

    if (key.length > 0) {
      const keyStr = Buffer.from(key).toString('ascii');
      this.clientEncryptor.key = keyStr;
      this.serverEncryptor.key = keyStr;
    }

    if (name) {
      this.clientEncryptor.keySalts = name;
      this.serverEncryptor.keySalts = name;
    }

    // Reset ordinals on the crypto instances (not used for proxy, we manage our own sequences)
    this.clientEncryptor.currentOrdinal = 0;
    this.serverEncryptor.currentOrdinal = 0;
  }

  // ─── Helpers ───

  private nextClientSequence(): number {
    return this.clientSequence++ % 256;
  }

  private nextServerSequence(): number {
    return this.serverSequence++ % 256;
  }

  private writeFrame(socket: net.Socket, opCode: number, data: Uint8Array): void {
    if (!socket.writable) return;

    const length = data.length + 1; // +1 for opcode
    const frame = Buffer.alloc(length + 3); // +3 for sync + 2 length bytes
    frame[0] = SYNC_BYTE;
    frame[1] = (length >> 8) & 0xff;
    frame[2] = length & 0xff;
    frame[3] = opCode;
    frame.set(data, 4);

    socket.write(frame);
  }

  private forwardRawToServer(raw: Buffer): void {
    if (this.serverSocket?.writable) {
      this.serverSocket.write(Buffer.from(raw));
    }
  }

  private forwardRawToClient(raw: Buffer): void {
    if (this.clientSocket.writable) {
      this.clientSocket.write(Buffer.from(raw));
    }
  }
}
