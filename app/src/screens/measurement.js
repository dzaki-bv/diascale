import { icon } from "../ui/icons.js";
import { esc } from "../ui/format.js";
import { state } from "../model.js";
import { button, top } from "../ui/components.js";

/** Scan, connect, weighing and saving share one screen so nothing flickers between steps. */
export function weightText(kg) {
  return kg === null ? "\u00a0" : `${kg.toFixed(1).replace(".", ",")} kg`;
}
/** Both states are in the markup; toggling `.connected` switches them without rebuilding the screen. */
export function measuring() {
  return `${top("Pengukuran.")}<div class="measure${state.connected ? " connected" : ""}"><p class="subheading">Pastikan Bluetooth aktif. <span class="badge muted when-searching">Belum terhubung</span><span class="badge blue when-connected">${icon("check")}Terhubung</span></p><div class="scan-center" aria-live="polite"><div class="scan-orbit"><span class="when-searching">${icon("bluetooth")}</span><span class="when-connected">${icon("scale")}</span></div><div class="when-searching"><h2>Mencari timbangan…</h2><p>Lepas alas kaki dan naik ke timbangan agar menyala. HP akan tersambung otomatis.</p></div><div class="when-connected"><h2>Sedang mengukur…</h2><p>Tetap diam dan pegang gagang dengan kedua tangan sampai hasil muncul.</p></div><p class="live-weight">${weightText(state.weightKg)}</p></div></div><button class="text-btn" data-action="home" style="width:100%;margin-top:17px">Batalkan pengukuran</button>`;
}
export const scan = measuring;
export function devices() {
  return `${top("Pilih timbangan.")}<p class="subheading">Pilih timbangan yang akan digunakan.</p><div class="section-head"><h2>Perangkat di sekitar</h2><span class="small muted">${state.devices.length} ditemukan</span></div>${state.devices.map((device) => `<button class="device" data-action="connect" data-device="${esc(device.id)}"><div class="icon-box">${icon("scale")}</div><div class="device-info"><h3>${esc(device.name)}</h3><p>${esc(device.id)} · ${device.rssi} dBm</p></div>${icon("chevron")}</button>`).join("")}<div class="form-actions">${button("Cari ulang", "scan", "secondary", "bluetooth")}</div>`;
}
export function errorScreen() {
  const missing = state.screen === "notfound";
  return `${top(missing ? "Belum menemukan<br>timbangan." : "Pengukuran<br>belum berhasil.")}<div class="scan-center"><div class="scan-orbit">${icon(missing ? "bluetooth" : "scale")}</div><h2>${state.unsaved ? "Hasil belum tersimpan" : "Coba sekali lagi"}</h2><p>${esc(state.failureReason || (missing ? "Naik ke timbangan agar menyala, pastikan Bluetooth aktif, dan HP berada di dekat timbangan." : "Turun dari timbangan, lalu ulangi tanpa alas kaki dan pegang gagang."))}</p></div>${button(state.unsaved ? "Simpan kembali" : "Ulangi", state.unsaved ? "save-again" : "scan")}<div style="height:12px"></div>${button("Kembali ke beranda", "home", "secondary", "")}`;
}
