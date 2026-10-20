import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";
import { icon, logo } from "./ui/icons.js";
import { esc } from "./ui/format.js";
import {
  params,
  variant,
  sampleProfile,
  state,
  demoHistory,
  createExampleRecord,
  normalizePhone,
  saveAccount,
  clearAccount,
  openAccount,
} from "./model.js";
import { nav } from "./ui/components.js";
import { home } from "./screens/home.js";
import { welcome, auth, otp, personal, health } from "./screens/account.js";
import {
  scan,
  devices,
  measuring,
  errorScreen,
} from "./screens/measurement.js";
import { result } from "./screens/results.js";
import { history } from "./screens/history.js";
import { profile } from "./screens/profile.js";

let timers = [];

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function later(fn, ms) {
  timers.push(setTimeout(fn, ms));
}

function go(screen) {
  clearTimers();
  state.screen = screen;
  render();
  document.querySelector(".screen")?.scrollTo(0, 0);
}

function toast(message) {
  state.toast = message;
  render();
  later(() => {
    state.toast = "";
    render();
  }, 2400);
}

const screens = {
  welcome,
  auth,
  otp,
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

function pagePicker() {
  const pages = [
    ["welcome", "Halaman awal"],
    ["auth", "Masuk / daftar"],
    ["otp", "Verifikasi OTP"],
    ["personal", "Data diri"],
    ["health", "Riwayat kesehatan"],
    ["home", "Beranda"],
    ["devices", "Pilih timbangan"],
    ["scan-single", "Cari · 1 timbangan"],
    ["scan-multiple", "Cari · beberapa timbangan"],
    ["scan-none", "Cari · tidak ditemukan"],
    ["measuring", "Pengukuran"],
    ["result", "Rincian risiko"],
    ["history", "Riwayat risiko"],
    ["profile", "Profil"],
    ["notfound", "Timbangan tidak ditemukan"],
    ["connection-error", "Koneksi terputus"],
    ["measure-error", "Pengukuran gagal"],
  ];
  return `<div class="page-picker"><label for="page-jump">Halaman</label><select id="page-jump">${pages.map(([key, label]) => `<option value="${key}" ${state.screen === key ? "selected" : ""}>${label}</option>`).join("")}</select></div>`;
}

function render() {
  let s = screens[state.screen] ? state.screen : "welcome";
  const authenticated = ["home", "history", "profile", "result"].includes(s);
  document.getElementById("app").innerHTML =
    `<div class="shell"><aside class="identity">${logo()}<div class="intro"><div class="eyebrow">Kenali tubuh. Pahami risiko.</div><h1>Langkah kecil.<br><em>Makna besar</em><br>untuk kesehatan.</h1><div class="intro-rule"></div><p>Kenali risiko diabetes tipe 2 melalui data tubuh Anda. Mulai kebiasaan baik, satu pengukuran setiap waktu.</p></div><div class="intro-bottom"><span>${icon("shield")}Personal untuk Anda</span><span>${icon("activity")}Terpantau dari waktu ke waktu</span></div></aside><section class="phone variant-${variant.toLowerCase()}" data-screen="${s}" aria-label="Aplikasi DiaScale"><div class="statusbar"><span>9:41</span><span class="status-icons">${icon("signal")}${icon("wifi")}${icon("battery")}</span></div><main class="screen ${authenticated ? "" : "auth-view"}"><div class="content">${screens[s]()}</div></main>${authenticated ? nav() : ""}${state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : ""}<div class="home-indicator"></div></section></div>${pagePicker()}`;
}

function startScan() {
  go("scan");
  later(() => {
    if (state.scenario === "none") go("notfound");
    else if (state.scenario === "single") connect("DS-001");
    else go("devices");
  }, 1800);
}

function connect(device) {
  state.device = device;
  state.stage = 0;
  go("measuring");
  later(() => {
    if (state.failure === "connection") {
      state.failure = "none";
      go("connection-error");
      return;
    }
    state.stage = 1;
    render();
    later(() => {
      state.stage = 2;
      render();
      later(() => {
        if (state.failure === "measurement") {
          state.failure = "none";
          go("measure-error");
          return;
        }
        state.stage = 3;
        render();
        later(finishMeasurement, 1800);
      }, 3200);
    }, 3200);
  }, 1500);
}

function finishMeasurement() {
  const record = createExampleRecord(state.profile, state.device);
  state.history.unshift(record);
  state.selected = record;
  state.returnTo = "home";
  saveAccount();
  go("result");
}

document.addEventListener("click", (e) => {
  let b = e.target.closest("[data-action]");
  if (!b) return;
  let action = b.dataset.action;
  switch (action) {
    case "signup":
    case "login":
      saveAccount();
      clearAccount();
      state.mode = action;
      go("auth");
      break;
    case "scan":
      startScan();
      break;
    case "connect":
      connect(b.dataset.device);
      break;
    case "retry":
      connect(state.device);
      break;
    case "resend":
      state.otpSentAt = Date.now();
      toast("Kode verifikasi telah dikirim ulang.");
      break;
    case "detail":
      state.selected = state.history.find((r) => r.id === Number(b.dataset.id));
      state.returnTo = state.screen;
      go("result");
      break;
    case "period":
      state.period = b.dataset.period;
      render();
      break;
    case "edit":
      state.editing = true;
      go("personal");
      break;
    case "logout":
      saveAccount();
      clearAccount();
      go("welcome");
      break;
    default:
      if (screens[action]) go(action);
  }
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  let data = Object.fromEntries(new FormData(e.target));
  switch (e.target.id) {
    case "phone-form":
      state.phone = normalizePhone(data.phone);
      state.otpSentAt = Date.now();
      go("otp");
      break;
    case "otp-form":
      openAccount(state.phone, state.mode);
      go(state.mode === "login" ? "home" : "personal");
      break;
    case "personal-form":
      Object.assign(state.profile, data);
      go("health");
      break;
    case "health-form":
      Object.assign(state.profile, data);
      let editing = state.editing;
      state.editing = false;
      saveAccount();
      go(editing ? "profile" : "home");
      if (editing) toast("Profil berhasil diperbarui.");
      break;
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "page-jump") return;
  const screen = e.target.value;
  if (!state.profile.name) {
    state.profile = { ...sampleProfile };
    state.phone = "812 3456 7890";
  }
  if (["result", "history"].includes(screen) && !state.history.length)
    state.history = demoHistory();
  if (screen.startsWith("scan-")) {
    state.scenario = screen.slice(5);
    startScan();
    return;
  }
  if (screen === "result") {
    state.selected = state.history[0];
    state.returnTo = "home";
  }
  if (screen === "measuring") {
    connect(state.device);
    return;
  }
  go(screen);
});

if (params.get("demo") === "1") {
  state.profile = { ...sampleProfile };
  state.phone = "812 3456 7890";
  state.history = demoHistory();
  state.screen = params.get("screen") === "result" ? "result" : "home";
}

document.body.classList.add("no-tools");
if (params.get("native") === "1") document.body.classList.add("native-app");

render();

function fitCanvas() {
  const mobile = window.innerWidth <= 480;
  const reserved = mobile ? 60 : 24;
  const scale = Math.min(
    1,
    (window.innerHeight - reserved) / 844,
    (window.innerWidth - (mobile ? 0 : 48)) / 390,
  );
  document.documentElement.style.setProperty(
    "--phone-scale",
    Math.max(0.1, scale),
  );
}

window.addEventListener("resize", fitCanvas);

fitCanvas();

window.diascaleBack = () => {
  const backButton = document.querySelector(".page-top [data-action]");
  if (backButton instanceof HTMLButtonElement) {
    backButton.click();
    return true;
  }
  if (state.screen === "home" || state.screen === "welcome") return false;
  go(
    ["auth", "otp", "personal", "health"].includes(state.screen)
      ? "welcome"
      : "home",
  );
  return true;
};
