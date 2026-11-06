// Licences (picture editor, licensing manager): the newsroom's licences and, for picture editors, originals.
import { dollars } from "../shared/money.js";
import { attempt, call, get } from "./api.js";
import { openDialog } from "./dialog.js";
import { h, icon, replace, say } from "./dom.js";
import type { AppContext } from "./main.js";
import type { Licence } from "./types.js";
import { badge, dataTable, emptyNote, INVOICE_STATE, KIND, LICENCE_STATE, mono, outageFrom, pageHead, RECEIPT_STATE } from "./ui.js";

const TONE: Record<string, string> = { active: "granted", pending_invoice: "pending", expired: "muted", revoked: "muted" };

export function mountLicences(root: HTMLElement, app: AppContext): () => void {
  const editor = app.user.role === "picture_editor";
  const body = h("div", {});
  replace(root, pageHead("Licences", `Every licence held by ${app.user.newsroom?.name ?? "your newsroom"}, newest first.`), body);
  let dialogOpen = false;

  async function load(): Promise<void> {
    const answer = await attempt(() => get<{ licences: Licence[] }>("/api/licences"));
    outageFrom(answer);
    if (!answer?.ok || !answer.data || dialogOpen) return;
    const licences = answer.data.licences;
    const columns = ["Essay", "Kind", "State", "Window ends", "Amount", "Invoice", "Receipt"];
    if (editor) columns.push("Originals");
    const rows = licences.map((l) => {
      const cells: (Node | string)[] = [
        h("span", { class: l.state === "revoked" ? "placeholder-title" : "item-title" }, l.essay_title),
        KIND[l.kind] ?? l.kind,
        badge(LICENCE_STATE[l.state] ?? l.state, TONE[l.state] ?? "muted"),
        mono(l.window_end_display),
        mono(dollars(l.amount_minor)),
        INVOICE_STATE[l.invoice_state] ?? l.invoice_state,
        l.receipt_state ? RECEIPT_STATE[l.receipt_state] ?? l.receipt_state : "—",
      ];
      if (editor) {
        if (l.state === "active") {
          const opener = h("button", { type: "button", class: "button button-ghost", "aria-label": `Download originals for ${l.essay_title}` },
            icon("download"), "Originals");
          opener.addEventListener("click", () => originals(l, opener));
          cells.push(opener);
        } else cells.push("");
      }
      return cells;
    });
    replace(body, licences.length ? dataTable("Licences", columns, rows, [3, 4])
      : emptyNote("No licences yet. Claim an exclusive window or buy a standard licence from the contact sheet."));
  }

  function originals(licence: Licence, opener: HTMLElement): void {
    dialogOpen = true;
    openDialog(`Originals: ${licence.essay_title}`, opener, (close) => {
      const status = h("p", { role: "status", "aria-label": "Download status", class: "status-line" });
      const buttons = licence.frames.map((frame) => {
        const button = h("button", { type: "button", class: "button button-ghost" }, icon("download"), `Download frame ${frame.position}`);
        button.addEventListener("click", () => void (async () => {
          button.disabled = true;
          say(status, "Preparing download…");
          const answer = await attempt(() => call<{ url: string; expires_at: string }>("POST",
            `/api/licences/${encodeURIComponent(licence.id)}/grants`, { frame_id: frame.id }));
          button.disabled = false;
          if (answer?.ok && answer.data) {
            const link = h("a", { href: answer.data.url, hidden: true });
            document.body.append(link);
            link.click();
            link.remove();
            say(status, "Download ready.");
            return;
          }
          const code = answer?.error?.code;
          say(status, answer === null ? "Couldn't reach Saltprint Desk. Nothing was changed; try again."
            : code === "licence_ended" ? `This licence ended at ${licence.window_end_display}. Originals are no longer available.`
              : code === "licence_revoked" ? "Licence revoked after a legal takedown. Originals are no longer available."
                : code === "licence_pending" ? "The invoice is still pending; originals unlock when it is raised."
                  : code === "storage_unavailable" ? "Image storage is unreachable. Try again shortly."
                    : answer.error?.message ?? "");
        })());
        return h("li", {}, button);
      });
      const done = h("button", { type: "button", class: "button button-quiet" }, "Close");
      done.addEventListener("click", close);
      return [
        h("h2", { class: "modal-title" }, `Originals: ${licence.essay_title}`),
        h("p", { class: "modal-lede" }, "Each link is signed for one frame and lasts at most five minutes, never past the licence end ",
          mono(licence.window_end_display), "."),
        h("ul", { class: "download-list" }, ...buttons),
        status,
        h("div", { class: "modal-actions" }, done),
      ];
    }, () => {
      dialogOpen = false;
    });
  }

  void load();
  const timer = window.setInterval(() => void load(), 10_000);
  return () => window.clearInterval(timer);
}
