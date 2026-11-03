// Client-side state the screens share: the signed-in user, navigation and per-screen cleanup.
import type { User } from "../shared/api.js";
import type { Role } from "../shared/domain.js";

export const LANDING: Record<Role, string> = {
  coordinator: "/board",
  requester: "/requests",
  interpreter: "/me",
  consumer: "/preferences",
  billing: "/billing",
};

export interface Screen {
  main: HTMLElement;
  user: User | null;
  params: Record<string, string>;
  /** A message carried over from the screen that navigated here. */
  flash: string | null;
  /** Runs when the user leaves this screen. */
  onLeave: (cleanup: () => void) => void;
}

interface Shell {
  navigate: (path: string, flash?: string) => void;
  signedIn: (user: User) => void;
}

let shell: Shell = { navigate: () => undefined, signedIn: () => undefined };

/** The shell in main.ts registers itself here; screens reach it through the two functions below. */
export function connectShell(next: Shell): void {
  shell = next;
}

export function navigate(path: string, flash?: string): void {
  shell.navigate(path, flash);
}

export function signedIn(user: User): void {
  shell.signedIn(user);
}
