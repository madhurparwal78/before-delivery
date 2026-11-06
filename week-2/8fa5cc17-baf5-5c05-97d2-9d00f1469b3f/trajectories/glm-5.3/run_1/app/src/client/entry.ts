// The browser entry point for the workspace and the share surface.

import { boot } from "./app.js";
import { bootSignIn } from "./sign-in.js";
import { bootShare } from "./share.js";

async function main(): Promise<void> {
  const path = location.pathname;
  if (path === "/sign-in") {
    const signedOut = new URLSearchParams(location.search).get("signedout") === "1";
    await bootSignIn(signedOut ? "You've been signed out on this device." : "");
    return;
  }
  if (path === "/s" || path.startsWith("/s/")) {
    const rest = path.slice("/s/".length);
    const parts = rest.split("/").filter((p) => p.length > 0);
    const token = parts[0] ?? "";
    const objectId = parts[1] === "o" ? parts[2] ?? null : null;
    await bootShare(token, objectId);
    return;
  }
  await boot();
}

void main();
