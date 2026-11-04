import { icon } from "../ui/icons.js";
import { dateText, esc } from "../ui/format.js";
import { state } from "../model.js";
import { button, header } from "../ui/components.js";

export function chart(records) {
  let chronological = [...records].reverse(),
    scores = chronological.map((r) => r.score),
    low = 0,
    high = 100,
    range = 100;
  let pts = chronological.map((r, i) => [
    30 +
      (chronological.length === 1
        ? 125
        : (i * 260) / (chronological.length - 1)),
    105 - ((r.score - low) / range) * 80,
  ]);
  return `<svg class="chart" viewBox="0 0 320 140" role="img" aria-label="Grafik skor risiko diabetes tipe 2 dari ${scores[0]} ke ${scores.at(-1)} dari 100"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#c2dfe8" stop-opacity=".65"/><stop offset="1" stop-color="#f8fbfc" stop-opacity=".2"/></linearGradient></defs>${[0, 1, 2].map((n) => `<path d="M30 ${25 + n * 40}H305" stroke="#edf1f2" stroke-dasharray="3 4"/><text x="0" y="${29 + n * 40}">${(high - (n * range) / 2).toFixed(0)}</text>`).join("")}<path d="M${pts.map((p) => p.join(",")).join(" L")} L${pts.at(-1)[0]},113 L${pts[0][0]},113Z" fill="url(#chart-fill)"/><path d="M${pts.map((p) => p.join(",")).join(" L")}" stroke="#4e96ae" stroke-width="2.5" fill="none"/>${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="4" fill="white" stroke="#4e96ae" stroke-width="2"/><text x="${x}" y="135" text-anchor="middle">${String(new Date(chronological[i].date).getDate()).padStart(2, "0")}/${String(new Date(chronological[i].date).getMonth() + 1).padStart(2, "0")}</text>`).join("")}</svg>`;
}

export function history() {
  const records = state.history.filter(
    (r) =>
      state.period === "all" ||
      new Date(r.date) >=
        new Date(
          new Date().getTime() - (state.period === "week" ? 7 : 31) * 86400000,
        ),
  );
  return `${header()}<h1>Riwayat risiko.</h1><p class="subheading">Pantau perubahan risiko diabetes tipe 2 dari setiap pengukuran.</p><div class="filter-tabs" aria-label="Rentang waktu">${[
    ["week", "7 hari"],
    ["month", "30 hari"],
    ["all", "Semua"],
  ]
    .map(
      ([v, t]) =>
        `<button data-action="period" data-period="${v}" class="${state.period === v ? "active" : ""}" aria-pressed="${state.period === v}">${t}</button>`,
    )
    .join(
      "",
    )}</div>${records.length ? `<section class="chart-card"><div class="heading-row"><h2 style="font-size:13px">Perubahan skor risiko</h2><span class="small muted">0–100</span></div><div class="history-summary"><strong>${records[0].score}</strong><span>/ 100 · skor risiko terbaru</span></div>${chart(records)}</section><div class="section-head"><h2>Semua hasil penilaian risiko</h2><span class="small muted">${records.length} hasil</span></div>${records.map((r) => `<button class="history-item" data-action="detail" data-id="${esc(r.id)}"><div class="history-info"><h3>${dateText(r.date)}</h3><p>Risiko ${r.risk.toLowerCase()}</p></div><div class="history-value"><b>${r.score} <small>/ 100</small></b><p>Skor risiko</p></div>${icon("chevron")}</button>`).join("")}` : `<div class="empty"><div class="icon-box">${icon("history")}</div><h2>${state.history.length ? "Belum ada hasil di periode ini" : "Perjalanan Anda dimulai di sini"}</h2><p>${state.history.length ? "Pilih rentang waktu yang lebih panjang untuk melihat pengukuran sebelumnya." : "Lakukan pengukuran pertama untuk mulai memantau risiko diabetes tipe 2 Anda."}</p>${button("Ukur sekarang", "scan")}</div>`}`;
}
