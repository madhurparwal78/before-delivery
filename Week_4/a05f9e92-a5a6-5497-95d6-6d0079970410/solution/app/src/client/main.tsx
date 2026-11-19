import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { get } from "./lib/api.js";
import type { Loaded } from "./lib/session.js";
import "./styles/base.css";
import "./styles/sla.css";

/** The faces the first screen is set in; the page waits for them so the text never reflows when they arrive. */
const FACES = ["800 1em Unbounded", "900 1em Unbounded", "400 1em Onest", "600 1em Onest"];
const WAIT_MS = 1500;

function within<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([work, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), WAIT_MS))]);
}

async function start(): Promise<void> {
  // Ask who is signed in while the faces load, so the banner and the screen are laid out once, with both known.
  const session = get<Loaded>("/api/session").catch(() => null);
  const faces = Promise.all(FACES.map((face) => document.fonts.load(face))).then(() => undefined, () => undefined);
  const [initial] = await Promise.all([within<Loaded | null | undefined>(session, undefined), within(faces, undefined)]);
  createRoot(document.getElementById("root")!).render(<App initial={initial} />);
}

void start();
