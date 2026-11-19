import { writeFileSync } from "node:fs";

const { render } = await import("../dist-ssr/entry-server.js");

const ROUTES = [
  "/",
  "/connectors",
  "/pricing",
  "/connector-builder",
  "/data-replication",
  "/hybrid",
  "/mcp",
  "/context-layer",
  "/why-open-source",
  "/compare",
  "/data-engineering-resources",
  "/signin",
  "/login",
  "/accept-invite",
];

const fragments = {};
for (const route of ROUTES) {
  fragments[route] = render(route);
}
fragments.__console__ = render("/app");
fragments.__not_found__ = render("/this-address-does-not-exist");

writeFileSync("dist/prerender.json", JSON.stringify(fragments));
console.log(`prerendered ${Object.keys(fragments).length} route fragments`);
