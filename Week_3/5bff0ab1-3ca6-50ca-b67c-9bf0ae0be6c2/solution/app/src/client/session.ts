import type { Boot, User } from "../shared/types.js";
import { validMobile, validName, validPassword } from "../shared/accounts.js";
import { FIELD, STATUS } from "../shared/copy.js";
import { call, onSessionEnded } from "./net.js";
import { RANK, announce } from "./status.js";
import { Store } from "./store.js";

type SessionState = {
  user: User | null;
  /** Rises on every change of who is signed in, so streams and rider data are read again for the current caller. */
  identity: number;
  /** Rises when licence fields must clear: a different account took over. */
  resetKey: number;
  prompt: "action" | "ended" | "screen" | null;
  /** Whether this screen reads rider data on load, so an ended session prompts there. */
  readsRiderData: boolean;
};

export const session = new Store<SessionState>({ user: null, identity: 0, resetKey: 0, prompt: null, readsRiderData: false });

let endedUserId: string | null = null;
let endHandled = false;
let resume: (() => void) | null = null;

export function initSession(boot: Boot): void {
  session.set({ user: boot.user });
  if (typeof window !== "undefined") {
    onSessionEnded(() => sessionEnded());
    setInterval(() => void pollMe(), 1000);
  }
}

function setUser(user: User | null, resetFields: boolean): void {
  const s = session.get();
  const changed = (s.user?.id ?? null) !== (user?.id ?? null);
  session.set({ user, identity: s.identity + (changed ? 1 : 0), resetKey: s.resetKey + (changed && resetFields ? 1 : 0) });
}

/** The session ended on the app clock: say so once, open the prompt over the same screen and keep every choice. */
export function sessionEnded(): void {
  const s = session.get();
  if (endHandled || (!s.user && !s.readsRiderData)) return;
  endHandled = true;
  endedUserId = s.user?.id ?? endedUserId;
  announce(STATUS.sessionEnded, RANK.session);
  session.set({ user: null, identity: s.identity + 1, prompt: "ended" });
}

/** A screen that reads rider data loaded with an ended session cookie: say so once and prompt in place. */
export function sessionEndedOnLoad(): void {
  if (endHandled) return;
  endHandled = true;
  announce(STATUS.sessionEnded, RANK.session);
  session.set({ prompt: "ended" });
}

export function setReadsRiderData(reads: boolean): void {
  session.set({ readsRiderData: reads });
}

/** A rider action met nobody signed in: open the prompt without any status and run `after` once they are in. */
export function requestSignIn(after?: () => void): void {
  resume = after ?? null;
  session.set({ prompt: session.get().prompt ?? "action" });
}

export function screenNeedsSignIn(): void {
  if (!session.get().user && !session.get().prompt) session.set({ prompt: "screen" });
}

export function closePrompt(): void {
  resume = null;
  session.set({ prompt: null });
}

export type Fault = Partial<Record<"name" | "mobile" | "password" | "form", string>>;

export async function signIn(mobile: string, password: string): Promise<Fault | null> {
  const r = await call<{ user: User }>("POST", "/api/auth/signin", { mobile, password });
  if (r.status === 401 || r.status === 422) return { form: FIELD.badLogin };
  if (!r.ok) return { form: "The service did not answer. Try again." };
  welcome(r.data.user);
  return null;
}

export async function register(name: string, mobile: string, password: string): Promise<Fault | null> {
  const fault: Fault = {};
  if (!validName(name)) fault.name = FIELD.name;
  if (!validMobile(mobile)) fault.mobile = FIELD.mobile;
  if (!validPassword(password)) fault.password = FIELD.password;
  if (Object.keys(fault).length > 0) return fault;
  const r = await call<{ user: User }>("POST", "/api/auth/register", { name: name.trim(), mobile, password });
  if (r.code === "mobile_taken") return { mobile: FIELD.mobileTaken };
  if (!r.ok) return { form: "The account could not be created. Try again." };
  welcome(r.data.user);
  return null;
}

function welcome(user: User): void {
  const different = endedUserId !== null && endedUserId !== user.id;
  endedUserId = null;
  endHandled = false;
  setUser(user, different);
  const after = resume;
  resume = null;
  session.set({ prompt: null });
  after?.();
}

export async function signOut(): Promise<void> {
  await call("POST", "/api/auth/signout");
  endHandled = false;
  setUser(null, false);
}

/** Another tab changed who is signed in: take on that identity with no prompt and no status. */
async function pollMe(): Promise<void> {
  const before = session.get();
  const r = await call<{ user: User }>("GET", "/api/me");
  const now = session.get();
  if (now.identity !== before.identity) return;
  if (r.ok) {
    if (r.data.user.id !== now.user?.id) {
      endHandled = false;
      endedUserId = null;
      setUser(r.data.user, true);
      if (session.get().prompt) session.set({ prompt: null });
    } else if (JSON.stringify(r.data.user) !== JSON.stringify(now.user)) {
      session.set({ user: r.data.user });
    }
  } else if (r.status === 401 && r.code !== "session_ended" && now.user) {
    setUser(null, false);
    if (now.readsRiderData) session.set({ prompt: "screen" });
  }
}

export const pollIdentity = pollMe;

/** A rider action asks who is signed in first, so a sign-in made in another tab is taken up rather than prompted for. */
export async function ensureSignedIn(): Promise<boolean> {
  if (!session.get().user) await pollMe();
  return session.get().user !== null;
}
