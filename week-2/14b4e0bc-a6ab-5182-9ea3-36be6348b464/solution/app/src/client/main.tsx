import { options, render } from "preact";
import { Admin } from "./admin.tsx";
import { session, startStatusPolling } from "./app-state.ts";
import { Catalog } from "./catalog/workspace.tsx";
import { Glossary } from "./glossary.tsx";
import { api, type User } from "./lib.ts";
import { SignIn } from "./signin.tsx";

/** Hook effects run on microtasks, never on animation frames, so nothing waits on a frame to settle. */
(options as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame = (cb) => void Promise.resolve().then(cb);

async function boot(): Promise<void> {
  const root = document.getElementById("root")!;
  const path = location.pathname;
  if (path === "/signin") {
    render(<SignIn />, root);
    return;
  }
  const me = await api<{ user: User }>("GET", "/api/session").catch(() => null);
  if (!me) return;
  session.set(me.user);
  startStatusPolling();
  const screen = path === "/glossary" ? <Glossary /> : path === "/admin" ? <Admin /> : <Catalog />;
  render(screen, root);
}

void boot();
