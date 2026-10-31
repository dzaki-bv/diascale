// LUCA VOSS FG2504WB (iComon) packet format on GATT service FFB0.
// Packet: index, 0x00, payload length, 0x00, payload…, checksum (sum of payload & 0x1F).

export const SERVICE = "0000ffb0-0000-1000-8000-00805f9b34fb";
export const WRITE_CHAR = "0000ffb1-0000-1000-8000-00805f9b34fb";
export const NOTIFY_CHAR = "0000ffb2-0000-1000-8000-00805f9b34fb";
export const INDICATE_CHAR = "0000ffb3-0000-1000-8000-00805f9b34fb";

export const TYPE = {
  ack: 0xa0,
  live: 0xa2,
  stored: 0xa5,
  final: 0xa7,
  deviceInfo: 0xaa,
  appAck: 0xb0,
  profile: 0xc0,
  userList: 0xc1,
} as const;

export interface Packet {
  index: number;
  type: number;
  payload: Uint8Array; // includes the type byte
}

export function checksum(payload: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) sum += payload[i] & 0xff;
  return sum & 0x1f;
}

export function buildPacket(index: number, payload: ArrayLike<number>): Uint8Array {
  const bytes = new Uint8Array(payload.length + 5);
  bytes[0] = index & 0xff;
  bytes[2] = payload.length;
  for (let i = 0; i < payload.length; i++) bytes[4 + i] = payload[i];
  bytes[bytes.length - 1] = checksum(payload);
  return bytes;
}

/** Returns null for malformed packets or a bad checksum. */
export function parsePacket(bytes: Uint8Array): Packet | null {
  if (bytes.length < 6) return null;
  const length = bytes[2];
  if (bytes.length !== length + 5) return null;
  const payload = bytes.subarray(4, 4 + length);
  if (checksum(payload) !== bytes[bytes.length - 1]) return null;
  return { index: bytes[0], type: payload[0], payload };
}

export type LiveStatus = "measuring" | "stable" | "off";

export interface LiveWeight {
  status: LiveStatus;
  grams: number;
}

export function parseLive(packet: Packet): LiveWeight {
  const p = packet.payload;
  const status = p[1] === 3 ? "stable" : p[1] === 0 ? "off" : "measuring";
  return { status, grams: (p[3] << 16) | (p[4] << 8) | p[5] };
}

export interface ScaleRecord {
  stored: boolean;
  time: number; // Unix seconds, scale clock
  algorithm: number;
  grams: number;
  /** Ohm, scale order: trunk, LA, RA, LL, RL at 20 kHz, then the same at 100 kHz. All zero without the handle. */
  impedances: number[];
  userId: number;
}

export function parseRecord(packet: Packet): ScaleRecord {
  const p = packet.payload;
  const u32 = (o: number) => ((p[o] << 24) | (p[o + 1] << 16) | (p[o + 2] << 8) | p[o + 3]) >>> 0;
  const count = p[10];
  const impedances: number[] = [];
  for (let i = 0; i < count; i++) impedances.push(((p[11 + 2 * i] << 8) | p[12 + 2 * i]) / 10);
  return {
    stored: p[0] === TYPE.stored,
    time: u32(1),
    algorithm: p[5],
    grams: (p[6] << 16) | (p[7] << 8) | p[8],
    impedances,
    userId: u32(11 + 2 * count),
  };
}

export interface ScaleProfile {
  heightCm: number;
  lastWeightKg: number;
  male: boolean;
  age: number;
  userId: number;
}

function profileBytes(profile: ScaleProfile): number[] {
  const weight = Math.round(profile.lastWeightKg * 100);
  const id = profile.userId >>> 0;
  return [
    profile.heightCm & 0xff,
    (weight >> 8) & 0xff,
    weight & 0xff,
    (profile.male ? 0x80 : 0) | (profile.age & 0x7f),
    0x13, 0x88, 0x13, 0x88, // target weight 50.00 kg, as sent by FitDays+
  ].concat([id >>> 24, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff]);
}

// Constant fields copied from FitDays+; the scale accepts them as is.
const PROFILE_TAIL = [0x01, 0x01, 0x02, 0x6b, 0x69];

export function buildAck(index: number, replyTo: number): Uint8Array {
  return buildPacket(index, [TYPE.appAck, replyTo & 0xff, 0]);
}

export function buildProfile(index: number, timeSeconds: number, profile: ScaleProfile): Uint8Array {
  const t = timeSeconds >>> 0;
  const body = profileBytes(profile);
  return buildPacket(index, [
    TYPE.profile, t >>> 24, (t >> 16) & 0xff, (t >> 8) & 0xff, t & 0xff, 0x01, 0xa4, 0x01,
    ...body.slice(0, 8), 0x2f, ...body.slice(8), ...PROFILE_TAIL,
  ]);
}

export function buildUserList(index: number, profile: ScaleProfile): Uint8Array {
  const body = profileBytes(profile);
  return buildPacket(index, [TYPE.userList, 0x01, 0x01, ...body.slice(0, 8), 0x0f, ...body.slice(8), ...PROFILE_TAIL]);
}

export function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
