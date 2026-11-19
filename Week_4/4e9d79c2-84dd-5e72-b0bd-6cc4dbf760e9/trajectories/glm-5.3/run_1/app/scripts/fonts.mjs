import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const r = (u) => execFileSync("curl", ["-sfL", "--max-time", "40", u], { maxBuffer: 64 * 1024 * 1024 });

const css = r("https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@400;600&family=Noto+Nastaliq+Urdu:wght@400;600&display=swap").toString();
const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
const rewritten = css
  .replace(/https:\/\/fonts\.gstatic\.com\/[^)]+/g, (u) => "/assets/fonts/" + urls.indexOf(u) + ".woff2")
  .replace(/ format\('truetype'\)/g, "");
mkdirSync("build/public/assets/fonts", { recursive: true });
urls.forEach((u, i) => writeFileSync("build/public/assets/fonts/" + i + ".woff2", r(u)));
mkdirSync("src/client", { recursive: true });
writeFileSync("src/client/fonts.css", rewritten);
console.log("font files:", urls.length);
