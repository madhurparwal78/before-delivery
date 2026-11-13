/** Compile the client TypeScript to browser-loadable modules. */
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const clientSrc = path.join(root, "src", "client");
const outDir = path.join(root, "dist", "public", "assets");

// A throwaway copy of the client with extensionless imports so tsc can emit.
const staging = fs.mkdtempSync(path.join("/tmp", "chauraha-client-"));
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(path.join(src, entry.name), path.join(dest, entry.name));
    else if (entry.name.endsWith(".ts")) {
      const text = fs.readFileSync(path.join(src, entry.name), "utf8")
        .replace(/(from\s+"|import\s+")([^"]+)(\.ts")/g, "$1$2.js\"");
      fs.writeFileSync(path.join(dest, entry.name), text);
    }
  }
}
copyDir(clientSrc, staging);

const tsconfig = {
  compilerOptions: {
    target: "es2022",
    module: "es2022",
    moduleResolution: "bundler",
    lib: ["es2022", "dom", "dom.iterable"],
    strict: true,
    outDir,
    rootDir: staging,
    skipLibCheck: true,
    esModuleInterop: true,
    forceConsistentCasingInFileNames: true,
    useUnknownInCatchVariables: true,
    noFallthroughCasesInSwitch: true,
  },
  include: [path.join(staging, "**", "*.ts")],
};

const tmpConfigPath = path.join(staging, "tsconfig.json");
fs.writeFileSync(tmpConfigPath, JSON.stringify(tsconfig, null, 2));
try {
  execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", tmpConfigPath], { stdio: "inherit" });
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}

const emittedEntry = path.join(outDir, "entry.js");
if (fs.existsSync(emittedEntry)) {
  fs.renameSync(emittedEntry, path.join(outDir, "app-entry.js"));
}
console.log("client compiled");
