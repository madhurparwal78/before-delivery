// Session detail: confidence ribbon, the session field, the stat strip, the transcript and the
// segment inspector, driven only by server state.
import type { Correction, FrameEvent, Project, Quota, Segment, Session, SessionState, Spectrum, Word } from "../../shared/types";
import { ENDED_STATES, OPEN_CORRECTION_STATES } from "../../shared/types";
import { allows } from "../../shared/permissions";
import { band } from "../../shared/review";
import { minutesText } from "../../shared/billing";
import { werText } from "../../shared/review";
import { api, audioBlob, GENERIC_FAILURE, type Result } from "../api";
import { openDialog } from "../dialog";
import { field, h, icon, prefersReducedMotion, replace, say } from "../dom";
import { clock, quotaBanner, STATE_LABEL } from "../format";
import { SessionField, type FieldView } from "../field";
import type { Page } from "../main";

const WIDE = matchMedia("(min-width: 1200px)");
const COPY = {
  draftSaved: "Draft saved.",
  submitted: "Correction submitted for approval.",
  approved: "Correction approved. Reviewed transcript updated.",
  reopened: "Correction reopened as a draft.",
  conflict: "Another reviewer already has an open correction on this segment.",
  own: "You can't approve your own correction.",
  decided: "This correction was already decided.",
  textError: "Enter the corrected words.",
  noteError: "Add a note of up to 500 characters.",
  empty: "Select a flagged segment to review it.",
};

function statusCopy(state: SessionState, reason: string | null): string {
  switch (state) {
    case "connecting":
      return "Session connecting.";
    case "live":
      return "Session live.";
    case "closed":
      return reason === "cap" ? "Session closed: time limit reached." : "Session closed.";
    case "idle_closed":
      return "Session closed: no audio received.";
    case "quota_halted":
      return "Session halted: project quota reached.";
    case "revoked":
      return "Session ended: API key revoked.";
  }
}

function viewOf(state: SessionState): FieldView {
  if (state === "closed" || state === "idle_closed") return "closed";
  if (state === "quota_halted" || state === "revoked") return "quota_halted";
  return state;
}

export function renderSession(page: Page): void {
  const id = page.params[0];
  const role = page.me.user.role;
  const reduced = prefersReducedMotion();
  const canAuthor = allows(role, "corrections.author");
  const canDecide = allows(role, "corrections.decide");
  const canOperate = allows(role, "sessions.operate");

  // ---- skeleton, laid out at its final size before any data arrives ----
  const projectLink = h("a", { href: "/console/projects" }, "Project");
  const title = h("h1", { class: "session-title" }, page.handover.morph?.label ?? "Session");
  const chip = h("span", { class: "chip" }, "—");
  const sessionStatus = h("p", { role: "status", "aria-label": "Session status", class: "session-status" });
  const stop = h("button", { type: "button", class: "secondary", hidden: true }, icon("stop"), "Stop session");
  const head = h(
    "header",
    { class: "detail-head" },
    h("nav", { "aria-label": "Breadcrumb", class: "crumbs" }, h("a", { href: "/console/projects" }, "Projects"), h("span", { "aria-hidden": "true" }, "/"), projectLink),
    h("div", { class: "detail-title-row" }, title, h("div", { class: "detail-actions" }, sessionStatus, stop)),
  );

  const ribbon = h("ol", { "aria-label": "Confidence ribbon", class: "ribbon", tabindex: 0 });
  const sessionField = new SessionField("Session field", { reducedMotion: reduced });
  const headerLabel = h("span", { class: "field-header-label" }, page.handover.morph?.label ?? "");
  const headerChip = h("span", { class: "chip" }, "—");
  const fieldHeader = h("div", { class: "field-header", "data-morph": id }, headerLabel, headerChip);
  const fieldWrap = h("div", { class: "field-wrap" }, sessionField.canvas, fieldHeader);

  const stat = (label: string) => {
    const value = h("dd", { class: "num" }, "—");
    return { value, node: h("div", { class: "stat" }, h("dt", {}, label), value) };
  };
  const stats = { audio: stat("Audio"), frame: stat("Frame"), peak: stat("Peak bin"), channels: stat("Channels"), billable: stat("Billable minutes"), quota: stat("Quota used"), wer: stat("Word error rate") };
  const showWer = (wer: number | null) => say(stats.wer.value, wer === null ? "n/a" : werText(wer));
  const legend = h(
    "ul",
    { class: "legend", "aria-label": "Confidence bands" },
    ...(["high", "medium", "low"] as const).map((level) => h("li", {}, h("span", { class: `tile band-${level}`, "aria-hidden": "true" }), { high: "High", medium: "Medium", low: "Low" }[level])),
  );
  const statStrip = h("section", { "aria-label": "Session stats", class: "stat-strip" }, legend, h("dl", {}, ...Object.values(stats).map((s) => s.node)));
  const quotaStatus = h("div", { role: "status", "aria-label": "Quota status", class: "quota-status" });
  const confidenceTable = h("table", { "aria-label": "Segment confidence", class: "data compact" });
  const fieldPane = h("div", { class: "pane pane-field" }, ribbon, fieldWrap, statStrip, quotaStatus, sessionField.webgl ? null : h("div", { class: "still-table" }, confidenceTable));

  const reviewStatus = h("p", { role: "status", "aria-label": "Review status", class: "review-status" });
  const segmentList = h("ol", { class: "segments" });
  const transcript = h(
    "section",
    { "aria-label": "Transcript", class: "pane pane-transcript" },
    reviewStatus,
    h("div", { class: "transcript-head" }, h("h2", {}, "Transcript")),
    segmentList,
  );
  const inspector = h("div", { class: "inspector" });
  const inspectorRegion = h("section", { "aria-label": "Segment inspector", class: "pane pane-inspector" });
  const sheet = h("dialog", { "aria-label": "Segment inspector", class: "sheet" });
  page.root.append(head, h("div", { class: "detail-grid" }, fieldPane, transcript, inspectorRegion), sheet);
  page.root.classList.add("detail-page");

  // ---- list-to-detail morph: the row's thumbnail grows into the field header over 0.4 s ----
  const morph = page.handover.morph;
  if (morph && morph.id === id && !reduced) {
    const ghost = h("div", { class: "morph-ghost", "data-morph": id, "aria-hidden": "true" });
    const picture = morph.thumbnail.cloneNode(true) as Element;
    for (const name of ["data-morph", "role", "aria-label"]) picture.removeAttribute(name);
    ghost.append(picture);
    const from = morph.rect;
    const place = (r: { left: number; top: number; width: number; height: number }) =>
      Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    place(from);
    // One element carries the morph value at a time: the ghost while it moves, then the header.
    fieldHeader.removeAttribute("data-morph");
    fieldHeader.style.visibility = "hidden";
    document.body.append(ghost);
    let started = -1;
    let frame = 0;
    const step = (now: number) => {
      if (started < 0) started = now;
      const progress = Math.min(1, (now - started) / 400);
      const eased = 1 - (1 - progress) ** 3;
      const to = fieldHeader.getBoundingClientRect();
      place({
        left: from.left + (to.left - from.left) * eased,
        top: from.top + (to.top - from.top) * eased,
        width: from.width + (to.width - from.width) * eased,
        height: from.height + (to.height - from.height) * eased,
      });
      if (progress < 1) frame = requestAnimationFrame(step);
      else {
        ghost.remove();
        fieldHeader.setAttribute("data-morph", id);
        fieldHeader.style.visibility = "";
      }
    };
    frame = requestAnimationFrame(step);
    page.onLeave(() => {
      cancelAnimationFrame(frame);
      ghost.remove();
    });
  }

  // ---- state ----
  let session: Session | null = null;
  let project: Project | null = null;
  let segments: Segment[] = [];
  const openCorrections = new Map<string, Correction>();
  const drafts = new Map<string, string>();
  let selected: string | null = null;
  let closeSheet: (() => void) | null = null;
  const buttons = new Map<string, { li: HTMLLIElement; button: HTMLButtonElement }>();
  const tiles = new Map<string, HTMLLIElement[]>();
  const player = new Audio();

  const showQuota = (quota: Quota) => {
    say(stats.quota.value, `${minutesText(quota.used_seconds)} / ${quota.limit_minutes} min`);
    if (quota.exhausted) {
      if (quotaStatus.textContent !== quotaBanner(quota)) replace(quotaStatus, h("p", { class: "banner caution" }, quotaBanner(quota)));
    } else quotaStatus.replaceChildren();
  };

  const applyState = (state: SessionState, reason: string | null) => {
    say(sessionStatus, statusCopy(state, reason));
    sessionField.setView(viewOf(state), state);
    for (const c of [chip, headerChip]) {
      say(c, STATE_LABEL[state]);
      c.className = `chip state-${viewOf(state)}`;
    }
    stop.hidden = !(canOperate && !ENDED_STATES.includes(state));
  };

  const showSession = (s: Session) => {
    session = s;
    say(title, s.label);
    say(headerLabel, s.label);
    say(stats.audio.value, clock(s.audio_ms));
    say(stats.channels.value, String(s.channels));
    say(stats.billable.value, s.billable_seconds === null ? "—" : minutesText(s.billable_seconds));
  };

  // ---- ribbon and transcript, updated in place so focus and the inspector are never disturbed ----
  const tileFor = (word: Word) => {
    const level = band(word.confidence);
    return h(
      "li",
      { class: `tile band-${level}`, "data-confidence": word.confidence.toFixed(2), "data-band": level },
      h("span", { class: "tile-word" }, word.text),
      level === "low" ? h("span", { class: "tile-flag" }, "low") : null,
    );
  };

  const paintTiles = (segment: Segment) => {
    const words = segment.reviewed.words;
    const existing = tiles.get(segment.id);
    if (existing && existing.length === words.length) {
      words.forEach((word, i) => {
        const tile = existing[i];
        const level = band(word.confidence);
        tile.dataset.confidence = word.confidence.toFixed(2);
        tile.dataset.band = level;
        tile.className = `tile band-${level}`;
        tile.querySelector(".tile-word")!.textContent = word.text;
        const flag = tile.querySelector(".tile-flag");
        if (level === "low" && !flag) tile.append(h("span", { class: "tile-flag" }, "low"));
        if (level !== "low") flag?.remove();
      });
      return;
    }
    const fresh = words.map(tileFor);
    const after = segments.slice(segments.findIndex((s) => s.id === segment.id) + 1).find((s) => tiles.get(s.id)?.length);
    const anchor = after ? tiles.get(after.id)![0] : null;
    existing?.forEach((tile) => tile.remove());
    for (const tile of fresh) ribbon.insertBefore(tile, anchor);
    tiles.set(segment.id, fresh);
  };

  const paintSegment = (segment: Segment) => {
    const n = segment.index + 1;
    let entry = buttons.get(segment.id);
    if (!entry) {
      const button = h("button", { type: "button", class: "segment" });
      button.addEventListener("click", () => openInspector(segment.id, true));
      const li = h("li", {}, button);
      const next = segments.find((s) => s.index > segment.index && buttons.has(s.id));
      segmentList.insertBefore(li, next ? buttons.get(next.id)!.li : null);
      entry = { li, button };
      buttons.set(segment.id, entry);
    }
    const { button } = entry;
    button.setAttribute("aria-label", `Segment ${n}: ${segment.reviewed.text}`);
    button.dataset.flagged = String(segment.flagged);
    button.dataset.segment = segment.id;
    const correction = segment.open_correction;
    const badge = correction ? { draft: "Draft", submitted: "Awaiting approval", returned: "Returned", approved: "" }[correction.state] : segment.reviewed.source === "correction" ? "Reviewed" : "";
    replace(
      button,
      h("span", { class: "segment-n num" }, String(n).padStart(2, "0")),
      h("span", { class: "segment-time num" }, clock(segment.start_ms)),
      h("span", { class: "segment-text" }, segment.reviewed.text),
      h("span", { class: "segment-badges" }, segment.flagged ? h("span", { class: "badge caution" }, "Flagged") : null, badge ? h("span", { class: "badge" }, badge) : null),
    );
    paintTiles(segment);
  };

  const paintConfidenceTable = () => {
    if (sessionField.webgl) return;
    replace(
      confidenceTable,
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Word"), h("th", { scope: "col" }, "Start"), h("th", { scope: "col" }, "Confidence"))),
      h(
        "tbody",
        {},
        ...segments.flatMap((s) => s.reviewed.words).map((w) => h("tr", {}, h("td", {}, w.text), h("td", { class: "num" }, clock(w.start_ms)), h("td", { class: "num" }, w.confidence.toFixed(2)))),
      ),
    );
  };

  const upsert = (segment: Segment) => {
    const at = segments.findIndex((s) => s.id === segment.id);
    if (at >= 0) segments[at] = segment;
    else {
      segments.push(segment);
      segments.sort((a, b) => a.index - b.index);
    }
    paintSegment(segment);
    paintConfidenceTable();
  };

  const loadCorrections = async () => {
    if (!session) return;
    const found = await api<{ corrections: Correction[] }>("GET", `/api/projects/${session.project_id}/corrections`);
    if (!found.ok) return;
    openCorrections.clear();
    for (const c of found.data.corrections) if (c.session_id === id && OPEN_CORRECTION_STATES.includes(c.state)) openCorrections.set(c.segment_id, c);
  };

  const refreshTranscript = async () => {
    const [found] = await Promise.all([api<{ segments: Segment[]; wer: number | null }>("GET", `/api/sessions/${id}/transcript`), loadCorrections()]);
    if (!found.ok || !page.current()) return;
    found.data.segments.forEach(upsert);
    showWer(found.data.wer);
  };

  const flagged = () => segments.filter((s) => s.flagged);
  const buttonOf = (segmentId: string | null) => (segmentId ? buttons.get(segmentId)?.button ?? null : null);
  const currentIndex = () => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.segment;
    const segmentId = focused ?? selected;
    return segments.find((s) => s.id === segmentId)?.index ?? -1;
  };

  const moveFlagged = (direction: 1 | -1) => {
    const index = currentIndex();
    const list = flagged();
    const target = direction > 0 ? list.find((s) => s.index > index) ?? list.filter((s) => s.index >= index).pop() : [...list].reverse().find((s) => s.index < index);
    const fallback = direction > 0 ? list[list.length - 1] : list[0];
    buttonOf((target ?? fallback)?.id ?? null)?.focus();
  };

  // ---- the inspector ----
  let correctedText: HTMLTextAreaElement | null = null;
  let returnNote: HTMLTextAreaElement | null = null;

  /** Puts the inspector in the permanent region (1200 px and wider) or the sheet; true when it moved. */
  const mount = (): boolean => {
    const home = WIDE.matches ? inspectorRegion : sheet;
    if (inspector.parentElement === home) return false;
    home.appendChild(inspector);
    return true;
  };

  // The width change may arrive after a sheet has already opened at the new width; only widening closes it.
  const place = () => {
    if (WIDE.matches) closeSheet?.();
    if (mount()) paintInspector();
  };

  const play = async () => {
    const segmentId = selected ?? (document.activeElement as HTMLElement | null)?.dataset?.segment;
    if (!segmentId) return;
    const blob = await audioBlob(`/api/sessions/${id}/segments/${segmentId}/audio`);
    if (!blob || !page.current()) return;
    if (player.src) URL.revokeObjectURL(player.src);
    player.src = URL.createObjectURL(blob);
    player.play().catch(() => undefined);
  };

  const failure = (result: Result<unknown>, errors: { text?: (m: string | null) => void; note?: (m: string | null) => void }) => {
    if (result.ok) return;
    const { error } = result;
    if (error.error === "validation_failed" && error.fields?.text) errors.text?.(error.fields.text);
    else if (error.error === "validation_failed" && error.fields?.note) errors.note?.(error.fields.note);
    else if (error.error === "correction_open") say(reviewStatus, COPY.conflict);
    else if (error.error === "own_correction") say(reviewStatus, COPY.own);
    else if (error.error === "invalid_transition") say(reviewStatus, COPY.decided);
    else say(reviewStatus, GENERIC_FAILURE);
  };

  const mine = (segment: Segment) => (segment.open_correction?.author_id === page.me.user.id ? openCorrections.get(segment.id) ?? null : null);

  /** Saves the typed text as this author's draft, creating it when needed. */
  const saveDraft = async (segment: Segment, text: string, errors: { text: (m: string | null) => void }): Promise<Correction | null> => {
    errors.text(null);
    const own = mine(segment);
    const result = own
      ? await api<{ correction: Correction }>("PATCH", `/api/corrections/${own.id}`, { text })
      : await api<{ correction: Correction }>("POST", `/api/sessions/${id}/segments/${segment.id}/corrections`, { text });
    if (!result.ok) {
      failure(result, errors);
      return null;
    }
    openCorrections.set(segment.id, result.data.correction);
    return result.data.correction;
  };

  const afterSubmit = async (segment: Segment) => {
    drafts.delete(segment.id);
    await refreshTranscript();
    const next = flagged().find((s) => s.index > segment.index) ?? segment;
    if (closeSheet) {
      const close = closeSheet;
      selected = null;
      closeSheet = null;
      close();
      paintInspector();
    } else {
      selected = next.id;
      paintInspector();
    }
    buttonOf(next.id)?.focus();
    syncQuery();
  };

  const submit = async (segment: Segment, button: HTMLButtonElement, errors: { text: (m: string | null) => void }) => {
    const text = correctedText?.value ?? "";
    const label = button.textContent;
    button.textContent = "Submitting";
    button.disabled = true;
    const own = mine(segment);
    const draft = own && own.state === "draft" && own.text === text.trim() ? own : await saveDraft(segment, text, errors);
    const result = draft ? await api<{ correction: Correction }>("POST", `/api/corrections/${draft.id}/submit`) : null;
    const hadFocus = document.activeElement === button || document.activeElement === document.body;
    button.disabled = false;
    button.textContent = label;
    // Disabling the pressed button dropped its focus; a refusal gives it back.
    if (hadFocus && (!result || !result.ok)) button.focus();
    if (!result) return;
    if (!result.ok) {
      failure(result, errors);
      return;
    }
    say(reviewStatus, COPY.submitted);
    await afterSubmit(segment);
  };

  const paintInspector = () => {
    correctedText = null;
    returnNote = null;
    const segment = segments.find((s) => s.id === selected);
    if (!segment) {
      replace(inspector, h("div", { class: "inspector-empty" }, emptyDrawing(), h("p", {}, COPY.empty)));
      return;
    }
    const playButton = h("button", { type: "button", class: "secondary" }, icon("play"), "Play segment audio");
    playButton.addEventListener("click", () => void play());
    const closeButton = WIDE.matches ? null : h("button", { type: "button", class: "ghost", onclick: () => closeInspector() }, icon("close"), "Close inspector");
    const parts: (Node | null)[] = [
      h(
        "header",
        { class: "inspector-head" },
        h("h2", {}, `Segment ${segment.index + 1}`),
        h("span", { class: "num muted" }, `${clock(segment.start_ms)}–${clock(segment.end_ms)}`),
        segment.flagged ? h("span", { class: "badge caution" }, "Flagged") : null,
      ),
      h("p", { class: "machine-line" }, h("span", { class: "label" }, "Machine"), segment.machine.text),
      playButton,
    ];
    const open = openCorrections.get(segment.id) ?? null;
    const own = mine(segment);
    // Someone else's open correction is shown for context; the server decides whether a new one may start.
    if (open && !own) {
      parts.push(
        h(
          "div",
          { class: "correction-card" },
          h("p", { class: "label" }, open.state === "submitted" ? `Awaiting approval · ${open.author.name}` : `${open.state === "draft" ? "Draft" : "Returned"} · ${open.author.name}`),
          h("p", { class: "correction-text" }, open.text),
        ),
      );
    }
    if (canAuthor && (!own || own.state === "draft")) {
      const area = h("textarea", { rows: 3, class: "corrected", spellcheck: "true" });
      area.value = drafts.get(segment.id) ?? own?.text ?? segment.reviewed.text;
      correctedText = area;
      const text = field("Corrected text", area);
      const save = h("button", { type: "button", class: "secondary" }, "Save draft");
      const send = h("button", { type: "button", class: "primary", "aria-label": "Submit for approval" }, "Submit for approval");
      save.addEventListener("click", async () => {
        const saved = await saveDraft(segment, area.value, { text: text.error });
        if (saved) {
          drafts.delete(segment.id);
          say(reviewStatus, COPY.draftSaved);
        }
      });
      send.addEventListener("click", () => void submit(segment, send, { text: text.error }));
      area.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          void submit(segment, send, { text: text.error });
        }
      });
      parts.push(text.root, h("p", { class: "hint" }, "Ctrl+Enter submits. Escape keeps your draft."), h("div", { class: "button-row" }, save, send));
    } else if (own && own.state === "returned") {
      const reopen = h("button", { type: "button", class: "primary" }, "Reopen as draft");
      reopen.addEventListener("click", async () => {
        const result = await api<{ correction: Correction }>("POST", `/api/corrections/${own.id}/reopen`);
        if (!result.ok) return failure(result, {});
        say(reviewStatus, COPY.reopened);
        await refreshTranscript();
        paintInspector();
      });
      parts.push(h("div", { class: "correction-card" }, h("p", { class: "label" }, "Returned with a note"), h("p", {}, own.note ?? ""), h("p", { class: "muted" }, own.text)), reopen);
    } else if (own) {
      parts.push(h("div", { class: "correction-card" }, h("p", { class: "label" }, "Awaiting approval · you"), h("p", { class: "correction-text" }, own.text)));
    }
    // Approvers decide any submitted correction; the server refuses their own and any already decided.
    if (canDecide && open?.state === "submitted") {
      const approve = h("button", { type: "button", class: "primary", "aria-label": "Approve correction" }, "Approve correction");
      const note = h("textarea", { rows: 2 });
      returnNote = note;
      const noteField = field("Return note", note);
      const giveBack = h("button", { type: "button", class: "secondary", "aria-label": "Return correction" }, "Return correction");
      const pending = (button: HTMLButtonElement, label: string | null) => {
        approve.disabled = giveBack.disabled = label !== null;
        button.textContent = label ?? (button === approve ? "Approve correction" : "Return correction");
      };
      approve.addEventListener("click", async () => {
        pending(approve, "Approving");
        const result = await api<{ correction: Correction; segment: Segment; wer: number }>("POST", `/api/corrections/${open.id}/approve`);
        pending(approve, null);
        if (!result.ok) {
          approve.focus();
          return failure(result, {});
        }
        say(reviewStatus, COPY.approved);
        openCorrections.delete(segment.id);
        upsert(result.data.segment);
        showWer(result.data.wer);
        paintInspector();
      });
      giveBack.addEventListener("click", async () => {
        noteField.error(null);
        pending(giveBack, "Returning");
        const result = await api<{ correction: Correction }>("POST", `/api/corrections/${open.id}/return`, { note: note.value });
        pending(giveBack, null);
        if (!result.ok) {
          giveBack.focus();
          return failure(result, { note: noteField.error });
        }
        say(reviewStatus, `Correction returned to ${open.author.name}.`);
        await refreshTranscript();
        paintInspector();
      });
      parts.push(h("div", { class: "button-row" }, approve), noteField.root, h("div", { class: "button-row" }, giveBack));
    }
    if (closeButton) parts.push(h("div", { class: "button-row end" }, closeButton));
    replace(inspector, ...parts);
  };

  const syncQuery = () => {
    const url = selected ? `/console/sessions/${id}?segment=${selected}` : `/console/sessions/${id}`;
    if (location.pathname + location.search !== url) history.replaceState(null, "", url);
  };

  function openInspector(segmentId: string, focusText: boolean) {
    if (selected && correctedText) drafts.set(selected, correctedText.value);
    selected = segmentId;
    mount();
    paintInspector();
    syncQuery();
    const target = () => (focusText ? correctedText ?? inspector.querySelector<HTMLElement>("button") : null);
    if (WIDE.matches) target()?.focus();
    else {
      const chosen = segmentId;
      closeSheet = openDialog(sheet, buttonOf(chosen), {
        initialFocus: target(),
        returnFocus: () => buttonOf(chosen),
        onClose: () => {
          if (correctedText && selected) drafts.set(selected, correctedText.value);
          selected = null;
          closeSheet = null;
          paintInspector();
          syncQuery();
        },
      });
    }
  }

  function closeInspector() {
    if (closeSheet) {
      closeSheet();
      return;
    }
    const was = selected;
    if (was && correctedText) drafts.set(was, correctedText.value);
    selected = null;
    paintInspector();
    syncQuery();
    buttonOf(was)?.focus();
  }

  // ---- review shortcuts: J, K, E, P anywhere in Transcript or the inspector, except while typing ----
  const onKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target === correctedText || target === returnNote) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeInspector();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      event.preventDefault();
      moveFlagged(key === "j" ? 1 : -1);
    } else if (key === "e") {
      const segmentId = target.dataset.segment ?? selected;
      if (!segmentId) return;
      event.preventDefault();
      openInspector(segmentId, true);
    } else if (key === "p") {
      event.preventDefault();
      void play();
    }
  };
  transcript.addEventListener("keydown", onKey);
  inspector.addEventListener("keydown", onKey);
  WIDE.addEventListener("change", place);
  page.onLeave(() => {
    WIDE.removeEventListener("change", place);
    closeSheet?.();
    sessionField.destroy();
    player.pause();
  });
  place();

  stop.addEventListener("click", async () => {
    stop.disabled = true;
    const result = await api<{ session: Session }>("POST", `/api/sessions/${id}/close`);
    stop.disabled = false;
    if (result.ok) {
      showSession(result.data.session);
      applyState(result.data.session.state, result.data.session.close_reason);
    }
  });

  // ---- data ----
  void (async () => {
    const [found, spectrum] = await Promise.all([api<{ session: Session }>("GET", `/api/sessions/${id}`), api<Spectrum>("GET", `/api/sessions/${id}/spectrum`)]);
    if (!page.current()) return;
    if (!found.ok) {
      say(sessionStatus, found.status === 404 ? "This session doesn't exist or isn't in your projects." : GENERIC_FAILURE);
      return;
    }
    const s = found.data.session;
    showSession(s);
    applyState(s.state, s.close_reason);
    if (spectrum.ok) {
      sessionField.load(spectrum.data.rows, spectrum.data.frame, spectrum.data.peak_bin, spectrum.data.mean);
      say(stats.frame.value, String(spectrum.data.frame));
      say(stats.peak.value, String(spectrum.data.peak_bin));
    }
    const [projectResult] = await Promise.all([api<{ project: Project }>("GET", `/api/projects/${s.project_id}`), refreshTranscript()]);
    if (!page.current()) return;
    if (projectResult.ok) {
      project = projectResult.data.project;
      say(projectLink, project.name);
      projectLink.setAttribute("href", `/console/projects/${project.id}/sessions`);
      showQuota(project.quota);
    }
    const wanted = page.query.get("segment");
    if (wanted && segments.some((seg) => seg.id === wanted)) openInspector(wanted, false);
    else paintInspector();
    listen();
    if (!sessionField.webgl) refreshStill();
  })();

  // Without WebGL, an open session's still is redrawn once per second from a fresh spectrum reading.
  function refreshStill() {
    const timer = setInterval(async () => {
      if (!session || ENDED_STATES.includes(session.state)) return;
      const spectrum = await api<Spectrum>("GET", `/api/sessions/${id}/spectrum`);
      if (spectrum.ok && page.current() && session && !ENDED_STATES.includes(session.state)) sessionField.setMean(spectrum.data.mean);
    }, 1000);
    page.onLeave(() => clearInterval(timer));
  }

  function listen() {
    const events = new EventSource(`/api/sessions/${id}/events`);
    page.onLeave(() => events.close());
    const data = <T>(event: Event) => JSON.parse((event as MessageEvent<string>).data) as T;
    let shownState = "";
    events.addEventListener("state", async (event) => {
      const { state, close_reason } = data<{ state: SessionState; close_reason: string | null }>(event);
      const key = `${state}/${close_reason ?? ""}`;
      if (key === shownState) return; // each reconnect to an ended session repeats its final state
      shownState = key;
      const before = session?.state;
      applyState(state, close_reason);
      if (before === state || !ENDED_STATES.includes(state)) return;
      const [fresh, spectrum] = await Promise.all([
        api<{ session: Session }>("GET", `/api/sessions/${id}`),
        viewOf(state) === "closed" ? api<Spectrum>("GET", `/api/sessions/${id}/spectrum`) : Promise.resolve(null),
      ]);
      if (!page.current()) return;
      if (fresh.ok) showSession(fresh.data.session);
      if (spectrum?.ok) {
        sessionField.load(spectrum.data.rows, spectrum.data.frame, spectrum.data.peak_bin, spectrum.data.mean);
        say(stats.frame.value, String(spectrum.data.frame));
        say(stats.peak.value, String(spectrum.data.peak_bin));
      }
    });
    events.addEventListener("frame", (event) => {
      const frame = data<FrameEvent>(event);
      sessionField.push(frame.bins, frame.frame, frame.peak_bin);
      say(stats.audio.value, clock(frame.audio_ms));
      say(stats.frame.value, sessionField.canvas.dataset.frame ?? "0");
      say(stats.peak.value, sessionField.canvas.dataset.peakBin ?? "0");
    });
    events.addEventListener("segment", (event) => upsert(data<Segment>(event)));
    events.addEventListener("correction", (event) => {
      const { segment, wer } = data<{ segment: Segment; wer: number | null }>(event);
      upsert(segment);
      showWer(wer);
      void loadCorrections();
    });
    events.addEventListener("quota", (event) => showQuota(data<Quota>(event)));
  }
}

function emptyDrawing(): SVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const drawing = document.createElementNS(ns, "svg");
  drawing.setAttribute("viewBox", "0 0 160 48");
  drawing.setAttribute("aria-hidden", "true");
  drawing.setAttribute("class", "empty-drawing");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", "M0 40 H40 L46 30 L52 38 L58 18 L64 36 L70 26 L76 40 H160");
  drawing.append(path);
  return drawing;
}
