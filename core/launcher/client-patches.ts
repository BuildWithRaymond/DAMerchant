/** Verified process-memory patch sites for the two known Dark Ages 7.41 layouts. */
export type ClientPatchProfile = 'legacy-7.41' | 'current-7.41';
export type MemoryReader = (address: number, length: number) => Buffer;
export interface ClientPatchWrite { address: number; bytes: number[] }

const MULTIPLE_INSTANCE = 0x57A7CE;
const INTRO = 0x42E61F;

const currentSites: ReadonlyArray<readonly [number, readonly number[]]> = [
  // This layout already jumps past the single-instance error path.
  [MULTIPLE_INSTANCE, [0xFF, 0x15, 0xC4, 0x91, 0x66, 0, 0x3D, 0xB7, 0, 0, 0, 0xEB, 0x07]],
  // The old intro patch cuts through different instructions in this layout.
  [INTRO, [0x3B, 0x91, 0x84, 0, 0, 0, 0x0F, 0x8C, 0xB1, 0, 0, 0]],
  [0x433391, [0x68, 0xA8, 0x07, 0x67, 0]],
  [0x565622, [0xC7, 0x85, 0x84, 0xFB, 0xFF, 0xFF, 0x4C, 0x45, 0x68, 0]],
  [0x4333C2, [0x6A, 0x5E, 0x6A, 0x37, 0x6A, 0x58, 0x6A, 0x34]],
  [0x4333E3, [0xBA, 0x32, 0x0A, 0, 0]],
  [0x433401, [0xB8, 0x29, 0x0A, 0, 0]],
  [0x56564F, [0xB8, 0x29, 0x0A, 0, 0]],
  [0x56565D, [0xB9, 0x32, 0x0A, 0, 0]],
];

const legacySites: ReadonlyArray<readonly [number, readonly number[]]> = [
  [MULTIPLE_INSTANCE, [0xFF, 0x15, 0xBC, 0x21, 0x6A, 0]],
  [0x4333E3, [0xBA, 0x97, 0x02, 0, 0]],
  [0x4333C3, [0x6A, 0x44, 0x6A, 0xD8, 0x6A, 0x5A, 0x6A, 0xCE]],
];
const legacyIntro: readonly [number, readonly number[]] =
  [INTRO, [0x83, 0xFA, 0x01, 0x0F, 0x85, 0x9B]];

function verifySite(read: MemoryReader, address: number, expected: readonly number[]): void {
  const actual = read(address, expected.length);
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `Unsupported Dark Ages client: patch bytes differ at 0x${(address + i).toString(16)} ` +
        `(expected 0x${expected[i].toString(16)}, got ${actual[i] === undefined ? 'no byte' : `0x${actual[i].toString(16)}`}).`
      );
    }
  }
}

/** Checks every required site before the caller allocates or writes process memory. */
export function prepareClientPatches(read: MemoryReader, skipIntro: boolean): ClientPatchProfile {
  const call = read(MULTIPLE_INSTANCE, 6);
  const current = Buffer.from(currentSites[0][1].slice(0, 6));
  const legacy = Buffer.from(legacySites[0][1]);
  let profile: ClientPatchProfile;
  if (call.equals(current)) profile = 'current-7.41';
  else if (call.equals(legacy)) profile = 'legacy-7.41';
  else throw new Error('Unsupported Dark Ages client: no matching verified patch profile.');

  const sites = profile === 'current-7.41'
    ? currentSites
    : skipIntro ? [...legacySites, legacyIntro] : legacySites;
  for (const [address, expected] of sites) verifySite(read, address, expected);
  return profile;
}

function uint32(value: number): number[] {
  return [value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF];
}

export function buildClientWrites(
  profile: ClientPatchProfile, hostnamePtr: number, port: number, skipIntro: boolean
): ClientPatchWrite[] {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid proxy port');
  if (!Number.isInteger(hostnamePtr) || hostnamePtr < 1 || hostnamePtr > 0xFFFFFFFF) {
    throw new Error('Invalid hostname pointer');
  }
  const portBytes = [(port & 0xFF), (port >>> 8) & 0xFF, 0, 0];
  const hostBytes = uint32(hostnamePtr);
  const loopback = [0x6A, 1, 0x6A, 0, 0x6A, 0, 0x6A, 127];

  if (profile === 'current-7.41') {
    return [
      { address: 0x433392, bytes: hostBytes },
      { address: 0x565628, bytes: hostBytes },
      { address: 0x4333C2, bytes: loopback },
      { address: 0x4333E3, bytes: [0xBA, ...portBytes] },
      { address: 0x433401, bytes: [0xB8, ...portBytes] },
      { address: 0x56564F, bytes: [0xB8, ...portBytes] },
      { address: 0x56565D, bytes: [0xB9, ...portBytes] },
    ];
  }
  if (profile !== 'legacy-7.41') throw new Error('Unknown patch profile');
  return [
    { address: MULTIPLE_INSTANCE, bytes: [0x31, 0xC0, 0x90, 0x90, 0x90, 0x90] },
    ...(skipIntro ? [{ address: INTRO, bytes: [0x83, 0xFA, 0, 0x90, 0x90, 0x90] }] : []),
    { address: 0x433392, bytes: hostBytes },
    { address: 0x565628, bytes: hostBytes },
    { address: 0x4333E3, bytes: [0xBA, ...portBytes] },
    { address: 0x4333C3, bytes: loopback },
  ];
}
