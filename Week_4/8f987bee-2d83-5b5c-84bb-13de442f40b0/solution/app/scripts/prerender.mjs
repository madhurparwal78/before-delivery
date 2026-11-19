// Renders each marketing route to HTML at build time, so its headline and copy arrive in the first response.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { render } = await import(join(root, "dist/server/entry-server.js"));
const template = readFileSync(join(root, "dist/client/index.html"), "utf8");
const pages = {
  home: ["/", "Wayline — Keep every system in step with your AI."],
  connectors: ["/connectors", "Connector catalog — Wayline"],
  pricing: ["/pricing", "Pricing — Wayline"],
  "connector-builder": ["/connector-builder", "Connector Builder — Wayline"],
  "data-replication": ["/data-replication", "Data replication — Wayline"],
  hybrid: ["/hybrid", "Hybrid — Wayline"],
  mcp: ["/mcp", "MCP Server — Wayline"],
  "context-layer": ["/context-layer", "Context layer — Wayline"],
  "why-open-source": ["/why-open-source", "Why open source — Wayline"],
  compare: ["/compare", "Compare — Wayline"],
  "data-engineering-resources": ["/data-engineering-resources", "Resources — Wayline"],
  signin: ["/signin", "Sign in — Wayline"],
  "not-found": ["/not-found", "Page not found — Wayline"],
};

mkdirSync(join(root, "dist/pages"), { recursive: true });
for (const [name, [url, title]] of Object.entries(pages)) {
  const html = template
    .replace("<title>Wayline</title>", `<title>${title}</title>`)
    .replace('<div id="root"><!--app--></div>', `<div id="root" data-prerendered="true">${render(url)}</div>`);
  writeFileSync(join(root, "dist/pages", `${name}.html`), html);
}
rmSync(join(root, "dist/server"), { recursive: true, force: true });
