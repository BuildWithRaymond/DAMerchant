import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { ProxyConnection } from '../core/proxy/proxy-connection';
import { ClientOpCode, ServerOpCode } from '../core/network/packets/op-codes';
import { BinaryWriter } from '../core/network/serialization/binary-writer';

test('an injected login retains credentials so the next server reset can reconnect again', () => {
  const connection = new ProxyConnection(new net.Socket(), 2615);
  const server = new net.Socket();
  server.write = (() => true) as typeof server.write;
  (connection as any).serverSocket = server;
  const writer = new BinaryWriter();
  writer.writeString8('Merchant');
  writer.writeString8('test-password');
  // No real server is used; the offline transport accepts the outgoing frame.
  connection.injectClientPacket(ClientOpCode.Login, writer.toArray());
  assert.equal(connection.connectionState.username, 'Merchant');
  assert.equal(connection.connectionState.password, 'test-password');
  connection.dispose();
});

test('a server socket error is classified as a server disconnect for recovery', () => {
  const client = new net.Socket();
  const server = new net.Socket();
  const connection = new ProxyConnection(client, 2615);
  // Supply an offline transport; no socket connects to the game.
  (connection as any).serverSocket = server;
  connection.startForwarding();
  let reason = '';
  connection.on('disposed', () => { reason = connection.disconnectReason; });
  server.emit('error', new Error('simulated ECONNRESET'));
  assert.equal(reason, 'server');
});

test('canceling an in-flight remote connection destroys its socket and rejects the pending connect', async t => {
  const server = new net.Socket();
  t.mock.method(net, 'createConnection', () => server);
  const connection = new ProxyConnection(new net.Socket(), 2615);
  const connect = connection.connectToRemote('offline.invalid', 2610);
  const rejected = assert.rejects(connect, /disposed|cancel|closed/i);
  connection.dispose();
  assert.equal(server.destroyed, true);
  await rejected;
});

test('a remote connect timeout closes the attempt instead of leaving an abandoned transport', async t => {
  const server = new net.Socket();
  t.mock.method(net, 'createConnection', () => server);
  const connection = new ProxyConnection(new net.Socket(), 2615);
  const connect = connection.connectToRemote('offline.invalid', 2610);
  const rejected = assert.rejects(connect, /timeout|timed out/i);
  server.emit('timeout');
  assert.equal(server.destroyed, true);
  assert.equal(connection.disconnectReason, 'server');
  await rejected;
});

test('a fresh local TCP session still forwards the redirect handshake and disposes both transports', async t => {
  const remote = net.createServer();
  const local = net.createServer();
  await new Promise<void>(resolve => remote.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => { local.close(); remote.close(); });
  const localAccepted = once(local, 'connection');
  const remoteAccepted = once(remote, 'connection');
  const client = net.createConnection((local.address() as net.AddressInfo).port, '127.0.0.1');
  t.after(() => client.destroy());
  const [localSocket] = await localAccepted;
  const connection = new ProxyConnection(localSocket, 2615);
  t.after(() => connection.dispose());
  const connecting = connection.connectToRemote('127.0.0.1', (remote.address() as net.AddressInfo).port);
  const [remoteSocket] = await remoteAccepted;
  t.after(() => remoteSocket.destroy());
  await connecting;
  connection.startForwarding();

  const receivedHandshake = once(client, 'data');
  remoteSocket.write(Buffer.from([0xAA, 0, 1, ServerOpCode.AcceptConnection]));
  const [handshake] = await receivedHandshake;
  assert.deepEqual(handshake, Buffer.from([0xAA, 0, 1, ServerOpCode.AcceptConnection]));
  const payload = new BinaryWriter();
  payload.writeUint8(0); payload.writeString8('UrkcnItnI'); payload.writeString8('Merchant');
  const auth = Buffer.concat([Buffer.from([0xAA, 0, payload.toArray().length + 1, ClientOpCode.ClientRedirected]), payload.toArray()]);
  const receivedAuth = once(remoteSocket, 'data');
  client.write(auth);
  const [forwarded] = await receivedAuth;
  assert.deepEqual(forwarded, auth);
  assert.equal(connection.connectionState.characterName, 'Merchant');
  const disposed = once(connection, 'disposed');
  client.destroy();
  await disposed;
  assert.equal(connection.disconnectReason, 'client');
});
