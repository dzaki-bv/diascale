import type { LocalStore } from "./storage.ts";

export interface SyncOptions {
  url: string;
  fetch?: typeof fetch;
  online?: () => boolean;
  now?: () => number;
  random?: () => number;
  changed?: () => void;
}

/** Owns retries; never deletes local history or replaces an existing installation identity. */
export class SyncEngine {
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private accountRetryAt = 0;
  private accountAttempts = 0;
  private readonly url: string;
  private readonly fetcher: typeof fetch;
  private readonly online: () => boolean;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly store: LocalStore;
  private readonly options: SyncOptions;
  constructor(store: LocalStore, options: SyncOptions) {
    this.store = store;
    this.options = options;
    this.url = options.url.replace(/\/$/, "");
    if (this.url) {
      const url = new URL(this.url);
      if (
        (url.protocol !== "https:" &&
          !(
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)
          )) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw new Error(
          "URL arsip harus berupa origin HTTPS atau localhost untuk pengujian.",
        );
    }
    this.fetcher = options.fetch ?? fetch;
    this.online = options.online ?? (() => true);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }
  start(): void {
    this.stopped = false;
    void this.flush();
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }
  flush(): Promise<void> {
    if (this.stopped || !this.url || !this.online()) return Promise.resolve();
    if (this.running) return this.running;
    clearTimeout(this.timer);
    this.running = this.send()
      .catch(() => {
        // Storage failures leave the durable outbox intact; retry without a tight loop.
        this.accountRetryAt = this.now() + this.delay(++this.accountAttempts);
      })
      .finally(() => {
        this.running = null;
        this.options.changed?.();
        this.schedule();
      });
    return this.running;
  }
  private delay(attempt: number): number {
    return (
      Math.min(300_000, 1000 * 2 ** Math.min(attempt - 1, 9)) *
      (1 + this.random() * 0.2)
    );
  }
  private async post(
    path: string,
    token?: string,
    body?: unknown,
  ): Promise<Response> {
    return this.fetcher(`${this.url}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  }
  private async send(): Promise<void> {
    if (this.now() < this.accountRetryAt) return;
    let credentials = this.store.snapshot().credentials;
    if (!credentials) {
      try {
        const response = await this.post("/v1/accounts");
        if (response.status !== 201) throw new Error("account request failed");
        const value = (await response.json()) as {
          id?: string;
          token?: string;
        };
        if (
          typeof value.id !== "string" ||
          !value.id ||
          typeof value.token !== "string" ||
          !/^[0-9a-f]{64}$/.test(value.token)
        )
          throw new Error("invalid account response");
        credentials = { id: value.id, token: value.token };
        const saved = credentials;
        await this.store.update((data) => {
          data.credentials = saved;
        });
        this.accountAttempts = 0;
      } catch {
        this.accountRetryAt = this.now() + this.delay(++this.accountAttempts);
        return;
      }
    }
    while (!this.stopped && this.online()) {
      const item = this.store
        .snapshot()
        .outgoing.find(
          (row) => !row.blocked && row.nextAttemptAt <= this.now(),
        );
      if (!item) return;
      let status = 0;
      let accepted = false;
      try {
        const response = await this.post(
          "/v1/measurements",
          credentials.token,
          item.measurement,
        );
        status = response.status;
        if (status === 200 || status === 201) {
          const result = (await response.json()) as {
            id?: string;
            duplicate?: boolean;
          };
          accepted =
            result.id === item.measurement.id &&
            result.duplicate === (status === 200);
        }
      } catch {
        /* Offline/timeout: keep the exact same measurement ID for retry. */
      }
      await this.store.update((data) => {
        if (accepted)
          data.outgoing = data.outgoing.filter(
            (row) => row.measurement.id !== item.measurement.id,
          );
        else {
          const row = data.outgoing.find(
            (row) => row.measurement.id === item.measurement.id,
          )!;
          row.attempts += 1;
          row.nextAttemptAt = this.now() + this.delay(row.attempts);
          row.error = status ? `HTTP ${status}` : "network";
          row.blocked =
            status >= 400 && status < 500 && ![408, 425, 429].includes(status);
        }
      });
    }
  }
  private schedule(): void {
    if (this.stopped || !this.url || !this.online()) return;
    const data = this.store.snapshot();
    const times = data.outgoing
      .filter((row) => !row.blocked)
      .map((row) => row.nextAttemptAt);
    if (!data.credentials) times.push(this.accountRetryAt);
    if (!times.length) return;
    const next = Math.max(this.accountRetryAt, Math.min(...times));
    this.timer = setTimeout(
      () => void this.flush(),
      Math.max(250, next - this.now()),
    );
  }
}
