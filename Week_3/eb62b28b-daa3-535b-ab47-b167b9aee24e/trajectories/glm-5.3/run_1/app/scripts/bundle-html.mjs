import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
const root = process.cwd();
copyFileSync(resolve(root, "public/index.html"), resolve(root, "dist/index.html"));
console.log("html copied");
