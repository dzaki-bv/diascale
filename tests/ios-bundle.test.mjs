import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { JSDOM } from "jsdom";

async function fixture(
  t,
  {
    javascript = "window.loaded=true;",
    css = "body{color:#20363e}",
    extraScript = "",
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "diascale-ios-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "dist/assets"), { recursive: true });
  await cp(
    new URL("../scripts/sync-ios.mjs", import.meta.url),
    join(root, "scripts/sync-ios.mjs"),
  );
  await writeFile(
    join(root, "dist/index.html"),
    `<!doctype html><html><head><script type="module" src="./assets/main.js"></script><link rel="stylesheet" href="./assets/main.css">${extraScript}</head><body><div id="app"></div></body></html>`,
  );
  await writeFile(join(root, "dist/assets/main.js"), javascript);
  await writeFile(join(root, "dist/assets/main.css"), css);
  return {
    root,
    run: () =>
      spawnSync(process.execPath, [join(root, "scripts/sync-ios.mjs")], {
        encoding: "utf8",
        timeout: 10000,
      }),
    html: () => readFile(join(root, "ios/DiaScale/Web/index.html"), "utf8"),
  };
}

test("iOS bundling inlines fonts and preserves script-looking text without injecting elements", async (t) => {
  const project = await fixture(t, {
    javascript: 'window.literal="</script><img id=unexpected>";',
    css: '@font-face{font-family:Example;src:url("./example.woff2")}body{color:blue}',
  });
  await writeFile(
    join(project.root, "dist/assets/example.woff2"),
    Buffer.from([0, 1, 2, 3]),
  );
  const result = project.run();
  assert.equal(result.status, 0, result.stderr);
  const html = await project.html();
  assert.match(html, /data:font\/woff2;base64,AAECAw==/);
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "file:///bundle/index.html",
  });
  t.after(() => dom.window.close());
  await new Promise((resolve) =>
    dom.window.addEventListener("load", resolve, { once: true }),
  );
  assert.equal(dom.window.literal, "</script><img id=unexpected>");
  assert.equal(dom.window.document.querySelector("#unexpected"), null);
  assert.equal(
    dom.window.document.querySelectorAll('script[src],link[rel="stylesheet"]')
      .length,
    0,
  );
});

test("iOS bundling refuses assets outside the distribution directory", async (t) => {
  const project = await fixture(t, {
    css: '@font-face{font-family:Example;src:url("../../outside.woff2")}',
  });
  await writeFile(join(project.root, "outside.woff2"), "private");
  const result = project.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Asset outside dist/);
  await assert.rejects(project.html(), { code: "ENOENT" });
});

test("iOS bundling rejects multiple JavaScript entry points instead of silently dropping one", async (t) => {
  const project = await fixture(t, {
    extraScript: '<script type="module" src="./assets/other.js"></script>',
  });
  const result = project.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected one bundled JavaScript entry/);
});
