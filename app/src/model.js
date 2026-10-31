export const params = new URLSearchParams(location.search);
export const riskStyle = "porcelain";
export const variant = "A";

export const sampleProfile = {
  name: "Nadia Putri",
  birth: "1992-05-14",
  sex: "Perempuan",
  height: "162",
  waist: "84",
  meds: "Tidak",
  glucose: "Tidak",
  family: "Ya",
};

export function emptyProfile() {
  return {
    name: "",
    birth: "",
    sex: "",
    height: "",
    waist: "",
    meds: "",
    glucose: "",
    family: "",
  };
}

export const state = {
  screen: params.get("screen") || "welcome",
  mode: "signup",
  phone: "",
  profile: emptyProfile(),
  history: [],
  selected: null,
  returnTo: "home",
  device: "DS-001",
  scenario: "multiple",
  failure: "none",
  period: "month",
  stage: 0,
  editing: false,
  toast: "",
  otpSentAt: 0,
};

// Scale visceral fat level (1–20) to its share of the risk score (max 40 points).
// Cut-offs per sex best reproduce the paper's waist-based visceral points on NHANES.
const visceralCutoffs = {
  "Laki-laki": [6, 7, 9, 11],
  Perempuan: [10, 12, 14, 16],
};
export function visceralPoints(level, sex) {
  const cutoffs = visceralCutoffs[sex];
  if (!cutoffs) throw new Error(`Jenis kelamin tidak dikenal: ${sex}`);
  return [0, 10, 20, 30, 40][cutoffs.filter((cut) => level >= cut).length];
}

// These are coherent example fixtures, not a diabetes risk calculation.
// Contributions are captured with each result rather than rebuilt from the current profile.
export function createExampleRecord(profile, device, options = {}) {
  const weight = options.weight ?? 64.2;
  const bmi = +(weight / ((Number(profile.height) || 162) / 100) ** 2).toFixed(
    1,
  );
  const visceralLevel = options.visceralLevel ?? 14;
  const contributions = [
    {
      label: "Lemak viseral",
      value: `${visceralLevel} level`,
      points: visceralPoints(visceralLevel, profile.sex),
    },
    { label: "Persentase lemak", value: "28,4%", points: 1 },
    {
      label: "BMI",
      value: `${bmi.toFixed(1).replace(".", ",")} kg/m²`,
      points: 20,
    },
    { label: "Massa otot", value: "24,1 kg", points: 0 },
    {
      label: "Obat antihipertensi",
      value: profile.meds,
      points: profile.meds === "Ya" ? 5 : 0,
    },
  ];
  return {
    id: options.id ?? Date.now(),
    date: options.date ?? new Date(),
    weight,
    bmi,
    risk: "Sedang",
    score: contributions.reduce((total, row) => total + row.points, 0),
    device,
    profile: { ...profile },
    contributions,
  };
}

export function demoHistory() {
  return [0, 1, 2, 3].map((index) => {
    const date = new Date();
    date.setDate(date.getDate() - index * 7);
    return createExampleRecord(sampleProfile, "DS-001", {
      id: 100 - index,
      date,
      weight: [64.2, 64.6, 65.1, 65.4][index],
      visceralLevel: 14 + index,
    });
  });
}

// Session-only accounts keep local health data separated by normalized phone number.
const accounts = new Map();
export function normalizePhone(value) {
  return value.replace(/\D/g, "").replace(/^(?:62|0)/, "");
}
function copyHistory(records) {
  return records.map((record) => ({
    ...record,
    date: new Date(record.date),
    profile: { ...record.profile },
    contributions: record.contributions.map((row) => ({ ...row })),
  }));
}
export function saveAccount() {
  if (!state.phone || !state.profile.name) return;
  accounts.set(normalizePhone(state.phone), {
    profile: { ...state.profile },
    history: copyHistory(state.history),
  });
}
export function clearAccount() {
  state.profile = emptyProfile();
  state.history = [];
  state.selected = null;
  state.phone = "";
  state.editing = false;
  state.returnTo = "home";
  state.toast = "";
}
export function openAccount(phone, mode) {
  const saved = accounts.get(normalizePhone(phone));
  state.selected = null;
  state.editing = false;
  if (saved) {
    state.profile = { ...saved.profile };
    state.history = copyHistory(saved.history);
  } else if (mode === "login") {
    state.profile = { ...sampleProfile };
    state.history = demoHistory();
  } else {
    state.profile = emptyProfile();
    state.history = [];
  }
}
