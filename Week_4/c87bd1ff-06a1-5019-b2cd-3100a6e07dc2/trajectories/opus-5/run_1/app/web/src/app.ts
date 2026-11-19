import { Live } from "./live.js";
import { Announcer } from "./updates.js";
import type { Boot, Frame } from "./types.js";

/** App is what every screen is handed: its first-load data and the page's
 * one live socket and status region. */
export interface App {
  boot: Boot;
  live: Live;
  say: Announcer;
  root: HTMLElement;
}

/** Screen is one address's renderer. It may follow the live socket. */
export type Screen = (app: App) => ((frame: Frame) => void) | void;

/** data reads a key out of the page's first-load payload. */
export const data = <T>(app: App, key: string, fallback: T): T => {
  const value = app.boot.data?.[key];
  return value === undefined || value === null ? fallback : (value as T);
};
