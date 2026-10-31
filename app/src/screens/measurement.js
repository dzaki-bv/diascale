import { icon } from "../ui/icons.js";
import { esc } from "../ui/format.js";
import { state } from "../model.js";
import { button, top } from "../ui/components.js";

export function scan() {
  return `${top("Hubungkan<br>DiaScale.")}<p class="subheading">Pastikan Bluetooth aktif dan Anda berada di dekat timbangan.</p><div class="scan-center"><div class="scan-orbit">${icon("bluetooth")}</div><h2>Mencari timbangan…</h2><p>Menemukan perangkat DiaScale di sekitar Anda.</p></div>`;
}

export function devices() {
  return `${top("Pilih timbangan.")}<p class="subheading">Cocokkan nomor unit di aplikasi dengan nomor pada timbangan yang akan digunakan.</p><div class="section-head"><h2>Perangkat di sekitar</h2><span class="small muted">3 ditemukan</span></div>${["DS-001", "DS-008", "DS-012"].map((id, i) => `<button class="device" data-action="connect" data-device="${id}"><div class="icon-box">${icon("scale")}</div><div class="device-info"><h3>DiaScale ${id}</h3><p>Unit ${id.slice(3)} · ${i === 0 ? "Sinyal kuat" : i === 1 ? "Sinyal sedang" : "Sinyal lemah"}</p></div>${icon("signal")}${icon("chevron")}</button>`).join("")}<div class="notice">Gunakan timbangan yang kosong dan siap digunakan.</div><div class="form-actions">${button("Cari ulang", "scan", "secondary", "bluetooth")}</div>`;
}

export function measuring() {
  let titles = [
    "Menghubungkan…",
    "Timbangan siap.",
    "Sedang mengukur…",
    "Menyiapkan hasil…",
  ];
  let desc = [
    "Menghubungkan HP dengan timbangan pilihan Anda.",
    "Silakan lepas alas kaki, lalu naik ke timbangan.",
    "Berdiri tegak dan tetap diam hingga pengukuran selesai.",
    "Pengukuran selesai. Tunggu sebentar untuk melihat hasil Anda.",
  ];
  return `${top("Pengukuran.")}<p class="subheading">DiaScale ${esc(state.device)} <span class="badge blue" style="margin-left:7px">${state.stage ? "Terhubung" : "Menghubungkan"}</span></p><div class="scan-center" aria-live="polite"><div class="scan-orbit">${state.stage === 2 ? icon("activity") : icon("scale")}</div><h2>${titles[state.stage]}</h2><p>${desc[state.stage]}</p></div>${state.stage === 2 || state.stage === 3 ? '<div class="progress"><span></span></div>' : ""}${["Hubungkan perangkat", "Naik ke timbangan", "Ukur & tetap diam", "Terima hasil"].map((x, i) => `<div class="measure-stage ${i === state.stage ? "active" : i < state.stage ? "complete" : ""}"><span class="stage-number">${i < state.stage ? icon("check") : i + 1}</span>${x}</div>`).join("")}<button class="text-btn" data-action="home" style="width:100%;margin-top:17px">Batalkan pengukuran</button>`;
}

export function errorScreen() {
  let missing = state.screen === "notfound",
    connection = state.screen === "connection-error";
  return `${top(missing ? "Belum menemukan<br>timbangan." : connection ? "Koneksi terputus." : "Pengukuran<br>belum berhasil.")}<div class="scan-center"><div class="scan-orbit">${icon(missing ? "bluetooth" : connection ? "wifi" : "scale")}</div><h2>${missing ? "Coba dekatkan HP Anda" : connection ? "Mari hubungkan kembali" : "Coba sekali lagi"}</h2><p>${missing ? "Pastikan timbangan menyala, Bluetooth aktif, dan unit berada di dekat Anda." : connection ? "Pastikan HP tetap berada di dekat timbangan dan perangkat masih menyala." : "Turun dari timbangan, tunggu hingga siap, lalu naik kembali dan berdiri diam."}</p></div>${button(missing ? "Cari ulang" : "Coba lagi", missing ? "scan" : "retry")}<div style="height:12px"></div>${button("Kembali ke beranda", "home", "secondary", "")}`;
}
