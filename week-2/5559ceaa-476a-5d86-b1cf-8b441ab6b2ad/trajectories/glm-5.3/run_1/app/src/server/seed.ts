import { createHash } from "node:crypto";

export interface SeedFile { path: string; content: string; sha256: string; size: number; }

const README = `# Tip Calculator

Split a bill and add a tip. Run the tests with \`node src/tip.test.js\`.
`;

const TIP_JS = `export function tip(bill, percent) {
  return Math.round(bill * percent) / 100;
}
`;

export function starterTip(): string {
  return `export function tip(bill, percent) {
  return 0;
}
`;
}

const TIP_TEST = `import { tip } from "./tip.js";

console.assert(tip(50, 20) === 10, "20% of 50 is 10");
`;

const INDEX_HTML = `<!doctype html>
<title>Tip Calculator</title>
<script type="module" src="src/tip.js"></script>
`;

export function seedFiles(): SeedFile[] {
  const files = [
    { path: "README.md", content: README },
    { path: "src/tip.js", content: TIP_JS },
    { path: "src/tip.test.js", content: TIP_TEST },
    { path: "index.html", content: INDEX_HTML },
  ];
  return files.map((f) => {
    const bytes = Buffer.from(f.content, "utf8");
    return { ...f, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
  });
}
