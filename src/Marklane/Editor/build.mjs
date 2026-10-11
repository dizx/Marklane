import { build } from "esbuild";
import { mkdir, copyFile, readFile, readdir, writeFile } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/editor.js"], bundle: true, minify: true,
  outfile: "dist/editor.js", target: "chrome120", legalComments: "eof"
});
await Promise.all(["index.html", "editor.css"].map(file => copyFile(`src/${file}`, `dist/${file}`)));

const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const notices = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  const license = (await readdir(path)).find(name => /^license(?:-mit)?(?:\.md|\.txt)?$/i.test(name));
  if (!license) throw new Error(`Missing third-party license: ${path}`);
  notices.push(`${path.replace(/^node_modules\//, "")} ${info.version}\n${await readFile(`${path}/${license}`, "utf8")}`);
}
await writeFile("dist/THIRD-PARTY-NOTICES.txt", notices.join("\n\n--------------------\n\n").replace(/\r?\n/g, "\r\n"));
