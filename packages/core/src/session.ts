import {
  TYPE, buildAck, buildProfile, buildUserList, parseLive, parsePacket, parseRecord, toHex,
  type LiveStatus, type ScaleProfile, type ScaleRecord,
} from "./protocol.ts";

export const MEASUREMENT_TIMEOUT_MS = 60_000;

export type SessionEvent =
  | { type: "live"; status: LiveStatus; grams: number }
  | { type: "result"; record: ScaleRecord }
  | { type: "handleMissing"; record: ScaleRecord };

export interface RawPacket {
  dir: "in" | "out";
  hex: string;
}

/**
 * One connection to the scale. Feed every notification/indication to receive();
 * write the returned packets to FFB1 in order and react to the events.
 * Every device info, stored and final record is acknowledged so the scale
 * stops resending it; only a live final record tagged with our user id counts.
 */
export class ScaleSession {
  readonly packets: RawPacket[] = [];
  readonly startedAt: number;
  private index = 0;
  private done = false;
  private readonly profile: ScaleProfile;
  private readonly now: () => number;

  constructor(profile: ScaleProfile, now: () => number = Date.now) {
    this.profile = profile;
    this.now = now;
    this.startedAt = now();
  }

  timedOut(): boolean {
    return !this.done && this.now() - this.startedAt > MEASUREMENT_TIMEOUT_MS;
  }

  receive(bytes: Uint8Array): { writes: Uint8Array[]; events: SessionEvent[] } {
    this.packets.push({ dir: "in", hex: toHex(bytes) });
    const writes: Uint8Array[] = [];
    const events: SessionEvent[] = [];
    const packet = parsePacket(bytes);
    if (!packet) return { writes, events };
    const send = (make: (index: number) => Uint8Array) => {
      const out = make(this.index);
      this.index = (this.index + 1) & 0xff;
      this.packets.push({ dir: "out", hex: toHex(out) });
      writes.push(out);
    };

    switch (packet.type) {
      case TYPE.deviceInfo:
        send((i) => buildAck(i, packet.index));
        send((i) => buildProfile(i, Math.floor(this.now() / 1000), this.profile));
        send((i) => buildUserList(i, this.profile));
        break;
      case TYPE.live:
        if (!this.done) events.push({ type: "live", ...parseLive(packet) });
        break;
      case TYPE.stored:
        send((i) => buildAck(i, packet.index));
        break;
      case TYPE.final: {
        send((i) => buildAck(i, packet.index));
        const record = parseRecord(packet);
        if (this.done || record.userId !== this.profile.userId >>> 0) break;
        if (record.impedances.some((z) => z > 0)) {
          this.done = true;
          events.push({ type: "result", record });
        } else {
          events.push({ type: "handleMissing", record });
        }
        break;
      }
    }
    return { writes, events };
  }
}
