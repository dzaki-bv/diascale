// Exercise the production Vite graph in jsdom, which does not execute module scripts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("dist/index.html", root), "utf8");
const entry = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
if (!entry) throw new Error("Production entry not found");
const result = await build({
  entryPoints: [resolve(new URL("dist/", root).pathname, entry)],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  write: false,
  define: {
    "import.meta.url": JSON.stringify(
      new URL(entry, "https://localhost/").href,
    ),
    "import.meta.resolve": "undefined",
  },
});
await mkdir(new URL("tmp/dom/", root), { recursive: true });
await writeFile(
  new URL("tmp/dom/index.html", root),
  html
    .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, "")
    .replace(
      "</body>",
      () =>
        `<script>${result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body>`,
    ),
);
