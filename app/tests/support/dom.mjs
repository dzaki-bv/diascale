import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import assert from "node:assert/strict";
import captures from "../../../packages/core/test/fixtures/captures.json" with { type: "json" };

const htmlPath = new URL("../../../tmp/dom/index.html", import.meta.url);
const service = "0000ffb0-0000-1000-8000-00805f9b34fb";
export async function openApp({ saved = new Map(), failStorage = false } = {}) {
  const errors = [];
  const tasks = new Map();
  const listeners = new Map();
  const calls = [];
  let time = 0;
  let nextID = 0;
  let storageFails = failStorage;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(await readFile(htmlPath, "utf8"), {
    url: "https://localhost/",
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window) {
      window.structuredClone = structuredClone;
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.fetch = async () => {
        throw new Error("No archive URL configured");
      };
      window.HTMLElement.prototype.scrollTo = function (_x, y) {
        this.scrollTop = y;
      };
      window.setTimeout = (callback, delay = 0, ...args) => {
        const id = ++nextID;
        tasks.set(id, {
          time: time + Number(delay),
          callback: () => callback(...args),
        });
        return id;
      };
      window.clearTimeout = (id) => tasks.delete(id);
      window.androidBridge = {};
      const promiseMethods = (names) =>
        names.map((name) => ({ name, rtype: "promise" }));
      window.Capacitor = {
        PluginHeaders: [
          { name: "Preferences", methods: promiseMethods(["get", "set"]) },
          {
            name: "BluetoothLe",
            methods: [
              ...promiseMethods([
                "initialize",
                "requestLEScan",
                "stopLEScan",
                "connect",
                "disconnect",
                "read",
                "write",
                "startNotifications",
                "stopNotifications",
                "removeListener",
              ]),
              { name: "addListener", rtype: "callback" },
            ],
          },
          {
            name: "App",
            methods: [
              ...promiseMethods(["removeListener", "minimizeApp"]),
              { name: "addListener", rtype: "callback" },
            ],
          },
        ],
        nativeCallback(plugin, method, options, callback) {
          if (method !== "addListener")
            throw new Error(`Unexpected callback ${method}`);
          listeners.set(`${plugin}:${options.eventName}`, callback);
          return Promise.resolve(String(++nextID));
        },
        async nativePromise(plugin, method, options = {}) {
          calls.push({ plugin, method, options });
          if (plugin === "Preferences") {
            if (method === "get")
              return { value: saved.get(options.key) ?? null };
            if (storageFails) throw new Error("disk full");
            saved.set(options.key, options.value);
            return {};
          }
          if (method === "removeListener") {
            listeners.delete(`${plugin}:${options.eventName}`);
            return {};
          }
          if (plugin === "BluetoothLe" && method === "read")
            return { value: Buffer.from("FG2504WB-A").toString("hex") };
          return {};
        },
      };
    },
  });
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  const flush = async () => {
    for (let i = 0; i < 120; i++) await Promise.resolve();
  };
  await flush();
  const document = dom.window.document;
  const query = (selector) => {
    const element = document.querySelector(selector);
    assert.ok(element, `Expected element: ${selector}`);
    return element;
  };
  const emit = (event, payload) =>
    listeners.get(`BluetoothLe:${event}`)?.(payload);
  return {
    document,
    window: dom.window,
    errors,
    query,
    saved,
    calls,
    flush,
    screen: () => query(".phone").dataset.screen,
    async click(action) {
      query(`[data-action="${action}"]`).click();
      await flush();
    },
    fill(name, value) {
      const input = query(`[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    },
    async submit(id) {
      query(`#${id}`).requestSubmit();
      await flush();
    },
    answer(name, value) {
      query(`input[name="${name}"][value="${value}"]`).checked = true;
    },
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const next = [...tasks]
          .filter(([, task]) => task.time <= end)
          .sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id);
        time = task.time;
        task.callback();
        await flush();
      }
      time = end;
      await flush();
    },
    async discover(ids = ["scale"]) {
      for (const id of ids)
        emit("onScanResult", {
          device: { deviceId: id, name: "MY_SCALE" },
          rssi: -45,
          manufacturerData: { [0x2cac]: "A2EBCDF4656033711E1A0A012B00004400" },
        });
      await this.advance(ids.length ? 1500 : 60000);
    },
    async replay(id = "scale") {
      for (const packet of captures["device-test-b-handshake"]) {
        if (packet.dir !== "in") continue;
        // The captured scale user ID must match this persisted installation.
        let hex = packet.hex;
        const data = JSON.parse(saved.get("diascale.local.v1"));
        if (hex.slice(8, 10) === "A7") {
          const bytes = Buffer.from(hex, "hex");
          bytes.writeUInt32BE(data.userId, bytes.length - 5);
          bytes[bytes.length - 1] =
            [...bytes.subarray(4, bytes.length - 1)].reduce(
              (a, b) => a + b,
              0,
            ) & 31;
          hex = bytes.toString("hex");
        }
        emit(
          `notification|${id}|${service}|0000${packet.char}-0000-1000-8000-00805f9b34fb`,
          { value: hex },
        );
        await flush();
      }
    },
    disconnect(id = "scale") {
      emit(`disconnected|${id}`, {});
      return flush();
    },
    storageFails(value) {
      storageFails = value;
    },
    data() {
      return JSON.parse(saved.get("diascale.local.v1"));
    },
    close() {
      dom.window.close();
      tasks.clear();
    },
  };
}
export async function startSignup(app, phone = "81200000000") {
  await app.click("signup");
  app.fill("phone", phone);
  await app.submit("phone-form");
}
export async function completeSignup(
  app,
  { phone = "81200000000", name = "Uji B", meds = "Tidak" } = {},
) {
  await startSignup(app, phone);
  for (const [field, value] of Object.entries({
    name,
    birth: "2007-03-01",
    height: "147",
  }))
    app.fill(field, value);
  app.answer("sex", "Laki-laki");
  await app.submit("personal-form");
  app.answer("meds", meds);
  app.answer("glucose", "Tidak");
  app.answer("family", "Ya");
  await app.submit("health-form");
}
