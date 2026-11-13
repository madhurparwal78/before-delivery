import { DEFAULT_SETTINGS } from "../shared/protocol";
import type { ClientConfig, Me, Settings } from "../shared/protocol";
import { Store } from "./store";

const SETTINGS_KEY = "strikeproof.settings";

interface ViewerState {
  readonly ready: boolean;
  readonly me: Me | null;
}

function guestSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function getJson<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await fetch(path);
  return { status: response.status, body: (await response.json()) as T };
}

/** Who is signed in, the typist's settings, and the server's published limits. */
class Viewer {
  readonly state = new Store<ViewerState>({ ready: false, me: null });
  readonly settings = new Store<Settings>(guestSettings());
  readonly config = new Store<ClientConfig>({ focusWarningMs: 1000, maxExtraLetters: 10, raceCountdownSeconds: 3, raceRejoinSeconds: 30 });
  /** Saves are sent one at a time, each carrying the latest choice, so the server always ends on the last one. */
  private saving = false;
  private dirty = false;

  async boot(): Promise<void> {
    const [config, me] = await Promise.all([getJson<ClientConfig>("/api/config"), getJson<Me>("/api/me")]);
    this.config.set(config.body);
    if (me.status === 200) {
      const stored = await getJson<Settings>("/api/settings");
      this.settings.set(stored.body);
      this.state.set({ ready: true, me: me.body });
    } else this.state.set({ ready: true, me: null });
  }

  signedIn(me: Me): Promise<void> {
    return getJson<Settings>("/api/settings").then((stored) => {
      this.settings.set(stored.body);
      this.state.set({ ready: true, me });
    });
  }

  verified(): void {
    const { me } = this.state.get();
    if (me) this.state.set({ ready: true, me: { ...me, verified: true } });
  }

  signedOut(): void {
    this.settings.set(guestSettings());
    this.state.set({ ready: true, me: null });
  }

  sessionEnded(): void {
    if (this.state.get().me) this.state.set({ ready: true, me: null });
  }

  /** Applies a settings change at once on screen, then saves it: in the browser for guests, on the server for signed-in typists. */
  change(patch: Partial<Settings>): void {
    const next = { ...this.settings.get(), ...patch };
    this.settings.set(next);
    if (this.state.get().me) {
      this.dirty = true;
      void this.flush();
    } else localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }

  private async flush(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    while (this.dirty) {
      this.dirty = false;
      try {
        await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.settings.get()) });
      } catch {
        this.dirty = true;
        break;
      }
    }
    this.saving = false;
  }
}

export const viewer = new Viewer();
