import { icon } from "../ui/icons.js";
import { esc } from "../ui/format.js";
import { state } from "../model.js";
import { button, top } from "../ui/components.js";

export function scan() {
  return `${top("Hubungkan<br>DiaScale.")}<p class="subheading">Pastikan Bluetooth aktif, FitDays+ ditutup, dan Anda berada di dekat timbangan.</p><div class="scan-center"><div class="scan-orbit">${icon("bluetooth")}</div><h2>Mencari timbangan…</h2><p>Mencari LUCA VOSS FG2504WB di sekitar Anda.</p></div>`;
}
export function devices() {
  return `${top("Pilih timbangan.")}<p class="subheading">Pilih timbangan yang akan digunakan.</p><div class="section-head"><h2>Perangkat di sekitar</h2><span class="small muted">${state.devices.length} ditemukan</span></div>${state.devices.map((device) => `<button class="device" data-action="connect" data-device="${esc(device.id)}"><div class="icon-box">${icon("scale")}</div><div class="device-info"><h3>${esc(device.name)}</h3><p>${esc(device.id)} · ${device.rssi} dBm</p></div>${icon("chevron")}</button>`).join("")}<div class="form-actions">${button("Cari ulang", "scan", "secondary", "bluetooth")}</div>`;
}
export function measuring() {
  const titles = [
    "Menghubungkan…",
    "Timbangan siap.",
    "Sedang menimbang…",
    "Pegang gagang.",
    "Menyimpan hasil…",
  ];
  const desc = [
    "Menghubungkan HP dengan timbangan pilihan Anda.",
    "Lepas alas kaki, naik ke timbangan, lalu pegang gagang dengan kedua tangan.",
    "Tetap diam dan pegang gagang dengan kedua tangan.",
    "Berat sudah stabil. Tetap pegang gagang sampai pembacaan tubuh selesai.",
    "Pengukuran selesai. Hasil sedang disimpan di perangkat.",
  ];
  return `${top("Pengukuran.")}<p class="subheading">${esc(state.device?.name || "FG2504WB")} <span class="badge blue">${state.stage ? "Terhubung" : "Menghubungkan"}</span></p><div class="scan-center" aria-live="polite"><div class="scan-orbit">${icon(state.stage >= 2 ? "activity" : "scale")}</div><h2>${titles[state.stage]}</h2><p>${desc[state.stage]}</p>${state.weightKg !== null ? `<p class="live-weight">${state.weightKg.toFixed(1).replace(".", ",")} kg</p>` : ""}</div>${state.stage >= 2 ? '<div class="progress"><span></span></div>' : ""}${["Hubungkan perangkat", "Naik tanpa alas kaki", "Pegang gagang & tetap diam", "Terima hasil"].map((label, i) => `<div class="measure-stage ${i === Math.min(state.stage, 3) ? "active" : i < state.stage ? "complete" : ""}"><span class="stage-number">${i < state.stage ? icon("check") : i + 1}</span>${label}</div>`).join("")}<button class="text-btn" data-action="home" style="width:100%;margin-top:17px">Batalkan pengukuran</button>`;
}
export function errorScreen() {
  const missing = state.screen === "notfound";
  return `${top(missing ? "Belum menemukan<br>timbangan." : "Pengukuran<br>belum berhasil.")}<div class="scan-center"><div class="scan-orbit">${icon(missing ? "bluetooth" : "scale")}</div><h2>${state.unsaved ? "Hasil belum tersimpan" : "Coba sekali lagi"}</h2><p>${esc(state.failureReason || (missing ? "Pastikan timbangan menyala, Bluetooth aktif, dan HP berada di dekat timbangan." : "Turun dari timbangan, lalu ulangi tanpa alas kaki dan pegang gagang."))}</p></div>${button(state.unsaved ? "Simpan kembali" : "Ulangi", state.unsaved ? "save-again" : "scan")}<div style="height:12px"></div>${button("Kembali ke beranda", "home", "secondary", "")}`;
}
