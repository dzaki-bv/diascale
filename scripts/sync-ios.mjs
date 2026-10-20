import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(project, "dist");
const webDirectory = resolve(project, "ios/DiaScale/Web");

function bundledPath(parent, relative) {
  const path = resolve(parent, relative);
  if (!path.startsWith(dist + sep))
    throw new Error(`Asset outside dist: ${relative}`);
  return path;
}

let html = await readFile(resolve(dist, "index.html"), "utf8");
const scripts = [
  ...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g),
];
if (scripts.length !== 1)
  throw new Error("Expected one bundled JavaScript entry.");
const javascript = await readFile(bundledPath(dist, scripts[0][1]), "utf8");
// A classic inline script avoids local-file ES module origin restrictions in WKWebView.
const inlineJavaScript =
  `window.addEventListener('DOMContentLoaded',function(){document.body.classList.add('native-app','ios-app');\n${javascript}\n});`.replace(
    /<\/script/gi,
    "<\\/script",
  );
html = html.replace(
  scripts[0][0],
  () => `<script>${inlineJavaScript}</script>`,
);

const stylesheets = [
  ...html.matchAll(
    /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g,
  ),
];
if (!stylesheets.length) throw new Error("No bundled stylesheet found.");
for (const stylesheet of stylesheets) {
  const cssPath = bundledPath(dist, stylesheet[1]);
  let css = await readFile(cssPath, "utf8");
  const urls = [...css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)];
  for (const asset of urls) {
    if (asset[1].startsWith("data:")) continue;
    const path = bundledPath(dirname(cssPath), asset[1]);
    const extension = extname(path);
    const mime = {
      ".woff2": "font/woff2",
      ".woff": "font/woff",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    }[extension];
    if (!mime) throw new Error(`Unsupported inline asset: ${extension}`);
    const bytes = await readFile(path);
    css = css.replace(
      asset[0],
      `url("data:${mime};base64,${bytes.toString("base64")}")`,
    );
  }
  css += "\n.ios-app input,.ios-app select{font-size:16px}\n";
  html = html.replace(
    stylesheet[0],
    () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`,
  );
}
await mkdir(webDirectory, { recursive: true });
await writeFile(resolve(webDirectory, "index.html"), html);
console.log("iOS frontend bundled with inline JavaScript, styles, and fonts.");
