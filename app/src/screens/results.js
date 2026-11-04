import { icon } from "../ui/icons.js";
import { esc, dateText } from "../ui/format.js";
import { riskStyle, state } from "../model.js";
import { button, top, metrics } from "../ui/components.js";

export function result() {
  const r = state.selected || state.history[0];
  if (!r)
    return `<div class="empty"><h2>Belum ada hasil</h2>${button("Mulai pengukuran", "scan")}</div>`;
  return `${top("Rincian risiko.", state.returnTo || "home", dateText(r.date))}<p class="subheading">DiaScale ${esc(r.device)} · ${new Date(r.date).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</p><section class="score-panel"><div class="eyebrow">Risiko diabetes melitus tipe 2</div><div class="score-main"><div><p class="small muted">Kategori risiko Anda</p><h2>${r.risk}</h2><span class="badge">${r.risk === "Aman" ? "Pantau secara berkala" : "Perlu perhatian"}</span></div><div class="score-circle" style="--risk-score:${r.score}%"><span>${r.score}<small>dari 100</small></span></div></div><div class="risk-track" style="--risk-position:${r.score}%"></div><div class="track-labels"><span>Aman</span><span>Meningkat</span><span>Waspada</span></div></section><section class="risk-contributions risk-style-${riskStyle}" aria-labelledby="contributions-title"><h2 id="contributions-title">Rincian kontribusi risiko</h2><table class="contribution-table"><thead><tr><th scope="col">Faktor</th><th scope="col">Hasil</th><th scope="col">Poin</th></tr></thead><tbody>${r.contributions
    .map(
      ({ label, value, points }) =>
        `<tr><th scope="row">${label}</th><td>${esc(value)}</td><td><span class="point-chip ${points > 0 ? "point-risk" : "point-neutral"}">${points > 0 ? "+" : ""}${points}</span></td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></section><div class="section-head"><h2>Data pengukuran pendukung</h2></div><div class="result-card measurement-summary">${metrics(r)}</div><div class="section-head"><h2>Data kesehatan saat pengukuran</h2></div><div class="factor"><span>Lingkar pinggang</span><span>${r.raw.waistCm.toFixed(1).replace(".", ",")} cm</span></div><div class="factor"><span>Riwayat diabetes keluarga</span><span>${esc(r.profile.family)}</span></div><div class="factor"><span>Riwayat glukosa darah tinggi</span><span>${esc(r.profile.glucose)}</span></div><div class="factor"><span>Penggunaan obat antihipertensi</span><span>${esc(r.profile.meds)}</span></div><div class="form-actions">${button("Lihat riwayat risiko", "history", "secondary", "history")}</div><div class="privacy">${icon("check")}Hasil tersimpan di riwayat Anda.</div>`;
}
