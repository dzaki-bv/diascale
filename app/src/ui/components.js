import { icon, logo } from "./icons.js";
import { esc } from "./format.js";
import { state } from "../model.js";

export const initials = () =>
  state.profile.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("") || "DS";

export const button = (text, action, style = "", ico = "arrow") =>
  `<button type="button" class="btn ${style}" data-action="${action}">${text}${ico ? icon(ico) : ""}</button>`;

export const back = (action = "home") =>
  `<button class="back" data-action="${action}" aria-label="Kembali">${icon("back")}</button>`;

export const header = () =>
  `<header class="app-header">${logo()}<button class="avatar" data-action="profile" aria-label="Buka profil">${esc(initials())}</button></header>`;

export const top = (title, action = "home", right = "") =>
  `<div class="page-top">${back(action)}<span>${right}</span></div><h1>${title}</h1>`;

export const field = (
  label,
  name,
  type = "text",
  unit = "",
  value = state.profile[name],
  extra = "",
) =>
  `<label class="field"><span class="field-label">${label}</span><div class="input-wrap"><input name="${name}" type="${type}" value="${esc(value)}" ${unit ? 'class="with-unit"' : ""} required ${extra}>${unit ? `<span class="unit">${unit}</span>` : ""}</div></label>`;

export function nav() {
  return `<nav class="bottom-nav" aria-label="Navigasi utama">${[
    ["home", "Beranda"],
    ["history", "Riwayat"],
    ["profile", "Profil"],
  ]
    .map(
      ([key, label]) =>
        `<button class="nav-item ${state.screen === key ? "active" : ""}" data-action="${key}" ${state.screen === key ? 'aria-current="page"' : ""}>${icon(key === "profile" ? "user" : key)}${label}</button>`,
    )
    .join("")}</nav>`;
}

export function metrics(record) {
  const n = record.raw.numbers;
  const rows = [
    ["Indeks massa tubuh", n.bmi, "kg/m²"],
    ["Massa lemak", n.fatMassKg, "kg"],
    ["Lemak viseral", n.visceral, "cm²"],
    ["Massa otot", n.muscleKg, "kg"],
  ];
  return `<div class="metrics">${rows.map(([label, value, unit]) => `<div><div class="metric-label">${label}</div><div class="metric-value">${value.toFixed(1).replace(".", ",")}<small>${unit}</small></div></div>`).join("")}</div>`;
}
