import { icon } from "../ui/icons.js";
import { esc, dateText } from "../ui/format.js";
import { state } from "../model.js";
import { button, header, metrics } from "../ui/components.js";

export const homeDetail = (r) =>
  r
    ? `<button class="text-btn" data-action="detail" data-id="${esc(r.id)}">Lihat hasil lengkap ${icon("chevron")}</button>`
    : "";

export const homeStamp = (r) =>
  r ? `Terakhir diukur · ${dateText(r.date)}` : "Belum ada pengukuran";

export function riskTrend() {
  const records = state.history.slice(0, 6).reverse();
  const heading = `<div class="section-head"><h2>Riwayat risiko</h2><button class="text-btn" data-action="history">Lihat riwayat</button></div>`;
  if (!records.length)
    return `${heading}<section class="risk-trend-card"><div class="trend-empty"><div class="icon-box">${icon("activity")}</div><h3>Mulai pantau risiko Anda</h3><p>Skor risiko setiap pengukuran akan tercatat di sini setelah Anda menimbang.</p></div></section>`;
  const firstNumber = state.history.length - records.length + 1;
  const points = records.map((r, i) => ({
    x: 30 + (records.length === 1 ? 130 : (i * 270) / (records.length - 1)),
    y: 125 - r.score,
    record: r,
    number: firstNumber + i,
  }));
  return `${heading}<section class="risk-trend-card" aria-label="Riwayat skor risiko diabetes tipe 2"><svg class="risk-chart" viewBox="0 0 320 152" role="img" aria-label="Skor risiko berdasarkan urutan pengukuran: ${points.map((p) => `pengukuran ${p.number}, skor ${p.record.score}`).join("; ")}"><defs><linearGradient id="risk-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a9cfdb" stop-opacity=".45"/><stop offset="1" stop-color="#edf5f7" stop-opacity=".1"/></linearGradient></defs>${[0, 50, 100].map((score) => `<path d="M30 ${125 - score}H307" stroke="#e7eff1" stroke-dasharray="3 4"/><text x="0" y="${129 - score}">${score}</text>`).join("")}${points.length > 1 ? `<path d="M${points.map((p) => `${p.x},${p.y}`).join(" L")} L${points.at(-1).x},125 L${points[0].x},125Z" fill="url(#risk-fill)"/><path d="M${points.map((p) => `${p.x},${p.y}`).join(" L")}" fill="none" stroke="#4e96ae" stroke-width="2.5" stroke-linejoin="round"/>` : ""}${points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="white" stroke="#4e96ae" stroke-width="2"><title>${dateText(p.record.date)} · Skor ${p.record.score}</title></circle><text class="risk-point-value" x="${p.x}" y="${p.y - 12}" text-anchor="middle">${p.record.score}</text><text x="${p.x}" y="145" text-anchor="middle">${String(new Date(p.record.date).getDate()).padStart(2, "0")}/${String(new Date(p.record.date).getMonth() + 1).padStart(2, "0")}</text>`).join("")}</svg>${records.length === 1 ? '<p class="trend-note">Lakukan pengukuran berikutnya untuk melihat perubahan skor risiko.</p>' : ""}</section>`;
}

export function VariantA(r) {
  return `<section class="combined-card clinical-card" aria-label="Risiko dan pengukuran"><p class="risk-title">Risiko diabetes tipe 2</p>${r ? `<div class="combined-risk"><h2>Risiko ${r.risk.toLowerCase()}</h2><span class="badge">${r.score} / 100</span></div><div class="risk-track" style="--risk-position:${r.score}%"></div><div class="track-labels"><span>Aman</span><span>Meningkat</span><span>Waspada</span></div>${metrics(r)}` : `<h2 class="first-title">Kenali risiko Anda,<br>mulai dari sini.</h2><p class="combined-description">Lakukan pengukuran pertama untuk mengetahui risiko diabetes tipe 2 Anda.</p>`}<div class="combined-action"><p class="measurement-stamp">${r ? icon("clock") : icon("scale")}${homeStamp(r)}</p>${button(r ? "Ukur kembali" : "Ukur sekarang", "scan")}${homeDetail(r)}</div></section>${riskTrend()}`;
}

export function home() {
  return `${header()}<p class="greeting">${new Date().getHours() < 11 ? "Selamat pagi" : "Halo"}, ${esc(state.profile.name.split(" ")[0] || "Anda")}</p><h1>Kenali risiko.<br>Pantau perubahannya.</h1>${VariantA(state.history[0])}`;
}
