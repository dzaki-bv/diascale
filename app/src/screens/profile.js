import { esc, dateText } from "../ui/format.js";
import { state } from "../model.js";
import { initials, button, header } from "../ui/components.js";

export function profile() {
  return `${header()}<div class="heading-row"><h1>Profil Anda.</h1><button class="text-btn" data-action="edit">Edit profil</button></div><div class="profile-head"><div class="avatar">${esc(initials())}</div><h2>${esc(state.profile.name || "Pengguna DiaScale")}</h2><p class="small muted">+62 ${esc(state.phone || "812 3456 7890")}</p></div><div class="section-head"><h2>Data diri</h2></div>${[
    [
      "Tanggal lahir",
      state.profile.birth ? dateText(state.profile.birth) : "—",
    ],
    ["Jenis kelamin", state.profile.sex || "—"],
    ["Tinggi badan", `${state.profile.height} cm`],
    ["Lingkar pinggang", `${state.profile.waist} cm`],
  ]
    .map(
      ([a, b]) =>
        `<div class="profile-row"><span>${a}</span><span>${esc(b)}</span></div>`,
    )
    .join("")}<div class="section-head"><h2>Riwayat kesehatan</h2></div>${[
    ["Obat antihipertensi", state.profile.meds],
    ["Glukosa darah tinggi", state.profile.glucose],
    ["Diabetes dalam keluarga", state.profile.family],
  ]
    .map(
      ([a, b]) =>
        `<div class="profile-row"><span>${a}</span><span>${esc(b)}</span></div>`,
    )
    .join(
      "",
    )}<div class="form-actions">${button("Keluar dari akun", "logout", "secondary", "logout")}</div>`;
}
