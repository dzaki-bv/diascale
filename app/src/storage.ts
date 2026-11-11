import { rescore, SCORE_VERSION } from "@diascale/core";
import type { Measurement, Profile } from "@diascale/core";

export interface Outgoing {
  measurement: Measurement;
  attempts: number;
  nextAttemptAt: number;
  error?: string;
  blocked?: boolean;
}
export interface SavedAccount {
  profile: Profile;
  history: Measurement[];
}
export interface LocalData {
  version: 1;
  activePhone: string | null;
  accounts: Record<string, SavedAccount>;
  credentials: { id: string; token: string } | null;
  userId: number;
  outgoing: Outgoing[];
}
export interface StorageDriver {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
}
export const STORAGE_KEY = "diascale.local.v1";

/** One durable document makes result + outgoing entry an atomic local save. */
export class LocalStore {
  private data!: LocalData;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly driver: StorageDriver;
  constructor(driver: StorageDriver) {
    this.driver = driver;
  }

  async load(): Promise<void> {
    const { value } = await this.driver.get({ key: STORAGE_KEY });
    if (value !== null) {
      const data = JSON.parse(value);
      if (
        data.version !== 1 ||
        !data.accounts ||
        !Array.isArray(data.outgoing) ||
        !Number.isInteger(data.userId)
      )
        throw new Error(
          "Data tersimpan tidak dapat dibaca. Data asli tetap disimpan.",
        );
      this.data = data;
      await this.upgradeScores();
      return;
    }
    this.data = {
      version: 1,
      activePhone: null,
      accounts: {},
      credentials: null,
      userId: crypto.getRandomValues(new Uint32Array(1))[0] || 1,
      outgoing: [],
    };
    await this.driver.set({
      key: STORAGE_KEY,
      value: JSON.stringify(this.data),
    });
  }

  /** Recomputes results saved under an older score version, history and queue alike. */
  private async upgradeScores(): Promise<void> {
    const stale = (m: Measurement) => m.versions.score !== SCORE_VERSION;
    const { accounts, outgoing } = this.data;
    if (
      !Object.values(accounts).some((a) => a.history.some(stale)) &&
      !outgoing.some((row) => stale(row.measurement))
    )
      return;
    // A failed write keeps the older scores readable; the next open retries.
    await this.update((data) => {
      for (const account of Object.values(data.accounts))
        account.history = account.history.map(rescore);
      for (const row of data.outgoing) row.measurement = rescore(row.measurement);
    }).catch(() => {});
  }

  snapshot(): LocalData {
    return structuredClone(this.data);
  }

  update(change: (data: LocalData) => void): Promise<void> {
    const write = this.writes.then(async () => {
      const next = this.snapshot();
      change(next);
      await this.driver.set({ key: STORAGE_KEY, value: JSON.stringify(next) });
      this.data = next;
    });
    this.writes = write.catch(() => {});
    return write;
  }

  async saveProfile(phone: string, profile: Profile): Promise<void> {
    await this.update((data) => {
      data.accounts[phone] = {
        profile: { ...profile },
        history: data.accounts[phone]?.history ?? [],
      };
      data.activePhone = phone;
    });
  }

  async saveMeasurement(
    phone: string,
    measurement: Measurement,
  ): Promise<void> {
    await this.update((data) => {
      const account = data.accounts[phone];
      if (!account) throw new Error("Profil belum tersimpan.");
      if (account.history.some((record) => record.id === measurement.id))
        return;
      account.history.unshift(structuredClone(measurement));
      data.outgoing.push({
        measurement: structuredClone(measurement),
        attempts: 0,
        nextAttemptAt: 0,
      });
    });
  }
}
