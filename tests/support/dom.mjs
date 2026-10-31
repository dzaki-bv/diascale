import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import assert from "node:assert/strict";

const htmlPath = new URL("../../ios/DiaScale/Web/index.html", import.meta.url);

export async function openApp() {
  const errors = [];
  const tasks = new Map();
  let time = 0;
  let nextID = 0;
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const dom = new JSDOM(await readFile(htmlPath, "utf8"), {
    url: "file:///bundle/Web/index.html",
    runScripts: "dangerously",
    virtualConsole,
    beforeParse(window) {
      window.setTimeout = (callback, delay = 0, ...args) => {
        const id = ++nextID;
        tasks.set(id, {
          time: time + Number(delay),
          callback: () => callback(...args),
        });
        return id;
      };
      window.clearTimeout = (id) => tasks.delete(id);
      window.HTMLElement.prototype.scrollTo = function (_x, y) {
        this.scrollTop = y;
      };
    },
  });
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  const document = dom.window.document;
  const query = (selector) => {
    const element = document.querySelector(selector);
    assert.ok(element, `Expected element: ${selector}`);
    return element;
  };
  return {
    document,
    window: dom.window,
    errors,
    query,
    screen: () => query(".phone").dataset.screen,
    click(action) {
      query(`[data-action="${action}"]`).click();
    },
    fill(name, value) {
      const input = query(`[name="${name}"]`);
      input.value = value;
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    },
    submit(id) {
      query(`#${id}`).requestSubmit();
    },
    answer(name, value) {
      query(`input[name="${name}"][value="${value}"]`).checked = true;
    },
    page(screen) {
      const select = query("#page-jump");
      select.value = screen;
      assert.equal(select.value, screen, "Requested preview page must exist");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    },
    advance(milliseconds) {
      const end = time + milliseconds;
      while (true) {
        const next = [...tasks]
          .filter(([, task]) => task.time <= end)
          .sort((a, b) => a[1].time - b[1].time)[0];
        if (!next) break;
        const [id, task] = next;
        tasks.delete(id);
        time = task.time;
        task.callback();
      }
      time = end;
    },
    close() {
      dom.window.close();
    },
  };
}

export function startSignup(app, phone = "81234567890") {
  app.click("signup");
  app.fill("phone", phone);
  app.submit("phone-form");
  app.fill("otp", "123456");
  app.submit("otp-form");
}

export function completeSignup(
  app,
  { phone = "81234567890", name = "Nadia Putri", meds = "Tidak" } = {},
) {
  startSignup(app, phone);
  for (const [field, value] of Object.entries({
    name,
    birth: "1992-05-14",
    height: "162",
    waist: "84",
  }))
    app.fill(field, value);
  app.answer("sex", "Perempuan");
  app.submit("personal-form");
  app.answer("meds", meds);
  app.answer("glucose", "Tidak");
  app.answer("family", "Ya");
  app.submit("health-form");
}
