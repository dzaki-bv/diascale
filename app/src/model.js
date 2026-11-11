import { ageOn } from "@diascale/core";

export const riskStyle = "porcelain";
export const variant = "A";
export const emptyProfile = () => ({
  name: "",
  birth: "",
  sex: "",
  height: "",
  meds: "",
  glucose: "",
  family: "",
});
export const state = {
  screen: "welcome",
  mode: "signup",
  phone: "",
  profile: emptyProfile(),
  history: [],
  selected: null,
  returnTo: "home",
  devices: [],
  device: null,
  period: "month",
  weightKg: null,
  connected: false,
  editing: false,
  busy: false,
  toast: "",
  failureReason: "",
  unsaved: null,
  syncText: "",
};
let store;
export function initModel(repository) {
  store = repository;
  const phone = store.snapshot().activePhone;
  if (phone && openAccount(phone)) state.screen = "home";
}
export function normalizePhone(value) {
  return value.replace(/\D/g, "").replace(/^(?:62|0)/, "");
}
export function toProfile() {
  return {
    name: state.profile.name.trim(),
    phone: state.phone,
    birthDate: state.profile.birth,
    sex: state.profile.sex === "Laki-laki" ? "male" : "female",
    heightCm: Number(state.profile.height),
    antihypertensive: state.profile.meds === "Ya",
    familyHistory: state.profile.family === "Ya",
    highGlucose: state.profile.glucose === "Ya",
  };
}
export function formProfile(profile) {
  return {
    name: profile.name,
    birth: profile.birthDate,
    sex: profile.sex === "male" ? "Laki-laki" : "Perempuan",
    height: String(profile.heightCm),
    meds: profile.antihypertensive ? "Ya" : "Tidak",
    family: profile.familyHistory ? "Ya" : "Tidak",
    glucose: profile.highGlucose ? "Ya" : "Tidak",
  };
}
export function isAdult(birth, at = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return false;
  const [y, m, d] = birth.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  )
    return false;
  const age = ageOn(birth, at.toISOString());
  return age >= 18 && age <= 127;
}
export function adultBirthMax() {
  const now = new Date();
  const year = now.getFullYear() - 18;
  const day = Math.min(
    now.getDate(),
    new Date(year, now.getMonth() + 1, 0).getDate(),
  );
  return `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
const decimal = (value) => value.toFixed(1).replace(".", ",");
export function viewMeasurement(m) {
  return {
    id: m.id,
    date: m.measuredAt,
    weight: m.inputs.weightKg,
    bmi: m.numbers.bmi,
    risk: m.score.category,
    score: m.score.total,
    device: "FG2504WB",
    profile: formProfile(m.profile),
    raw: m,
    contributions: [
      {
        label: "Lemak viseral",
        value: `${decimal(m.numbers.visceral)} cm²`,
        points: m.score.points.visceral,
      },
      {
        label: "Persentase lemak",
        value: `${decimal(m.fatPercent)}%`,
        points: m.score.points.fat,
      },
      {
        label: "BMI",
        value: `${decimal(m.numbers.bmi)} kg/m²`,
        points: m.score.points.bmi,
      },
      {
        label: "Massa otot",
        value: `${decimal(m.numbers.muscleKg)} kg`,
        points: m.score.points.muscle,
      },
      {
        label: "Obat antihipertensi",
        value: m.profile.antihypertensive ? "Ya" : "Tidak",
        points: m.score.points.antihypertensive,
      },
      {
        label: "Riwayat diabetes keluarga",
        value: m.profile.familyHistory ? "Ya" : "Tidak",
        points: m.score.points.family,
      },
    ],
  };
}
export function openAccount(phone) {
  const key = normalizePhone(phone);
  const account = store.snapshot().accounts[key];
  if (!account) return false;
  state.phone = key;
  state.profile = formProfile(account.profile);
  state.history = account.history.map(viewMeasurement);
  state.selected = null;
  state.editing = false;
  return true;
}
export async function saveAccount() {
  await store.saveProfile(state.phone, toProfile());
}
export async function clearAccount() {
  await store.update((data) => {
    data.activePhone = null;
  });
  state.profile = emptyProfile();
  state.phone = "";
  state.history = [];
  state.selected = null;
  state.editing = false;
  state.toast = "";
  state.unsaved = null;
}
export function beginSignup(phone) {
  state.phone = normalizePhone(phone);
  state.profile = emptyProfile();
  state.history = [];
  state.selected = null;
  state.editing = false;
}
export async function saveMeasurement(measurement) {
  await store.saveMeasurement(state.phone, measurement);
  state.history = store
    .snapshot()
    .accounts[state.phone].history.map(viewMeasurement);
  state.selected = state.history.find((record) => record.id === measurement.id);
}
