import type { LiveMessage } from "../../shared/live.js";
import { ACCESS_CLOSE_CODE } from "../../shared/live.js";
import { mergeUnits } from "../../shared/units.js";
import { api } from "../api.js";

export type SaveState = "idle" | "saving" | "saved" | "retrying";

export interface SyncHooks {
  getText(): string;
  /** Shows server text in the editor, keeping the caret's line and column. */
  showText(text: string): void;
  saveState(state: SaveState): void;
  conflict(by: string, unit: string): void;
  readOnly(): void;
  lost(): void;
}

const RETRY_MS = 3000;

/**
 * Sends the editor's text to the server after quiet typing, one edit in flight at a time,
 * and keeps the editor on the server's text after every reply.
 */
export class EditSync {
  revision: number;
  serverText: string;
  private timer: number | undefined;
  private inFlight: Promise<boolean> | null = null;
  private remote: { revision: number; text: string } | null = null;
  private stopped = false;
  private holds = 0;

  constructor(
    private readonly projectId: string,
    revision: number,
    text: string,
    private readonly delayMs: number,
    private readonly hooks: SyncHooks,
  ) {
    this.revision = revision;
    this.serverText = text;
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
  }

  schedule(): void {
    if (this.stopped) return;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.send(), this.delayMs);
  }

  /** The server accepted a change made through another route (links, groups, restores...). */
  accept(revision: number, text: string): void {
    if (revision < this.revision) return;
    this.revision = revision;
    this.serverText = text;
  }

  /** Sends anything unsent and waits for it; false when it could not be saved. */
  async flush(): Promise<boolean> {
    window.clearTimeout(this.timer);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.inFlight) await this.inFlight;
      if (this.hooks.getText() === this.serverText) return true;
      if (!(await this.send())) return false;
    }
    return this.hooks.getText() === this.serverText;
  }

  /** Keeps incoming revisions aside while a diagram write and its typed write-back finish. */
  hold(): () => void {
    this.holds++;
    return () => {
      this.holds--;
      if (this.holds === 0) this.adoptRemote();
    };
  }

  /** A revision from someone else; shown at once unless this editor has unsent changes. */
  receive(revision: number, text: string): void {
    if (revision <= this.revision) return;
    if (!this.inFlight && this.holds === 0 && this.hooks.getText() === this.serverText) {
      this.revision = revision;
      this.serverText = text;
      this.hooks.showText(text);
    } else if (!this.remote || revision > this.remote.revision) {
      this.remote = { revision, text };
    }
  }

  private send(): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    const sent = this.hooks.getText();
    if (sent === this.serverText) {
      this.hooks.saveState("saved");
      return Promise.resolve(true);
    }
    this.hooks.saveState("saving");
    this.inFlight = this.exchange(sent).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async exchange(sent: string): Promise<boolean> {
    const result = await api<{ revision: number; text: string; merged: boolean }>("POST", `/api/projects/${this.projectId}/edits`, {
      baseRevision: this.revision,
      text: sent,
    });
    if (result.ok) {
      this.revision = result.data.revision;
      this.serverText = result.data.text;
      const local = this.hooks.getText();
      if (local === sent) {
        if (result.data.text !== local) this.hooks.showText(result.data.text);
      } else if (result.data.text !== sent) {
        const rebased = mergeUnits(sent, local, result.data.text);
        this.hooks.showText(rebased.ok ? rebased.text : result.data.text);
      }
      this.adoptRemote();
      if (this.hooks.getText() === this.serverText) this.hooks.saveState("saved");
      else this.schedule();
      return true;
    }
    const error = result.error;
    if (result.status === 409 && error?.revision !== undefined && error.text !== undefined) {
      this.revision = error.revision;
      this.serverText = error.text;
      this.hooks.showText(error.text);
      const conflict = error.conflicts?.[0];
      if (conflict) this.hooks.conflict(conflict.by, conflict.unit);
      this.hooks.saveState("saved");
      return false;
    }
    if (result.status === 403) {
      this.hooks.readOnly();
      return false;
    }
    if (result.status === 404) {
      this.hooks.lost();
      return false;
    }
    if (result.status === 0 || result.status >= 500) {
      this.hooks.saveState("retrying");
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => void this.send(), RETRY_MS);
      return false;
    }
    this.hooks.saveState("idle");
    return false;
  }

  private adoptRemote(): void {
    if (this.holds > 0) return;
    const remote = this.remote;
    this.remote = null;
    if (remote && remote.revision > this.revision && this.hooks.getText() === this.serverText) {
      this.revision = remote.revision;
      this.serverText = remote.text;
      this.hooks.showText(remote.text);
    }
  }
}

export interface LiveHooks {
  message(message: LiveMessage): void;
}

/** The project's live channel: pings to stay present, reconnects after drops, stops when access ends. */
export class LiveChannel {
  private socket: WebSocket | null = null;
  private ping: number | undefined;
  private closed = false;

  constructor(
    private readonly path: string,
    private readonly hooks: LiveHooks,
  ) {
    this.open();
  }

  private open(): void {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${this.path}`;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      if (message.type === "hello") {
        window.clearInterval(this.ping);
        const every = Math.max(1000, (message.presenceTimeoutSeconds * 1000) / 3 - 250);
        this.ping = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
        }, every);
      }
      this.hooks.message(message);
    };
    socket.onclose = (event) => {
      window.clearInterval(this.ping);
      if (this.closed || event.code === ACCESS_CLOSE_CODE) return;
      window.setTimeout(() => {
        if (!this.closed) this.open();
      }, 2000);
    };
  }

  close(): void {
    this.closed = true;
    window.clearInterval(this.ping);
    this.socket?.close();
  }
}
