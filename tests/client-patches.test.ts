import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildClientWrites, prepareClientPatches } from '../core/launcher/client-patches';

const currentSites = new Map<number, number[]>([
  [0x57A7CE, [0xFF, 0x15, 0xC4, 0x91, 0x66, 0x00, 0x3D, 0xB7, 0, 0, 0, 0xEB, 0x07]],
  [0x42E61F, [0x3B, 0x91, 0x84, 0, 0, 0, 0x0F, 0x8C, 0xB1, 0, 0, 0]],
  [0x433391, [0x68, 0xA8, 0x07, 0x67, 0]],
  [0x565622, [0xC7, 0x85, 0x84, 0xFB, 0xFF, 0xFF, 0x4C, 0x45, 0x68, 0]],
  [0x4333C2, [0x6A, 0x5E, 0x6A, 0x37, 0x6A, 0x58, 0x6A, 0x34]],
  [0x4333E3, [0xBA, 0x32, 0x0A, 0, 0]],
  [0x433401, [0xB8, 0x29, 0x0A, 0, 0]],
  [0x56564F, [0xB8, 0x29, 0x0A, 0, 0]],
  [0x56565D, [0xB9, 0x32, 0x0A, 0, 0]],
]);

function readFixture(address: number, length: number): Buffer {
  for (const [base, bytes] of currentSites) {
    if (address >= base && address + length <= base + bytes.length) {
      return Buffer.from(bytes.slice(address - base, address - base + length));
    }
  }
  throw new Error(`Missing simulated memory at 0x${address.toString(16)}`);
}

test('current 7.41 client routes both host paths and all port branches to the proxy', () => {
  const profile = prepareClientPatches(readFixture, true);
  assert.equal(profile, 'current-7.41');
  const writes = buildClientWrites(profile, 0x12345678, 2615, true);
  const at = (address: number) => writes.find((write) => write.address === address)?.bytes;
  assert.deepEqual(at(0x433392), [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual(at(0x565628), [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual(at(0x4333C2), [0x6A, 1, 0x6A, 0, 0x6A, 0, 0x6A, 127]);
  for (const address of [0x4333E3, 0x433401, 0x56564F, 0x56565D]) {
    assert.equal(at(address)?.[1], 0x37);
    assert.equal(at(address)?.[2], 0x0A);
  }
  assert.equal(writes.some((write) => write.address === 0x57A7CE), false);
  assert.equal(writes.some((write) => write.address === 0x42E61F), false);
});

test('changed current-client patch site rejects the launch before any writes', () => {
  const corruptRead = (address: number, length: number) => {
    const bytes = readFixture(address, length);
    if (address === 0x56565D) bytes[1] = 0xFF;
    return bytes;
  };
  assert.throws(() => prepareClientPatches(corruptRead, true), /0x56565e/i);
});

test('unknown client is rejected', () => {
  assert.throws(() => prepareClientPatches(() => Buffer.alloc(13), true), /Unsupported Dark Ages client/i);
});

test('legacy 7.41 layout keeps its existing launch patches', () => {
  const legacySites = new Map<number, number[]>([
    [0x57A7CE, [0xFF, 0x15, 0xBC, 0x21, 0x6A, 0]],
    [0x42E61F, [0x83, 0xFA, 1, 0x0F, 0x85, 0x9B]],
    [0x4333E3, [0xBA, 0x97, 2, 0, 0]],
    [0x4333C3, [0x6A, 0x44, 0x6A, 0xD8, 0x6A, 0x5A, 0x6A, 0xCE]],
  ]);
  const profile = prepareClientPatches((address, length) => {
    const bytes = legacySites.get(address);
    assert.ok(bytes);
    return Buffer.from(bytes.slice(0, length));
  }, true);
  assert.equal(profile, 'legacy-7.41');
  const writes = buildClientWrites(profile, 0x12345678, 2615, true);
  assert.deepEqual(writes.find(({ address }) => address === 0x57A7CE)?.bytes,
    [0x31, 0xC0, 0x90, 0x90, 0x90, 0x90]);
  assert.deepEqual(writes.find(({ address }) => address === 0x42E61F)?.bytes,
    [0x83, 0xFA, 0, 0x90, 0x90, 0x90]);
  assert.equal(writes.find(({ address }) => address === 0x4333C3)?.bytes[7], 127);
});
