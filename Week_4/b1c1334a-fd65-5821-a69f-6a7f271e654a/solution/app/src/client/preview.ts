// The live formula preview: one request per keystroke, only the reply for the current
// text is shown, and the settled preview is announced once after a 500 ms pause.
import { tablePath, request } from "./api.js";
import { COPY } from "./copy.js";
import { announce } from "./dom.js";
import type { Workspace } from "./workspace.js";

const PAUSE_MS = 500;

interface PreviewReply {
  display: string | null;
  kind: string | null;
  diagnosis: string | null;
}

export class Preview {
  private text = "";
  private shownFor: string | null = null;
  private paused = false;
  private announced = false;
  private timer = 0;

  constructor(
    private readonly ws: Workspace,
    private readonly status: HTMLElement,
    private readonly target: () => { tableId: string; rowId: string | null },
  ) {}

  update(text: string): void {
    this.text = text;
    this.paused = false;
    this.announced = false;
    clearTimeout(this.timer);
    this.shownFor = null;
    if (text === "") {
      this.status.textContent = "";
      return;
    }
    this.timer = window.setTimeout(() => {
      this.paused = true;
      this.tryAnnounce();
    }, PAUSE_MS);
    const { tableId, rowId } = this.target();
    if (!rowId) {
      this.show(text, COPY.noRows);
      return;
    }
    void request<PreviewReply>("POST", `${tablePath(this.ws.docId, tableId)}/formula-preview`, { formula: text, row_id: rowId }).then((answer) => {
      if (!answer.ok || text !== this.text) return;
      const r = answer.data;
      const copy = r.display === null ? r.diagnosis ?? "" : r.kind === "error" ? r.diagnosis ?? r.display : COPY.result(r.display);
      this.show(text, copy);
    });
  }

  private show(text: string, copy: string): void {
    this.status.textContent = copy;
    this.shownFor = text;
    this.tryAnnounce();
  }

  private tryAnnounce(): void {
    if (!this.paused || this.announced || this.shownFor !== this.text || this.text === "") return;
    this.announced = true;
    announce(this.ws.live.formula, this.status.textContent ?? "");
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}
