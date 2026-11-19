// The Exports region: Export CSV, the writing indicator, download links, and one
// "Export status" message per table that belongs to that table's newest press.
import type { ExportRec } from "./api.js";
import { docPath, request, tablePath } from "./api.js";
import { COPY } from "./copy.js";
import { Dialog } from "./dialog.js";
import { announce, h, icon, reducedMotion } from "./dom.js";
import type { Workspace } from "./workspace.js";

interface TableExportState {
  status: HTMLElement;
  progress: HTMLElement | null;
  press: number;
}

export class ExportsPanel {
  private list: ExportRec[] = [];
  private readonly states = new Map<string, TableExportState>();
  private presses = 0;
  private readonly links = new Set<HTMLElement>();

  constructor(private readonly ws: Workspace) {
    reducedMotion.addEventListener("change", () => {
      if (!reducedMotion.matches) return;
      for (const s of this.states.values()) s.progress?.setAttribute("data-motion", "static");
    });
  }

  private state(tableId: string): TableExportState {
    let s = this.states.get(tableId);
    if (!s) {
      s = { status: h("div", { role: "status", "aria-label": "Export status", class: "export-status" }), progress: null, press: 0 };
      this.states.set(tableId, s);
    }
    return s;
  }

  // The region under the toolbar; at 375 the links live in the Exports sheet instead.
  region(phone: boolean): HTMLElement {
    const tableId = this.ws.table?.id;
    const wrap = phone ? h("div", { class: "exports exports-phone" }) : h("section", { "aria-label": "Exports", class: "exports" });
    if (!tableId) return wrap;
    const s = this.state(tableId);
    wrap.append(s.status);
    if (s.progress) wrap.append(s.progress);
    if (!phone) {
      const links = h("ul", { class: "export-links" });
      this.links.clear();
      this.links.add(links);
      this.fillLinks(links);
      wrap.append(links);
    }
    return wrap;
  }

  private ready(): ExportRec[] {
    return this.list.filter((e) => e.table_id === this.ws.table?.id && e.status === "ready" && e.download_url);
  }

  private fillLinks(list: HTMLElement): void {
    list.replaceChildren(
      ...this.ready().map((e) =>
        h("li", {}, h("a", {
          href: e.download_url!, class: "download-link",
          onclick: (ev: Event) => {
            ev.preventDefault();
            void this.download(e);
          },
        }, icon("download"), h("span", {}, `Download ${e.file_name}`))),
      ),
    );
  }

  async refresh(): Promise<void> {
    const answer = await request<{ exports: ExportRec[] }>("GET", `${docPath(this.ws.docId)}/exports`);
    if (!answer.ok) return;
    this.list = answer.data.exports;
    for (const list of this.links) this.fillLinks(list);
  }

  private say(s: TableExportState, press: number, text: string): void {
    if (s.press !== press) return;
    announce(s.status, text);
  }

  async exportShown(): Promise<void> {
    const table = this.ws.table;
    if (!table) return;
    const s = this.state(table.id);
    const press = ++this.presses;
    s.press = press;
    const file = `${table.name}.csv`;
    announce(s.status, COPY.writing(file));
    s.progress?.remove();
    const progress = h("div", {
      role: "progressbar", "aria-label": "Export progress", class: "export-progress",
      "data-motion": reducedMotion.matches ? "static" : "sweep",
    }, h("span", { class: "export-rule" }));
    s.progress = progress;
    s.status.after(progress);
    const answer = await request<{ export: ExportRec }>("POST", `${tablePath(this.ws.docId, table.id)}/exports`);
    if (s.press === press) {
      progress.remove();
      s.progress = null;
      if (answer.ok && answer.data.export.status === "ready") this.say(s, press, COPY.ready(answer.data.export.file_name));
      else this.say(s, press, COPY.exportFailed);
    }
    await this.refresh();
  }

  async download(e: ExportRec): Promise<void> {
    const s = this.state(e.table_id);
    const press = ++this.presses;
    s.press = press;
    let response: Response;
    try {
      response = await fetch(e.download_url!, { credentials: "same-origin" });
    } catch {
      this.say(s, press, COPY.storeUnreachable);
      return;
    }
    if (response.ok) {
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: e.file_name, class: "visually-hidden" });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      this.say(s, press, COPY.downloaded(e.file_name));
      return;
    }
    await response.text();
    const copy = response.status === 409 ? COPY.notReady : response.status === 502 ? COPY.corrupt : COPY.storeUnreachable;
    this.say(s, press, copy);
  }

  openSheet(opener: HTMLElement): void {
    const dialog = new Dialog({ title: "Exports", returnTo: () => this.ws.control("exports-sheet") ?? opener, onClose: () => this.links.delete(list) });
    const list = h("ul", { "aria-label": "Exports", class: "export-links sheet-links" });
    this.links.add(list);
    this.fillLinks(list);
    dialog.body.append(list.childElementCount ? list : h("div", {}, list, h("p", { class: "muted" }, "No files yet.")));
    dialog.show();
    void this.refresh();
  }
}
