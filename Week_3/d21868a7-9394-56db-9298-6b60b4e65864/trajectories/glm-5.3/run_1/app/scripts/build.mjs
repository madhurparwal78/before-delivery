import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = join(process.cwd(), "public");
const dest = join(process.cwd(), "dist", "public");
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log("assets copied to dist/public");
