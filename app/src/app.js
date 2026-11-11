import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import { BleClient } from "@capacitor-community/bluetooth-le";
import { LocalStore } from "./storage.ts";
import { SyncEngine } from "./sync.ts";
import { ScaleAdapter } from "./scale.ts";
import { icon, logo } from "./ui/icons.js";
import { esc } from "./ui/format.js";
import {
  variant,
  state,
  initModel,
  normalizePhone,
  saveAccount,
  clearAccount,
  openAccount,
  beginSignup,
  toProfile,
  isAdult,
  saveMeasurement,
} from "./model.js";
import { nav } from "./ui/components.js";
import { home } from "./screens/home.js";
import { welcome, auth, personal, health } from "./screens/account.js";
import {
  scan,
  devices,
  measuring,
  errorScreen,
  weightText,
} from "./screens/measurement.js";
import { result } from "./screens/results.js";
import { history } from "./screens/history.js";
import { profile } from "./screens/profile.js";

const store = new LocalStore(Preferences);
const scale = new ScaleAdapter(BleClient);
let sync;
let operation = 0;
let toastTimer;
let initialized = false;
const screens = {
  welcome,
  auth,
  personal,
  health,
  home,
  scan,
  devices,
  measuring,
  result,
  history,
  profile,
  notfound: errorScreen,
  "connection-error": errorScreen,
  "measure-error": errorScreen,
};

function go(screen) {
  ++operation;
  if (["scan", "devices", "measuring"].includes(state.screen))
    void scale.cancel();
  clearTimeout(toastTimer);
  state.toast = "";
  state.screen = screen;
  render();
  document.querySelector(".screen")?.scrollTo(0, 0);
}
function toast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 3000);
}
let rendered = "";
function render() {
  const s = screens[state.screen] ? state.screen : "welcome";
  const authenticated = ["home", "history", "profile", "result"].includes(s);
  const html = `<div class="shell"><aside class="identity">${logo()}<div class="intro"><div class="eyebrow">Kenali tubuh. Pahami risiko.</div><h1>Langkah kecil.<br><em>Makna besar</em><br>untuk kesehatan.</h1><div class="intro-rule"></div><p>Kenali risiko diabetes tipe 2 melalui data tubuh Anda. Mulai kebiasaan baik, satu pengukuran setiap waktu.</p></div><div class="intro-bottom"><span>${icon("shield")}Personal untuk Anda</span><span>${icon("activity")}Terpantau dari waktu ke waktu</span></div></aside><section class="phone variant-${variant.toLowerCase()}" aria-label="Aplikasi DiaScale"><div class="statusbar"><span>9:41</span><span class="status-icons">${icon("signal")}${icon("wifi")}${icon("battery")}</span></div><main class="screen ${authenticated ? "" : "auth-view"}"><div class="content">${screens[s]()}</div></main>${authenticated ? nav() : ""}${state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : ""}<div class="home-indicator"></div></section></div>`;
  // Identical markup (e.g. scan → measuring) keeps the existing DOM and its animations.
  if (html !== rendered)
    document.getElementById("app").innerHTML = rendered = html;
  document.querySelector(".phone").dataset.screen = s;
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = state.busy;
  });
}
function syncStatus() {
  const pending = store.snapshot().outgoing;
  state.syncText = !import.meta.env.VITE_ARCHIVE_URL
    ? "Hasil tersimpan di perangkat."
    : pending.some((row) => row.blocked)
      ? "Hasil tersimpan di perangkat. Sebagian hasil belum dapat dikirim."
      : pending.length
        ? `${pending.length} hasil tersimpan, menunggu pengiriman.`
        : "Semua hasil tersimpan dan terkirim.";
  if (initialized && state.screen === "profile") render();
}
async function startScan() {
  if (state.unsaved) {
    state.failureReason =
      "Hasil terakhir belum tersimpan. Coba simpan kembali sebelum mengukur lagi.";
    go("measure-error");
    return;
  }
  if (!isAdult(state.profile.birth)) {
    go("profile");
    toast(
      "Perbarui tanggal lahir. DiaScale tersedia untuk usia 18 tahun ke atas.",
    );
    return;
  }
  state.devices = [];
  state.connected = false;
  state.failureReason = "";
  go("scan");
  const current = operation;
  try {
    const found = await scale.scan();
    if (current !== operation) return;
    state.devices = found;
    if (!found.length) go("notfound");
    else if (found.length === 1) await connect(found[0].id);
    else go("devices");
  } catch {
    if (current !== operation) return;
    state.failureReason =
      "Pencarian belum berhasil. Aktifkan Bluetooth, izinkan akses perangkat sekitar, dan tutup FitDays+ sebelum mencoba lagi.";
    go("connection-error");
  }
}
async function connect(id) {
  const device = state.devices.find((item) => item.id === id);
  if (!device) {
    await startScan();
    return;
  }
  state.device = device;
  state.connected = false;
  state.weightKg = null;
  state.failureReason = "";
  go("measuring");
  const current = operation;
  const profileSnapshot = toProfile();
  const lastWeight = state.history[0]?.weight ?? 50;
  await scale.measure(
    device,
    profileSnapshot,
    store.snapshot().userId,
    lastWeight,
    (event) => {
      if (current !== operation) return;
      if (event.type === "connected") {
        // Toggle the state in place, like the weight below.
        state.connected = true;
        document.querySelector(".measure")?.classList.add("connected");
      } else if (event.type === "live") {
        // Update the weight in place: re-rendering restarts the screen animations.
        state.weightKg = event.status === "off" ? null : event.grams / 1000;
        const weight = document.querySelector(".live-weight");
        if (weight) weight.textContent = weightText(state.weightKg);
      } else if (event.type === "failure") {
        state.failureReason = event.reason;
        go("measure-error");
      } else if (event.type === "result") {
        state.unsaved = event.measurement;
        void persistResult();
      }
    },
  );
}
async function persistResult() {
  if (!state.unsaved || state.busy) return;
  state.busy = true;
  // Disable in place: a re-render would restart the measuring screen's animations.
  document.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
  });
  try {
    await saveMeasurement(state.unsaved);
    state.unsaved = null;
    state.returnTo = "home";
    state.busy = false;
    go("result");
    syncStatus();
    void sync.flush();
  } catch {
    state.busy = false;
    state.failureReason =
      "Hasil belum dapat disimpan di perangkat. Sediakan ruang penyimpanan, lalu pilih Simpan kembali.";
    go("measure-error");
  }
}
async function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || state.busy || !initialized) return;
  const action = button.dataset.action;
  if (state.unsaved && ["signup", "login", "logout", "edit"].includes(action)) {
    state.failureReason =
      "Hasil terakhir belum tersimpan. Simpan kembali sebelum mengganti profil atau keluar.";
    go("measure-error");
    return;
  }
  switch (action) {
    case "signup":
    case "login":
      state.mode = action;
      state.editing = false;
      go("auth");
      break;
    case "scan":
      await startScan();
      break;
    case "connect":
      await connect(button.dataset.device);
      break;
    case "retry":
      await startScan();
      break;
    case "save-again":
      await persistResult();
      break;
    case "detail":
      state.selected = state.history.find(
        (row) => row.id === button.dataset.id,
      );
      state.returnTo = state.screen;
      go("result");
      break;
    case "period":
      state.period = button.dataset.period;
      render();
      break;
    case "edit":
      state.editing = true;
      go("personal");
      break;
    case "profile":
      if (state.editing) openAccount(state.phone);
      go("profile");
      break;
    case "logout":
      await clearAccount();
      go("welcome");
      break;
    default:
      if (screens[action]) go(action);
  }
}
document.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="reload"]')) {
    location.reload();
    return;
  }
  void handleClick(event).catch(() => {
    state.busy = false;
    toast(
      "Perubahan belum tersimpan. Periksa penyimpanan perangkat, lalu coba kembali.",
    );
  });
});
document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement)
    event.target.setCustomValidity("");
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!initialized || state.busy || !event.target.reportValidity()) return;
  void submit(event.target).catch(() => {
    state.busy = false;
    toast(
      "Perubahan belum tersimpan. Periksa penyimpanan perangkat, lalu coba kembali.",
    );
  });
});
async function submit(form) {
  const data = Object.fromEntries(new FormData(form));
  switch (form.id) {
    case "phone-form": {
      const phone = normalizePhone(data.phone);
      if (!/^[+\d ]+$/.test(data.phone) || !/^8\d{8,12}$/.test(phone)) {
        const input = form.querySelector('[name="phone"]');
        input.setCustomValidity(
          "Masukkan nomor HP yang valid, misalnya 81234567890.",
        );
        input.reportValidity();
        return;
      }
      if (openAccount(phone)) {
        await store.update((data) => {
          data.activePhone = phone;
        });
        go("home");
      } else if (state.mode === "login") {
        state.phone = phone;
        toast(
          "Belum ada profil dengan nomor ini di perangkat. Silakan daftar.",
        );
      } else {
        beginSignup(phone);
        go("personal");
      }
      break;
    }
    case "personal-form":
      if (!data.name.trim()) {
        form
          .querySelector('[name="name"]')
          .setCustomValidity("Isi nama lengkap Anda.");
        form.reportValidity();
        return;
      }
      if (!isAdult(data.birth)) {
        form
          .querySelector('[name="birth"]')
          .setCustomValidity("DiaScale tersedia untuk usia 18 tahun ke atas.");
        form.reportValidity();
        return;
      }
      Object.assign(state.profile, data);
      go("health");
      break;
    case "health-form": {
      Object.assign(state.profile, data);
      if (!isAdult(state.profile.birth)) {
        go("personal");
        return;
      }
      state.busy = true;
      render();
      await saveAccount();
      const editing = state.editing;
      state.editing = false;
      state.busy = false;
      go(editing ? "profile" : "home");
      if (editing) toast("Profil berhasil diperbarui.");
      break;
    }
  }
}
function back() {
  if (state.busy) return true;
  const button = document.querySelector(".page-top [data-action]");
  if (button) {
    button.click();
    return true;
  }
  if (state.screen === "home" || state.screen === "welcome") return false;
  go(
    ["auth", "personal", "health"].includes(state.screen) ? "welcome" : "home",
  );
  return true;
}
window.diascaleBack = back;
document.body.classList.add("no-tools");
if (Capacitor.isNativePlatform()) document.body.classList.add("native-app");
function fitCanvas() {
  const scale = Math.min(
    1,
    (window.innerHeight - 24) / 844,
    (window.innerWidth - (window.innerWidth <= 480 ? 0 : 48)) / 390,
  );
  document.documentElement.style.setProperty(
    "--phone-scale",
    Math.max(0.1, scale),
  );
}
window.addEventListener("resize", fitCanvas);
fitCanvas();
async function start() {
  document.getElementById("app").innerHTML =
    '<p role="status">Membuka data di perangkat…</p>';
  try {
    await store.load();
    initModel(store);
    sync = new SyncEngine(store, {
      url: import.meta.env.VITE_ARCHIVE_URL || "",
      online: () => navigator.onLine,
      changed: syncStatus,
    });
    syncStatus();
    initialized = true;
    render();
    sync.start();
    window.addEventListener("online", () => void sync.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void sync.flush();
      else if (["scan", "measuring"].includes(state.screen)) {
        state.failureReason =
          "Pengukuran dihentikan saat aplikasi ditutup. Buka aplikasi dan ulangi.";
        go("measure-error");
      }
    });
    if (Capacitor.isNativePlatform()) {
      await App.addListener("backButton", () => {
        if (!back()) void App.minimizeApp();
      });
      await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) void sync.flush();
        else if (["scan", "measuring"].includes(state.screen)) {
          state.failureReason =
            "Pengukuran dihentikan saat aplikasi ditutup. Buka aplikasi dan ulangi.";
          go("measure-error");
        }
      });
    }
  } catch {
    document.getElementById("app").innerHTML =
      '<main class="content"><h1>Data belum dapat dibuka.</h1><p>Data asli tetap disimpan. Periksa ruang penyimpanan dan konfigurasi aplikasi, lalu coba kembali.</p><button class="btn" data-action="reload">Coba kembali</button></main>';
  }
}
void start();
