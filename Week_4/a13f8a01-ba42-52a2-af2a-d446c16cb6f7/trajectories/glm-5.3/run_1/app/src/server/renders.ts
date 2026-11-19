import { randomBytes } from "node:crypto";
import type { Panes } from "../shared/snapshot.js";

export interface RenderRecord {
  id: string;
  nonce: string;
  penId: string | null;
  html: string;
  css: string;
  js: string;
  libraries: string[];
  createdAt: number;
}

const TTL_MS = 15 * 60 * 1000;

export class RenderStore {
  private renders = new Map<string, RenderRecord>();

  create(panes: Panes, libraries: string[], penId: string | null): RenderRecord {
    this.prune();
    const rec: RenderRecord = {
      id: randomBytes(12).toString("hex"),
      nonce: randomBytes(12).toString("hex"),
      penId,
      html: panes.html,
      css: panes.css,
      js: panes.js,
      libraries,
      createdAt: Date.now(),
    };
    this.renders.set(rec.id, rec);
    return rec;
  }

  get(id: string): RenderRecord | null {
    const rec = this.renders.get(id);
    if (!rec) return null;
    if (Date.now() - rec.createdAt > TTL_MS) {
      this.renders.delete(id);
      return null;
    }
    return rec;
  }

  deletePenRenders(penId: string): void {
    for (const [id, rec] of this.renders) {
      if (rec.penId === penId) this.renders.delete(id);
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, rec] of this.renders) {
      if (now - rec.createdAt > TTL_MS) this.renders.delete(id);
    }
  }
}

