import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp, completeSignup, startSignup } from "./support/dom.mjs";

async function launch(t, options) {
  const app = await openApp(options);
  t.after(() => app.close());
  return app;
}
async function weigh(app) {
  await app.click("scan");
  await app.discover();
  await app.replay();
}

test("production bundle opens through Capacitor without external data or example records", async (t) => {
  const app = await launch(t);
  assert.equal(app.screen(), "welcome");
  assert.ok(app.document.body.classList.contains("native-app"));
  assert.equal(app.document.querySelector("#page-jump"), null);
  assert.equal(Object.keys(app.data().accounts).length, 0);
  assert.deepEqual(app.errors, []);
});
test("signup validates phone, required sex, adult birthday and health answers without OTP or waist", async (t) => {
  const app = await launch(t);
  await app.click("signup");
  for (const phone of ["abcdefghij", "1234567890", "81234567"]) {
    app.fill("phone", phone);
    await app.submit("phone-form");
    assert.equal(app.screen(), "auth");
  }
  app.fill("phone", "81200000000");
  await app.submit("phone-form");
  assert.equal(app.screen(), "personal");
  assert.equal(app.document.querySelector('[name="waist"]'), null);
  assert.equal(app.document.querySelector("#otp-form"), null);
  app.fill("name", "Uji B");
  app.fill("height", "147");
  app.fill("birth", "2020-01-01");
  app.answer("sex", "Laki-laki");
  await app.submit("personal-form");
  assert.equal(app.screen(), "personal");
  app.fill("birth", "2007-03-01");
  app.query('[name="sex"]:checked').checked = false;
  await app.submit("personal-form");
  assert.equal(app.screen(), "personal");
  app.answer("sex", "Laki-laki");
  await app.submit("personal-form");
  assert.equal(app.screen(), "health");
  app.answer("meds", "Tidak");
  app.answer("glucose", "Tidak");
  await app.submit("health-form");
  assert.equal(app.screen(), "health");
  app.answer("family", "Ya");
  await app.submit("health-form");
  assert.equal(app.screen(), "home");
  assert.match(app.query("main").textContent, /Belum ada pengukuran/);
  assert.deepEqual(app.errors, []);
});
test("real capture produces four required numbers, waist, score 16 Aman, and a durable outgoing record", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await weigh(app);
  assert.equal(app.screen(), "result");
  assert.equal(app.query(".score-circle span").firstChild.textContent, "16");
  assert.match(app.query(".score-main h2").textContent, /Aman/);
  const summary = app.query(".measurement-summary").textContent;
  assert.match(summary, /Tinggi\d+cm/);
  assert.match(summary, /Berat[\d,]+kg/);
  assert.match(summary, /Lingkar pinggang74,6cm/);
  assert.doesNotMatch(
    app.document.querySelector(".factor").textContent,
    /Lingkar pinggang/,
  );
  assert.match(app.query(".contribution-table").textContent, /67,3 cm²/);
  assert.match(app.query(".contribution-table").textContent, /21,1 kg\/m²/);
  assert.equal(app.data().outgoing.length, 1);
  assert.equal(app.data().accounts["81200000000"].history.length, 1);
  assert.equal(app.data().outgoing[0].measurement.score.total, 16);
  await app.click("history");
  assert.equal(app.document.querySelectorAll(".history-item").length, 1);
  app.query(".history-item").click();
  await app.flush();
  assert.equal(app.screen(), "result");
  assert.deepEqual(app.errors, []);
});
test("profile and history restore after process restart and old snapshots survive profile edits", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await weigh(app);
  const reopened = await launch(t, { saved: app.saved });
  assert.equal(reopened.screen(), "home");
  await reopened.click("profile");
  assert.equal(reopened.document.querySelector('[name="waist"]'), null);
  await reopened.click("edit");
  reopened.fill("height", "170");
  await reopened.submit("personal-form");
  reopened.answer("meds", "Ya");
  await reopened.submit("health-form");
  await reopened.click("history");
  reopened.query(".history-item").click();
  await reopened.flush();
  assert.match(reopened.query(".contribution-table").textContent, /21,1/);
  assert.match(
    reopened.query(".contribution-table tbody tr:nth-last-child(2)").textContent,
    /Tidak\s*0/,
  );
  await reopened.click("home");
  await weigh(reopened);
  assert.equal(reopened.data().accounts["81200000000"].history.length, 2);
  assert.equal(
    reopened.data().accounts["81200000000"].history[0].profile.heightCm,
    170,
  );
  assert.equal(
    reopened.data().accounts["81200000000"].history[1].profile.heightCm,
    147,
  );
});
test("cancel, disconnect and timeout save nothing and allow a fresh successful retry", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await app.click("scan");
  await app.discover();
  await app.click("home");
  await app.replay();
  assert.equal(app.screen(), "home");
  assert.equal(app.data().outgoing.length, 0);
  await app.click("scan");
  await app.discover();
  await app.disconnect();
  assert.equal(app.screen(), "measure-error");
  await app.click("scan");
  await app.discover();
  await app.advance(60000);
  assert.equal(app.screen(), "measure-error");
  assert.equal(app.data().outgoing.length, 0);
  await weigh(app);
  assert.equal(app.screen(), "result");
});
test("the measuring screen shows searching, then connected, without replacing the screen", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await app.click("scan");
  const screen = app.query(".scan-orbit");
  assert.equal(app.query(".measure").classList.contains("connected"), false);
  await app.discover();
  assert.equal(app.screen(), "measuring");
  assert.equal(app.query(".measure").classList.contains("connected"), true);
  assert.equal(app.query(".scan-orbit"), screen);
});
test("empty scans and multiple supported devices use actual discovery results", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await app.click("scan");
  await app.discover([]);
  assert.equal(app.screen(), "notfound");
  await app.click("scan");
  await app.discover(["first", "second"]);
  assert.equal(app.screen(), "devices");
  assert.equal(app.document.querySelectorAll(".device").length, 2);
  app.query('[data-device="second"]').click();
  await app.flush();
  await app.replay("second");
  assert.equal(app.screen(), "result");
});
test("a failed local save never claims success and can save the same result after storage recovers", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await app.click("scan");
  await app.discover();
  app.storageFails(true);
  await app.replay();
  assert.equal(app.screen(), "measure-error");
  assert.equal(app.data().outgoing.length, 0);
  assert.match(app.query("main").textContent, /belum dapat disimpan/);
  app.storageFails(false);
  await app.click("save-again");
  assert.equal(app.screen(), "result");
  assert.equal(app.data().outgoing.length, 1);
});
test("local phone profiles stay isolated and login never fabricates history for unknown numbers", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await weigh(app);
  await app.click("profile");
  await app.click("logout");
  await app.click("login");
  app.fill("phone", "81277777777");
  await app.submit("phone-form");
  assert.equal(app.screen(), "auth");
  assert.match(app.query(".toast").textContent, /Belum ada profil/);
  await completeSignup(app, { phone: "81288888888", name: "Pengguna B" });
  assert.match(app.query("main").textContent, /Belum ada pengukuran/);
  await app.click("profile");
  await app.click("logout");
  await app.click("login");
  app.fill("phone", "081200000000");
  await app.submit("phone-form");
  assert.equal(app.screen(), "home");
  await app.click("history");
  assert.equal(app.document.querySelectorAll(".history-item").length, 1);
});
test("unreadable persisted data is preserved and offers retry instead of overwriting", async (t) => {
  const saved = new Map([["diascale.local.v1", "{"]]);
  const app = await launch(t, { saved });
  assert.match(app.query("main").textContent, /Data belum dapat dibuka/);
  assert.equal(saved.get("diascale.local.v1"), "{");
});

test("cancelling profile edits restores durable values and an unsaved result cannot be lost by logout", async (t) => {
  const app = await launch(t);
  await completeSignup(app);
  await app.click("profile");
  await app.click("edit");
  app.fill("height", "170");
  await app.submit("personal-form");
  await app.click("personal");
  await app.click("profile");
  assert.match(app.query("main").textContent, /147 cm/);
  await app.click("home");
  await app.click("scan");
  await app.discover();
  app.storageFails(true);
  await app.replay();
  await app.click("home");
  await app.click("profile");
  await app.click("logout");
  assert.equal(app.screen(), "measure-error");
  assert.match(app.query("main").textContent, /Simpan kembali sebelum/);
  app.storageFails(false);
  await app.click("save-again");
  assert.equal(app.screen(), "result");
  assert.equal(app.data().accounts["81200000000"].history.length, 1);
});
