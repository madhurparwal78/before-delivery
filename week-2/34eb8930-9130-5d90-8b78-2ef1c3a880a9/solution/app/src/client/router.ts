import { api, HttpError } from "./net.js";
import type { SessionPerson } from "../shared/types.js";

export interface View { unmount(): void }
type Mount = (root: HTMLElement, me: SessionPerson | null) => View | Promise<View>;

let me: SessionPerson | null | undefined;
let current: View | null = null;
let mounts: { signIn: Mount; home: Mount; editor: (root: HTMLElement, me: SessionPerson, id: string, card: string | null) => View };

export function setSession(p: SessionPerson | null): void { me = p; }

export function navigate(path: string, replace = false): void {
  history[replace ? "replaceState" : "pushState"](null, "", path);
  void route();
}

async function session(): Promise<SessionPerson | null> {
  if (me !== undefined) return me;
  try {
    me = (await api<{ person: SessionPerson }>("GET", "/api/session")).person;
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    me = null;
  }
  return me;
}

async function route(): Promise<void> {
  current?.unmount();
  current = null;
  const root = document.getElementById("app") as HTMLElement;
  root.replaceChildren();
  const path = location.pathname;
  const params = new URLSearchParams(location.search);
  const person = path === "/sign-in" && me === undefined ? null : await session();
  if (path === "/sign-in") {
    if (person) return navigate(params.get("next") ?? "/", true);
    current = await mounts.signIn(root, null);
    return;
  }
  if (!person) return navigate(`/sign-in?next=${encodeURIComponent(path + location.search)}`, true);
  const proposal = /^\/d\/([^/]+)$/.exec(path);
  current = proposal ? mounts.editor(root, person, decodeURIComponent(proposal[1]), params.get("card")) : await mounts.home(root, person);
}

export function start(m: typeof mounts): void {
  mounts = m;
  window.addEventListener("popstate", () => void route());
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[data-route]");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(a.getAttribute("href") ?? "/");
  });
  void route();
}
