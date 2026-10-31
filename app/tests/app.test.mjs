import { test } from "node:test";
import assert from "node:assert/strict";
import { openApp, completeSignup, startSignup } from "./support/dom.mjs";

test("bundled iOS frontend starts offline without JavaScript errors", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  assert.equal(app.screen(), "welcome");
  assert.ok(app.document.body.classList.contains("native-app"));
  assert.equal(
    app.document.querySelectorAll('script[src], link[rel="stylesheet"]').length,
    0,
  );
  assert.deepEqual(app.errors, []);
});

test("signup rejects an invalid phone number before entering OTP", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  app.click("signup");
  app.fill("phone", "abcdefghij");
  app.submit("phone-form");
  assert.equal(app.screen(), "auth");
  for (const invalid of ["1234567890", "81234567"]) {
    app.fill("phone", invalid);
    app.submit("phone-form");
    assert.equal(app.screen(), "auth");
    assert.ok(app.query('[name="phone"]').validationMessage);
  }
  app.fill("phone", "81234567890");
  app.submit("phone-form");
  assert.equal(app.screen(), "otp");
});

test("signup requires OTP, all personal fields, and every health answer", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  app.click("signup");
  app.fill("phone", "81234567890");
  app.submit("phone-form");
  app.fill("otp", "123");
  app.submit("otp-form");
  assert.equal(app.screen(), "otp");
  app.fill("otp", "123456");
  app.submit("otp-form");
  assert.equal(app.screen(), "personal");
  app.submit("personal-form");
  assert.equal(app.screen(), "personal");
  for (const [name, value] of Object.entries({
    name: "Nadia Putri",
    birth: "1992-05-14",
    height: "162",
    waist: "84",
  }))
    app.fill(name, value);
  app.submit("personal-form");
  assert.equal(app.screen(), "personal");
  app.answer("sex", "Perempuan");
  app.submit("personal-form");
  assert.equal(app.screen(), "health");
  app.answer("meds", "Tidak");
  app.answer("glucose", "Tidak tahu");
  app.submit("health-form");
  assert.equal(app.screen(), "health");
  app.answer("family", "Ya");
  app.submit("health-form");
  assert.equal(app.screen(), "home");
  assert.match(
    app.document.querySelector("main").textContent,
    /Belum ada pengukuran/,
  );
  assert.deepEqual(app.errors, []);
});

test("a successful measurement saves risk details and its chosen unit in history", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app);
  app.click("scan");
  app.advance(1800);
  assert.equal(app.screen(), "devices");
  app.query('[data-device="DS-008"]').click();
  app.advance(9700);
  assert.equal(app.screen(), "result");
  assert.match(app.query(".subheading").textContent, /DS-008/);
  assert.equal(app.query(".score-circle span").firstChild.textContent, "51");
  const rows = [
    ...app.document.querySelectorAll(".contribution-table tbody tr"),
  ];
  assert.equal(rows.length, 5);
  assert.match(rows[4].textContent, /Tidak\s*0/);
  app.click("history");
  assert.equal(app.document.querySelectorAll(".history-item").length, 1);
  assert.match(app.query(".history-value").textContent, /51\s*\/ 100/);
  assert.doesNotMatch(app.query(".history-item").textContent, /kg|BMI/);
  assert.deepEqual(app.errors, []);
});

test("one nearby device connects automatically without a selection list", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app);
  app.page("scan-single");
  app.advance(1800);
  assert.equal(app.screen(), "measuring");
  assert.match(app.query(".subheading").textContent, /DS-001/);
  assert.equal(app.document.querySelectorAll(".device").length, 0);
  app.advance(9700);
  assert.equal(app.screen(), "result");
});

test("an empty scan offers retry, and a subsequent available device can be measured", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app);
  app.page("scan-none");
  app.advance(1800);
  assert.equal(app.screen(), "notfound");
  app.click("scan");
  assert.equal(app.screen(), "scan");
  app.advance(1800);
  assert.equal(app.screen(), "notfound");
  app.page("scan-single");
  app.advance(11500);
  assert.equal(app.screen(), "result");
});

test("cancelling measurement prevents delayed results from entering history", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app);
  app.page("scan-single");
  app.advance(4000);
  assert.equal(app.screen(), "measuring");
  app.click("home");
  app.advance(20000);
  assert.equal(app.screen(), "home");
  app.click("history");
  assert.equal(app.document.querySelectorAll(".history-item").length, 0);
});

test("profile changes apply to a new measurement while old detail remains unchanged", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app);
  app.page("scan-single");
  app.advance(11500);
  app.click("profile");
  app.click("edit");
  app.fill("waist", "90");
  app.fill("height", "170");
  app.submit("personal-form");
  app.answer("meds", "Ya");
  app.submit("health-form");
  assert.equal(app.screen(), "profile");
  app.click("history");
  app.query(".history-item").click();
  assert.match(app.query(".measurement-summary").textContent, /24,5/);
  assert.match(
    app.query(".contribution-table tbody tr:last-child").textContent,
    /Tidak\s*0/,
  );
  assert.match(app.query(".factor").textContent, /84 cm/);
  app.click("home");
  app.click("scan");
  app.advance(11500);
  assert.equal(app.screen(), "result");
  assert.match(app.query(".measurement-summary").textContent, /22,2/);
  assert.match(
    app.query(".contribution-table tbody tr:last-child").textContent,
    /Ya\s*\+5/,
  );
  assert.equal(app.query(".score-circle span").firstChild.textContent, "56");
});

test("a second signup starts empty and login restores only the first account’s history", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  completeSignup(app, { phone: "81277777777", name: "Pengguna A" });
  app.page("scan-single");
  app.advance(11500);
  app.click("profile");
  app.click("logout");
  completeSignup(app, { phone: "81288888888", name: "Pengguna B" });
  assert.match(app.query(".greeting").textContent, /Pengguna/);
  assert.match(app.query("main").textContent, /Belum ada pengukuran/);
  app.click("profile");
  assert.match(app.query(".profile-head h2").textContent, /Pengguna B/);
  app.click("logout");
  app.click("login");
  app.fill("phone", "081277777777");
  app.submit("phone-form");
  app.fill("otp", "654321");
  app.submit("otp-form");
  app.click("profile");
  assert.match(app.query(".profile-head h2").textContent, /Pengguna A/);
  app.click("history");
  assert.equal(app.document.querySelectorAll(".history-item").length, 1);
});

test("risk charts and history show risk scores and dd/mm dates rather than weight summaries", async (t) => {
  const app = await openApp();
  t.after(() => app.close());
  app.page("history");
  assert.match(app.query(".chart-card").textContent, /Perubahan skor risiko/);
  assert.doesNotMatch(app.query(".chart-card").textContent, /kg|berat badan/);
  const labels = [...app.document.querySelectorAll(".chart text")].map(
    (node) => node.textContent,
  );
  assert.ok(labels.some((label) => /^\d{2}\/\d{2}$/.test(label)));
  for (const row of app.document.querySelectorAll(".history-item")) {
    assert.match(row.textContent, /Skor risiko/);
    assert.doesNotMatch(row.textContent, /kg|BMI/);
    assert.equal(row.querySelectorAll(".icon-box").length, 0);
  }
});

test("connection and measurement failure pages can retry to a stored result", async (t) => {
  for (const screen of ["connection-error", "measure-error"]) {
    const app = await openApp();
    t.after(() => app.close());
    completeSignup(app);
    app.page(screen);
    app.click("retry");
    app.advance(9700);
    assert.equal(app.screen(), "result");
    app.click("history");
    assert.equal(app.document.querySelectorAll(".history-item").length, 1);
    assert.deepEqual(app.errors, []);
  }
});
