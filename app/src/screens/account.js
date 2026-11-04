import { icon, logo, scaleArt } from "../ui/icons.js";
import { esc } from "../ui/format.js";
import { state, adultBirthMax } from "../model.js";
import { button, top, field } from "../ui/components.js";

export function welcome() {
  return `<header class="app-header">${logo()}<span class="eyebrow" style="font-size:8px">Kenali lebih awal</span></header><div class="auth-art">${scaleArt()}</div><div class="eyebrow" style="margin:30px 0 12px">Satu langkah untuk diri Anda</div><h1>Pahami risiko,<br>mulai dari data<br>tubuh Anda.</h1><p class="subheading" style="margin:17px 0 29px">Kenali dan pantau risiko diabetes tipe 2, dari rumah maupun rumah sakit.</p>${button("Buat akun", "signup")}<div style="height:11px"></div>${button("Sudah punya akun? Masuk", "login", "secondary", "")}<div class="privacy">${icon("shield")}Langkah sederhana. Kesehatan lebih terpantau.</div>`;
}

export function auth() {
  let signup = state.mode === "signup";
  return `${top(signup ? "Mulai langkah<br>sehat Anda." : "Selamat<br>datang kembali.", "welcome")}<p class="subheading">${signup ? "Daftar" : "Masuk"} dengan nomor HP Anda.</p><div class="auth-art">${icon("phone")}</div><form id="phone-form"><label class="field"><span class="field-label">Nomor HP</span><div class="input-wrap"><span class="prefix">+62</span><input class="phone-input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="812 3456 7890" value="${esc(state.phone)}" pattern="[0-9+ ]{8,18}" required></div></label><p class="small muted" style="margin-bottom:24px">Nomor HP digunakan untuk profil di perangkat ini, tanpa OTP.</p><button class="btn" type="submit">Lanjutkan ${icon("arrow")}</button></form><p class="auth-footer">${signup ? "Sudah punya akun?" : "Belum punya akun?"} <button class="text-btn" data-action="${signup ? "login" : "signup"}">${signup ? "Masuk" : "Daftar"}</button></p><div class="privacy">${icon("lock")}Informasi kesehatan Anda bersifat pribadi.</div>`;
}

export function personal() {
  return `${top(state.editing ? "Perbarui<br>data diri." : "Kenali Anda<br>lebih dekat.", state.editing ? "profile" : "auth", state.editing ? "" : "Langkah 1 dari 2")}<div class="steps" style="margin-top:22px"><span class="done"></span><span></span></div><p class="subheading">Data ini membantu melengkapi penilaian risiko Anda.</p><form id="personal-form">${field("Nama lengkap", "name", "text", "", "", 'autocomplete="name"').replace('value=""', `value="${esc(state.profile.name)}"`)}${field("Tanggal lahir", "birth", "date", "", state.profile.birth, `max="${adultBirthMax()}"`)}<div class="question"><fieldset><legend>Jenis kelamin</legend><div class="choices">${["Laki-laki", "Perempuan"].map((v) => `<label class="choice"><input type="radio" name="sex" value="${v}" required ${state.profile.sex === v ? "checked" : ""}><span>${v}</span></label>`).join("")}</div></fieldset></div>${field("Tinggi badan", "height", "number", "cm", state.profile.height, 'min="100" max="255" step="1" inputmode="numeric"')}<p class="small muted">DiaScale tersedia untuk usia 18 tahun ke atas.</p><button type="submit" class="btn">Lanjutkan ${icon("arrow")}</button></form>`;
}

export const questions = [
  ["meds", "Apakah Anda pernah atau sedang menggunakan obat antihipertensi?"],
  ["glucose", "Apakah Anda pernah memiliki hasil glukosa darah tinggi?"],
  ["family", "Apakah ada anggota keluarga yang memiliki diabetes?"],
];

export function health() {
  return `${top(state.editing ? "Perbarui riwayat<br>kesehatan." : "Sedikit tentang<br>kesehatan Anda.", "personal", state.editing ? "" : "Langkah 2 dari 2")}<div class="steps" style="margin-top:22px"><span class="done"></span><span class="done"></span></div><p class="subheading">Jawab sesuai kondisi yang Anda ketahui.</p><form id="health-form">${questions.map(([name, q]) => `<div class="question"><fieldset><legend>${q}</legend><div class="choices">${["Ya", "Tidak"].map((v) => `<label class="choice"><input type="radio" name="${name}" value="${v}" required ${state.profile[name] === v ? "checked" : ""}><span>${v}</span></label>`).join("")}</div></fieldset></div>`).join("")}<div class="form-actions"><button class="btn" type="submit">${state.editing ? "Simpan perubahan" : "Selesaikan pendaftaran"} ${icon("check")}</button></div></form>`;
}
