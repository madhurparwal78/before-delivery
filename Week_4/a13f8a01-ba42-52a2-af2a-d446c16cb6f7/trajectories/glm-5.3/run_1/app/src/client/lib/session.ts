// Session state shared by every page, plus the live update stream.
import type { User } from "./api.js";
import { Api } from "./api.js";

export interface Session {
  user: User | null;
}

let currentUser: User | null = null;
let loaded = false;

export async function me(): Promise<User | null> {
  if (!loaded) {
    try {
      const res = await Api.get<{ user: User }>("/api/me");
      currentUser = res.user;
    } catch {
      currentUser = null;
    }
    loaded = true;
  }
  return currentUser;
}

export function setUser(user: User | null): void {
  currentUser = user;
  loaded = true;
}

export async function signOut(): Promise<void> {
  try {
    await Api.post("/api/signout");
  } catch {
    // the cookie may already be gone
  }
  currentUser = null;
  loaded = false;
}

export interface LiveCounts {
  likes: number;
  forks: number;
}

// One events stream per page; counts are refreshed from the API when told.
export class LiveFeed {
  private es: EventSource | null = null;
  private pollTimer: number | null = null;
  private pollMs = 1000;
  private onCounts: ((penId: string, likes: number, forks: number) => void) | null = null;
  private onHead: ((penId: string, head: number) => void) | null = null;
  private onAccount: ((verified: boolean) => void) | null = null;

  constructor(
    private penIds: string[],
    private userId: string | null,
  ) {}

  setHandlers(handlers: {
    counts?: (penId: string, likes: number, forks: number) => void;
    head?: (penId: string, head: number) => void;
    account?: (verified: boolean) => void;
  }): void {
    this.onCounts = handlers.counts ?? null;
    this.onHead = handlers.head ?? null;
    this.onAccount = handlers.account ?? null;
  }

  start(): void {
    if (typeof EventSource !== "undefined") {
      try {
        this.es = new EventSource(`/api/events?pens=${this.penIds.join(",")}`);
        this.es.addEventListener("counts", (ev) => {
          const data = JSON.parse((ev as MessageEvent).data) as { pen_id: string; likes: number; forks: number };
          this.onCounts?.(data.pen_id, data.likes, data.forks);
        });
        this.es.addEventListener("head", (ev) => {
          const data = JSON.parse((ev as MessageEvent).data) as { pen_id: string; head: number };
          this.onHead?.(data.pen_id, data.head);
        });
        this.es.addEventListener("account", (ev) => {
          const data = JSON.parse((ev as MessageEvent).data) as { verified: boolean };
          this.onAccount?.(data.verified);
        });
        this.es.onerror = () => {
          this.es?.close();
          this.es = null;
          this.startPolling();
        };
        return;
      } catch {
        this.startPolling();
      }
    }
    this.startPolling();
  }

  private polling = false;

  private startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    const tick = async () => {
      for (const penId of this.penIds) {
        try {
          const pen = await Api.get<{ likes: number; forks: number; head: number }>(`/api/pens/${penId}`);
          this.onCounts?.(penId, pen.likes, pen.forks);
          this.onHead?.(penId, pen.head);
        } catch {
          // pen may have become invisible
        }
      }
    };
    void tick();
    this.pollTimer = window.setInterval(tick, this.pollMs);
  }

  stop(): void {
    this.es?.close();
    this.es = null;
    if (this.pollTimer !== null) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.polling = false;
  }
}
