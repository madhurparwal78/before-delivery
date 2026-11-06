import type { Note } from "../../shared/types.js";
import { api, ApiFailure } from "../api.js";
import { h, icon, formatInstant } from "../dom.js";
import { openDialog, statusLabel, feedback, prefersReducedMotion, TEMPO } from "../ui.js";

/** A saved highlight in the reading view. */
export interface NoteViewOptions {
  note: Note;
  timeZone: string;
  isHeadOfProduct: boolean;
  isProductManager: boolean;
  onChanged(): Promise<void>;
  onDeleted(): void;
  onClose(): void;
}

interface TextPiece {
  node: Text;
  start: number;
  end: number;
}

const IMPORTANCE_LABELS: Record<string, string> = {
  nice_to_have: "Nice to have",
  important: "Important",
  critical: "Critical",
};

/** Map the note's plain text onto its rendered body's text nodes. */
function textPieces(container: HTMLElement): TextPiece[] {
  const pieces: TextPiece[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let current = walker.nextNode();
  while (current !== null) {
    const text = current as Text;
    pieces.push({ node: text, start: offset, end: offset + text.data.length });
    offset += text.data.length;
    current = walker.nextNode();
  }
  return pieces;
}

export interface PendingSpan {
  start: number;
  end: number;
}

interface SavedSpan {
  id: string;
  start: number;
  end: number;
}

/**
 * Render the note body with saved and pending highlights as mark segments
 * (DP-52). A run crossing an element boundary becomes several marks.
 */
export function renderMarkedBody(
  body: HTMLElement,
  textLength: number,
  saved: SavedSpan[],
  pending: PendingSpan | null,
): void {
  const pieces = textPieces(body);
  const bounds = new Set<number>([0, textLength]);
  for (const s of saved) {
    bounds.add(s.start);
    bounds.add(s.end);
  }
  if (pending !== null) {
    bounds.add(pending.start);
    bounds.add(pending.end);
  }
  const points = [...bounds].sort((a, b) => a - b);

  for (const piece of pieces) {
    const parent = piece.node.parentElement;
    if (parent === null || parent.closest("mark") !== null) continue;
    const runs: Array<{ start: number; end: number }> = [];
    for (let i = 0; i + 1 < points.length; i++) {
      const start = Math.max(points[i]!, piece.start);
      const end = Math.min(points[i + 1]!, piece.end);
      if (end <= start) continue;
      const covered =
        saved.some((s) => s.start <= start && end <= s.end) ||
        (pending !== null && pending.start <= start && end <= pending.end);
      if (covered) runs.push({ start, end });
    }
    if (runs.length === 0) continue;
    const fragment = document.createDocumentFragment();
    let cursor = piece.start;
    const data = piece.node.data;
    for (const run of runs) {
      if (run.start > cursor) {
        fragment.appendChild(
          document.createTextNode(data.slice(cursor - piece.start, run.start - piece.start)),
        );
      }
      const coveringIds = saved
        .filter((s) => s.start <= run.start && run.end <= s.end)
        .map((s) => s.id)
        .sort((a, b) => (a < b ? -1 : 1));
      const isPending =
        pending !== null && pending.start <= run.start && run.end <= pending.end;
      const depth = coveringIds.length + (isPending ? 1 : 0);
      const mark = document.createElement("mark");
      mark.dataset.start = String(run.start);
      mark.dataset.end = String(run.end);
      mark.dataset.insights = coveringIds.join(" ");
      mark.className = depth > 1 ? "overlap" : "saved-mark";
      if (isPending) {
        mark.classList.add("pending-mark");
        mark.dataset.pending = "true";
      }
      mark.addEventListener("click", () => {
        showMarkPopover(mark);
      });
      mark.appendChild(
        document.createTextNode(data.slice(run.start - piece.start, run.end - piece.start)),
      );
      fragment.appendChild(mark);
      cursor = run.end;
    }
    if (cursor < piece.end) {
      fragment.appendChild(document.createTextNode(data.slice(cursor - piece.start)));
    }
    piece.node.parentElement?.replaceChild(fragment, piece.node);
  }
}

function showMarkPopover(mark: HTMLElement): void {
  const insights = (mark.dataset.insights ?? "").split(" ").filter((id) => id.length > 0);
  if (insights.length === 0) return;
  openDialog((close) => {
    const wrap = h("div", null);
    wrap.appendChild(h("h2", null, "Linked evidence"));
    const list = h("ul", { class: "evidence-list" });
    for (const id of insights) {
      const row = h("li", null);
      const insight = currentNote?.insights.find((i) => i.id === id);
      row.appendChild(
        h("span", null, insight === undefined ? "" : `${insight.featureName} · ${statusLabel(insight.importance)}`),
      );
      const unlink = h("button", null, insight === undefined ? "Unlink" : `Unlink ${insight.featureName}`);
      unlink.addEventListener("click", async () => {
        try {
          const result = await api.unlinkInsight(id);
          announceEvidence(result.feature, result.before);
          close();
          await currentOptions?.onChanged();
        } catch (err) {
          reportFailure(err);
        }
      });
      row.appendChild(unlink);
      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }, mark);
}

let currentNote: Note | null = null;
let currentOptions: NoteViewOptions | null = null;

export function announceEvidence(
  feature: { name: string; impact: number; rank: number; rankTotal: number },
  before: { impact: number; rank: number },
): void {
  const impactText = `impact ${before.impact} → ${feature.impact}`;
  feedback?.evidence(`Linked to ${feature.name}; ${impactText}; now rank ${feature.rank} of ${feature.rankTotal}`);
}

export function announceUnlink(
  feature: { name: string; impact: number; rank: number; rankTotal: number },
  before: { impact: number; rank: number },
): void {
  const impactText = `impact ${before.impact} → ${feature.impact}`;
  feedback?.evidence(`Unlinked from ${feature.name}; ${impactText}; now rank ${feature.rank} of ${feature.rankTotal}`);
}

function reportFailure(err: unknown): void {
  if (err instanceof ApiFailure) feedback?.alert(err.error.error.message);
  else feedback?.alert("Something went wrong on our side. Nothing was saved.");
}

/** The reading column for one note. */
export function renderNoteView(options: NoteViewOptions): HTMLElement {
  const { note, timeZone } = options;
  currentNote = note;
  currentOptions = options;
  const root = h("article", { "aria-label": "Note" }) as HTMLElement;

  const savedSpans = (): SavedSpan[] =>
    note.insights.map((i) => ({ id: i.id, start: i.start, end: i.end }));

  const build = (): void => {
    const header = h("header", { class: "note-header" });
    header.appendChild(h("h2", null, note.title));
    header.appendChild(
      h(
        "dl",
        null,
        h("dt", null, "Source"),
        h("dd", null, statusLabel(note.source)),
        h("dt", null, "Contact"),
        h("dd", null, note.contact === null ? "—" : note.contact.name),
        h("dt", null, "Company"),
        h("dd", null, note.company === null ? "—" : note.company.name),
        h("dt", null, "Received"),
        h("dd", null, note.receivedOn === null ? formatInstant(note.createdAt, timeZone) : note.receivedOn),
      ),
    );
    root.replaceChildren(header);

    const body = h("div", { class: "note-body" });
    body.innerHTML = note.body;
    root.appendChild(body);
    renderMarkedBody(body, note.text.length, savedSpans(), null);
    attachTicks(body);

    if (note.attachments.length > 0) {
      const list = h("ul", { class: "attachment-list", "aria-label": "Attachments" });
      for (const attachment of note.attachments) {
        const li = h("li", null);
        if (attachment.status === "available") {
          li.appendChild(h("a", { href: `/api/attachments/${attachment.id}` }, attachment.filename));
        } else {
          li.appendChild(h("span", null, `${attachment.filename} — Pending upload`));
        }
        list.appendChild(li);
      }
      root.appendChild(list);
    } else {
      root.appendChild(h("ul", { class: "attachment-list", "aria-label": "Attachments" }));
    }

    const evidenceList = h("ul", { class: "evidence-list", "aria-label": "Linked evidence" });
    for (const insight of note.insights) {
      evidenceList.appendChild(
        h(
          "li",
          null,
          h("span", { class: "quote" }, `“${insight.quote}”`),
          h("span", null, ` · ${insight.featureName} · ${statusLabel(insight.importance)}`),
          h(
            "button",
            {
              onclick: async () => {
                try {
                  const result = await api.unlinkInsight(insight.id);
                  announceUnlink(result.feature, result.before);
                  await options.onChanged();
                } catch (err) {
                  reportFailure(err);
                }
              },
            },
            `Unlink ${insight.featureName}`,
          ),
        ),
      );
    }
    root.appendChild(evidenceList);

    const actions = h("div", { class: "note-actions" });
    if (options.isProductManager || options.isHeadOfProduct) {
      if (note.status === "unprocessed") {
        actions.appendChild(h("button", { onclick: () => void changeStatus("processed") }, "Mark processed"));
        actions.appendChild(snoozeButton());
      } else {
        actions.appendChild(h("button", { onclick: () => void changeStatus("unprocessed") }, "Reopen"));
        if (note.status === "snoozed") {
          actions.appendChild(snoozeButton());
        }
      }
      actions.appendChild(editButton());
      actions.appendChild(deleteButton());
    }
    root.appendChild(actions);
    attachSelectionHandling(root, body);
  };

  const changeStatus = async (to: "processed" | "unprocessed"): Promise<void> => {
    try {
      if (to === "processed") feedback?.saveStatus("");
      await api.noteStatus(note.id, to);
      feedback?.saveStatus(to === "processed" ? "Marked processed." : "Moved back to Unprocessed.");
      if (to === "processed") {
        options.onClose();
      } else {
        await options.onChanged();
      }
    } catch (err) {
      if (err instanceof ApiFailure) feedback?.alert(err.error.error.message);
      else feedback?.alert("Something went wrong on our side. Nothing was saved.");
    }
  };

  const snoozeButton = (): HTMLElement =>
    h("button", { onclick: (event: MouseEvent) => openSnoozeDialog(event.target as HTMLElement) }, "Snooze");

  const openSnoozeDialog = (opener: HTMLElement | null): void => {
    openDialog((close) => {
      const wrap = h("div", { "aria-label": "Snooze note" });
      wrap.appendChild(h("h2", null, "Snooze note"));
      const input = h("input", { type: "datetime-local", "aria-label": "Snooze until" }) as HTMLInputElement;
      const error = h("span", { class: "field-error" });
      const form = h(
        "form",
        {
          onsubmit: async (event: SubmitEvent) => {
            event.preventDefault();
            error.replaceChildren();
            feedback?.saveStatus("Snoozing…");
            try {
              await api.snoozeNote(note.id, input.value);
              feedback?.saveStatus(`Snoozed until ${snoozeLocalText(input.value, timeZone)}.`);
              close();
              await options.onChanged();
            } catch (err2) {
              feedback?.saveStatus("");
              if (err2 instanceof ApiFailure) {
                error.replaceChildren(err2.error.error.fields?.until ?? "Pick a time in the future.");
              }
            }
          },
        },
        h("label", null, "Snooze until"),
        input,
        h("p", { class: "field-error" }, `Time zone: ${timeZone}`),
        error,
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { type: "submit", class: "primary" }, "Snooze note"),
          h("button", { type: "button", onclick: close }, "Cancel"),
        ),
      );
      wrap.appendChild(form);
      return wrap;
    }, opener);
  };

  const editButton = (): HTMLElement =>
    h("button", { onclick: (event: MouseEvent) => openEditDialog(event.target as HTMLElement) }, "Edit note");

  const openEditDialog = (opener: HTMLElement | null): void => {
    openDialog((close) => {
      const wrap = h("div", { "aria-label": "Edit note" });
      wrap.appendChild(h("h2", null, "Edit note"));
      const title = h("input", { type: "text", value: note.title, "aria-label": "Title" }) as HTMLInputElement;
      const bodyInput = h("textarea", { "aria-label": "Note body" }) as HTMLTextAreaElement;
      bodyInput.value = note.body;
      const error = h("span", { class: "field-error" });
      const form = h(
        "form",
        {
          onsubmit: async (event: SubmitEvent) => {
            event.preventDefault();
            error.replaceChildren();
            feedback?.saveStatus("Saving changes…");
            try {
              await api.editNote(note.id, { title: title.value, body: bodyInput.value });
              feedback?.saveStatus("Note updated.");
              close();
              await options.onChanged();
            } catch (err) {
              feedback?.saveStatus("");
              if (err instanceof ApiFailure) {
                const message = err.error.error.message;
                error.replaceChildren(
                  message === "This edit removes highlighted text."
                    ? `This edit removes highlighted text from ${note.insights.length} linked insights. Unlink them first or keep that text.`
                    : message,
                );
              }
            }
          },
        },
        h("label", null, "Title"),
        title,
        h("label", null, "Note body"),
        bodyInput,
        error,
        h(
          "div",
          { class: "dialog-actions" },
          h("button", { type: "submit", class: "primary" }, "Save changes"),
          h("button", { type: "button", onclick: close }, "Cancel"),
        ),
      );
      wrap.appendChild(form);
      return wrap;
    }, opener);
  };

  const deleteButton = (): HTMLElement =>
    h("button", { onclick: (event: MouseEvent) => openDeleteDialog(event.target as HTMLElement) }, "Delete note");

  const openDeleteDialog = (opener: HTMLElement | null): void => {
    openDialog((close) => {
      const wrap = h("div", { role: "alertdialog", "aria-label": "Delete note?" });
      wrap.appendChild(h("h2", null, "Delete note?"));
      wrap.appendChild(h("p", null, `This also removes its ${note.insights.length} linked insights.`));
      wrap.appendChild(
        h(
          "div",
          { class: "dialog-actions" },
          h(
            "button",
            {
              onclick: async () => {
                feedback?.saveStatus("Deleting note…");
                try {
                  await api.deleteNote(note.id);
                  feedback?.saveStatus("Note deleted.");
                  close();
                  options.onDeleted();
                } catch (err) {
                  feedback?.saveStatus("");
                  reportFailure(err);
                }
              },
            },
            "Delete",
          ),
          h("button", { onclick: close }, "Cancel"),
        ),
      );
      return wrap;
    }, opener);
  };

  /** Place the tick beside the last mark of an insight. */
  const attachTicks = (body: HTMLElement): void => {
    for (const insight of note.insights) {
      const tick = h(
        "span",
        { class: "linked-tick" },
        icon("Check", 12),
        `Linked to ${insight.featureName}`,
      );
      const marks = [...body.querySelectorAll<HTMLElement>("mark")];
      const target = marks
        .filter((m) => Number(m.dataset.end) === insight.end)
        .sort((a, b) => Number(b.dataset.start) - Number(a.dataset.start))[0];
      target?.parentElement?.insertBefore(tick, target.nextSibling);
    }
  };

  /** Selection capture in the note body (DP-04). */
  const attachSelectionHandling = (rootEl: HTMLElement, initialBody: HTMLElement): void => {
    let body = initialBody;
    let pendingSpan: PendingSpan | null = null;
    let toolbar: HTMLElement | null = null;

    const rerenderMarks = (): void => {
      const fresh = h("div", { class: "note-body" });
      fresh.innerHTML = note.body;
      renderMarkedBody(fresh, note.text.length, savedSpans(), pendingSpan);
      body.replaceWith(fresh);
      body = fresh;
      if (pendingSpan === null) attachTicks(body);
    };

    const clearPending = (): void => {
      if (pendingSpan === null) return;
      pendingSpan = null;
      toolbar?.remove();
      toolbar = null;
      rerenderMarks();
    };

    document.addEventListener("selectionchange", () => {
      const selection = document.getSelection();
      if (selection === null || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!body.contains(range.commonAncestorContainer)) return;
      const pieces = textPieces(body);
      let start = -1;
      let end = -1;
      for (const piece of pieces) {
        if (piece.node === range.startContainer) start = piece.start + range.startOffset;
        if (piece.node === range.endContainer) end = piece.start + range.endOffset;
      }
      if (start < 0 || end < 0 || end <= start) return;
      const text = note.text;
      const snap = (offset: number, towardEnd: boolean): number => {
        if (offset <= 0 || offset >= text.length) return offset;
        const prev = text.charCodeAt(offset - 1);
        const cur = text.charCodeAt(offset);
        const prevHigh = prev >= 0xd800 && prev <= 0xdbff;
        const curLow = cur >= 0xdc00 && cur <= 0xdfff;
        if (prevHigh && curLow) return towardEnd ? offset + 1 : offset - 1;
        return offset;
      };
      start = snap(start, false);
      end = snap(end, true);
      if (text.slice(start, end).trim().length === 0) return;
      if (pendingSpan !== null && pendingSpan.start === start && pendingSpan.end === end) return;
      pendingSpan = { start, end };
      rerenderMarks();
      showToolbar();
    });

    const showToolbar = (): void => {
      toolbar?.remove();
      toolbar = h(
        "div",
        { class: "selection-toolbar" },
        h("button", { onclick: () => void openLinkDialog() }, "Link to feature · L"),
      ) as HTMLElement;
      document.body.appendChild(toolbar);
      const marks = [...body.querySelectorAll<HTMLElement>("mark[data-pending='true']")];
      const last = marks[marks.length - 1];
      if (last !== undefined) {
        const rect = last.getBoundingClientRect();
        (toolbar as HTMLElement).style.left = `${rect.left}px`;
        (toolbar as HTMLElement).style.top = `${rect.top}px`;
      }
    };

    const openLinkDialog = async (): Promise<void> => {
      if (pendingSpan === null) return;
      const span = pendingSpan;
      const quote = note.text.slice(span.start, span.end);
      openDialog(
        (close) => {
          const wrap = h("div", { "aria-label": "Link quote to feature" });
          wrap.appendChild(h("h2", null, "Link quote to feature"));
          wrap.appendChild(h("p", { class: "quote-display" }, `“${quote}”`));
          const input = h("input", {
            type: "text",
            role: "combobox",
            "aria-label": "Feature",
            placeholder: "Type a feature name",
          }) as HTMLInputElement;
          let importance = "important";
          const matched: Array<{ id: string; name: string }> = [];
          const list = h("ul", { class: "hierarchy-tree" }) as HTMLElement;
          const paintMatches = (features: Array<{ id: string; name: string }>): void => {
            matched.length = 0;
            matched.push(...features);
            list.replaceChildren(...features.map((f) => h("li", null, f.name)));
          };
          const refresh = async (): Promise<void> => {
            const q = input.value.trim();
            const result = await api.features(q.length === 0 ? undefined : q);
            paintMatches(result.features.map((f) => ({ id: f.id, name: f.name })));
          };
          input.addEventListener("input", () => void refresh());
          input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const chosen = matched[0];
            if (chosen === undefined) return;
            void commit(chosen.id);
          });
          const commit = async (featureId: string): Promise<void> => {
            feedback?.saveStatus("Linking…");
            try {
              const result = await api.linkInsight({
                noteId: note.id,
                featureId,
                start: span.start,
                end: span.end,
                importance,
              });
              announceEvidence(result.feature, result.before);
              close();
              await options.onChanged();
              runThread(result.feature.name);
            } catch (err) {
              feedback?.saveStatus("");
              if (err instanceof ApiFailure) {
                feedback?.alert(err.error.error.message);
              }
            }
          };
          const form = h(
            "form",
            {
              onsubmit: (event: SubmitEvent) => {
                event.preventDefault();
                const chosen = matched[0];
                if (chosen !== undefined) void commit(chosen.id);
              },
            },
            h("label", null, "Feature"),
            input,
            list,
            h("div", { class: "radio-row", role: "radiogroup", "aria-label": "Importance" },
              ...(["nice_to_have", "important", "critical"] as const).map((value) =>
                h("label", null,
                  h("input", {
                    type: "radio",
                    name: "importance",
                    value,
                    checked: value === "important",
                    onchange: () => {
                      importance = value;
                    },
                  }),
                  IMPORTANCE_LABELS[value],
                ),
              ),
            ),
            h("div", { class: "dialog-actions" },
              h("button", { type: "submit", class: "primary" }, "Link quote"),
              h("button", { type: "button", onclick: close }, "Cancel"),
            ),
          );
          wrap.appendChild(form);
          void refresh();
          return wrap;
        },
        document.querySelector<HTMLButtonElement>(".selection-toolbar button"),
      );
    };

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        clearPending();
        return;
      }
      if ((event.key === "l" || event.key === "L") && pendingSpan !== null) {
        const inField = (document.activeElement as HTMLElement | null)?.matches("input, textarea, select") ?? false;
        if (!inField && document.querySelector("dialog") === null) {
          event.preventDefault();
          void openLinkDialog();
        }
      }
    });

    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target === null) return;
      if (body.contains(target)) return;
      if (toolbar !== null && toolbar.contains(target)) return;
      if (document.querySelector("dialog") === null) clearPending();
    });
  };

  /** The evidence thread draws from the mark to the rail (DP-06). */
  const runThread = (featureName: string): void => {
    if (prefersReducedMotion()) {
      return;
    }
    const railRow = document.querySelector(`[data-feature-row="${cssEscape(featureName)}"]`);
    const marks = [...root.querySelectorAll<HTMLElement>("mark[data-pending='true']")];
    const from = marks[marks.length - 1];
    // The thread draws only when the rail is visible (below 900 pixels the
    // rail is on another tab, so only the dialog path exists).
    if (railRow === null || from === undefined || (railRow as HTMLElement).offsetParent === null) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("evidence-thread");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Evidence thread to ${featureName}`);
    const fromRect = from.getBoundingClientRect();
    const toRect = (railRow as HTMLElement).getBoundingClientRect();
    const width = Math.max(2, toRect.left - fromRect.right);
    const height = Math.max(2, Math.abs(toRect.top - fromRect.top));
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.left = `${fromRect.right}px`;
    svg.style.top = `${Math.min(fromRect.top, toRect.top)}px`;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const y1 = fromRect.top < toRect.top ? 0 : height;
    const y2 = fromRect.top < toRect.top ? height : 0;
    path.setAttribute("d", `M 0 ${y1} C ${width * 0.6} ${y1}, ${width * 0.4} ${y2}, ${width} ${y2}`);
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.style.transition = `stroke-dashoffset ${TEMPO.slow}ms ease-in-out`;
    svg.appendChild(path);
    document.body.appendChild(svg);
    requestAnimationFrame(() => {
      path.style.strokeDashoffset = "0";
    });
    window.setTimeout(() => {
      svg.remove();
    }, TEMPO.slow + TEMPO.quick);
  };

  build();
  return root;
}

function cssEscape(value: string): string {
  const escaped = value.replace(/["\\]/g, "\\$&");
  return escaped;
}

function snoozeLocalText(value: string, timeZone: string): string {
  const [date, time] = value.split("T");
  const instant = new Date(`${date}T${time}:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}
