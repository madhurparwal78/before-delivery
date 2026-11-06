// The object page: blocks, editing with operations, merging live edits,
// quotes with the Margin Tether, presence carets, history and conflicts.
//
// The edit model: each text or quote block keeps the last committed body
// (from the server) and the draft the owner sees. Unsaved typing is the
// difference between the two, expressed as ops; it is transformed through
// the same rules the server uses.

import {
  api,
  apiFail,
  ApiFailure,
  NetworkFailure,
  getCsrfToken,
  type ObjectJson,
  type BlockJson,
  type BacklinkJson,
  type TypeJson,
} from "./api.js";
import { h, clearChildren, announce, alertMessage, clearAlert, reducedMotion, dateHeading, openDialog, dateTimeShort } from "./dom.js";
import { state, screens, mainEl, navigate, updateTopbarTitle, updateProgress } from "./app.js";
import { MOTION, QUIRE_CURVE, SAVE_DEBOUNCE, PRESENCE, UNDO_STACK } from "./constants.js";
import {
  sanitizeBody,
  plainText,
  editText,
  applyOps,
  transformOps,
  type Op,
} from "../shared/richtext.js";
import { openQuotePicker } from "./quote.js";
import { openHistoryDialog } from "./history.js";
import { buildProperties } from "./properties.js";

interface BlockState {
  id: string;
  kind: "text" | "quote" | "attachment";
  position: number;
  committed: string; // stored body confirmed by the server
  draft: string; // stored body shown on screen (committed + unsaved typing)
  version: number; // the version of committed
  origin: BlockJson["origin"];
  attachment: BlockJson["attachment"];
  saveTimer: number | null;
  inFlight: { ops: Op[]; baseVersion: number; editId: string } | null;
  conflictExpected: boolean;
  latestRemoteBody: string | null;
  lastPresence: number;
  focused: boolean;
  lastConfirmedEditId: string | null;
  lastEditId?: string;
}

interface ObjectScreen {
  dispose: () => void;
  objectId: string;
}

let currentObject: { id: string; blocks: Map<string, BlockState>; object: ObjectJson } | null = null;

export function blockById(id: string): BlockState | null {
  if (currentObject === null) return null;
  return currentObject.blocks.get(id) ?? null;
}

/** The stored-body form of an edit text, as a full replacement. */
export function editTextToBody(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return sanitizeBody(escaped.replace(/\n/g, "<br>"));
}

/** The ops from one text to another, as a single change. */
export function diffOps(before: string, after: string): Op[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB -= 1;
    endA -= 1;
  }
  if (start === endB && start === endA) return [];
  const ops: Op[] = [];
  if (start > 0) ops.push({ retain: start });
  if (endB > start) ops.push({ delete: endB - start });
  if (endA > start) ops.push({ insert: after.slice(start, endA) });
  if (endB < before.length) ops.push({ retain: before.length - endB });
  return ops;
}

/** The inverse of an op list, against the text the ops produced. */
export function invertOps(produced: string, ops: Op[]): Op[] {
  const out: Op[] = [];
  let resultPos = 0;
  let basePos = 0;
  for (const op of ops) {
    if ("retain" in op) {
      resultPos += op.retain;
      basePos += op.retain;
    } else if ("insert" in op) {
      if (resultPos > 0) out.push({ retain: resultPos });
      out.push({ delete: op.insert.length });
      resultPos += op.insert.length;
    } else {
      if (resultPos > 0) out.push({ retain: resultPos });
      out.push({ insert: produced.slice(basePos, basePos + op.delete) });
      basePos += op.delete;
    }
  }
  const rest = produced.length - resultPos;
  if (rest > 0) out.push({ retain: rest });
  return out.filter((op) => !("retain" in op && op.retain === 0));
}

// ---------------------------------------------------------------------------
// The undo and redo of this tab

type UndoStep =
  | { t: "typing"; blockId: string; ops: Op[]; produced: string; version: number | null; at?: number }
  | { t: "new block"; blockId: string }
  | { t: "block deletion"; blockId: string; body: string; objectId: string }
  | { t: "quote"; hostBlockId: string; originBlockId: string }
  | { t: "quote removal"; hostBlockId: string; originBlockId: string }
  | { t: "restore"; blockId: string; version: number };

const undoStack: UndoStep[] = [];
const redoStack: UndoStep[] = [];

export function pushUndo(step: UndoStep): void {
  undoStack.push(step);
  if (undoStack.length > UNDO_STACK) undoStack.shift();
  redoStack.length = 0;
}

/** The newest typing step for a block, for coalescing. */
function currentTypingStep(blockId: string): UndoStep | null {
  for (let i = undoStack.length - 1; i >= 0; i -= 1) {
    const s = undoStack[i];
    if (s.t === "typing" && s.blockId === blockId) {
      return i === undoStack.length - 1 ? s : null;
    }
    break;
  }
  return null;
}

export async function performUndo(): Promise<boolean> {
  const step = undoStack.pop();
  if (step === undefined) {
    announce("Nothing to undo.");
    return false;
  }
  const ok = await invertStep(step, false);
  if (ok) {
    redoStack.push(step);
    announce(`Undid ${step.t}.`);
  }
  return ok;
}

export async function performRedo(): Promise<boolean> {
  const step = redoStack.pop();
  if (step === undefined) {
    announce("Nothing to redo.");
    return false;
  }
  const ok = await redoStep(step);
  if (ok) {
    undoStack.push(step);
    announce(`Redid ${step.t}.`);
  }
  return ok;
}

async function invertStep(step: UndoStep, isRedo: boolean): Promise<boolean> {
  const label = isRedo ? "redo" : "undo";
  const b = step.t === "typing" || step.t === "restore" ? blockById(step.blockId) : null;
  try {
    switch (step.t) {
      case "typing": {
        if (b === null) throw new Error("gone");
        const inverse = invertOps(step.produced, step.ops);
        const base = step.version ?? b.version;
        const res = await api<BlockJson>("PATCH", `/api/blocks/${step.blockId}`, { ops: inverse, base_version: base });
        takeCommit(b, res.body ?? "", res.version);
        return true;
      }
      case "new block": {
        await api("DELETE", `/api/blocks/${step.blockId}`);
        return true;
      }
      case "block deletion": {
        await api("POST", `/api/objects/${step.objectId}/blocks`, { body: step.body, after_block_id: null });
        return true;
      }
      case "quote": {
        await api("DELETE", `/api/blocks/${step.hostBlockId}`);
        return true;
      }
      case "quote removal": {
        const host = currentObject?.id;
        if (host === undefined) return false;
        await api("POST", `/api/objects/${host}/quotes`, { origin_block_id: step.originBlockId, after_block_id: null });
        return true;
      }
      case "restore": {
        if (b === null) throw new Error("gone");
        const res = await api<BlockJson>("POST", `/api/blocks/${step.blockId}/restore`, { version: step.version, base_version: b.version });
        takeCommit(b, res.body ?? "", res.version);
        return true;
      }
    }
  } catch (e) {
    if (e instanceof ApiFailure) {
      if (step.t === "quote" || step.t === "quote removal") {
        alertMessage(`Can't ${label}: the quoted block no longer exists.`);
      } else if (e.body.error === "version_conflict") {
        alertMessage(`Can't ${label}: that text changed on another device.`);
      } else {
        alertMessage(apiFail(e, "base_version"));
      }
    } else {
      alertMessage("Not saved. Check your connection and try again.");
    }
    return false;
  }
}

async function redoStep(step: UndoStep): Promise<boolean> {
  const b = step.t === "typing" || step.t === "restore" ? blockById(step.blockId) : null;
  try {
    switch (step.t) {
      case "typing": {
        if (b === null) throw new Error("gone");
        const base = step.version ?? b.version;
        const res = await api<BlockJson>("PATCH", `/api/blocks/${step.blockId}`, { ops: step.ops, base_version: base });
        takeCommit(b, res.body ?? "", res.version);
        return true;
      }
      case "new block": {
        await api("POST", `/api/objects/${currentObject?.id ?? ""}/blocks`, { body: "" });
        return true;
      }
      case "block deletion": {
        await api("DELETE", `/api/blocks/${step.blockId}`);
        return true;
      }
      case "quote": {
        await api("POST", `/api/objects/${currentObject?.id ?? ""}/quotes`, { origin_block_id: step.originBlockId, after_block_id: step.hostBlockId });
        return true;
      }
      case "quote removal": {
        await api("DELETE", `/api/blocks/${step.hostBlockId}`);
        return true;
      }
      case "restore": {
        if (b === null) throw new Error("gone");
        const res = await api<BlockJson>("POST", `/api/blocks/${step.blockId}/restore`, { version: step.version, base_version: b.version });
        takeCommit(b, res.body ?? "", res.version);
        return true;
      }
    }
  } catch (e) {
    if (e instanceof ApiFailure) {
      if (step.t === "quote" || step.t === "quote removal") {
        alertMessage("Can't redo: the quoted block no longer exists.");
        return false;
      }
      alertMessage("Can't redo: that text changed on another device.");
      return false;
    }
    alertMessage("Not saved. Check your connection and try again.");
    return false;
  }
}

/** Take a commit of this tab's own save: the committed body and version. */
function takeCommit(b: BlockState, body: string, version: number): void {
  b.committed = body;
  b.version = version;
  b.inFlight = null;
  if (b.lastEditId !== undefined) b.lastConfirmedEditId = b.lastEditId;
  b.conflictExpected = false;
  b.latestRemoteBody = null;
  if (b.focused) {
    syncTextarea(b);
  } else {
    b.draft = body;
    refreshBlockRender(b);
  }
}

// ---------------------------------------------------------------------------
// Screen

export function openObjectScreen(objectId: string, reveal: boolean): void {
  const onEventLocal = (ev: Event): void => {
    void onEvent(ev);
  };
  const screen: ObjectScreen = {
    objectId,
    dispose: () => {
      document.removeEventListener("quire-event", onEventLocal);
      document.removeEventListener("quire-backlinks", onBacklinksEvent);
      window.removeEventListener("resize", layoutChips);
      window.removeEventListener("scroll", layoutChips);
      currentObject = null;
      undoStack.length = 0;
      redoStack.length = 0;
    },
  };
  screens.current = screen;
  document.addEventListener("quire-event", onEventLocal);
  document.addEventListener("quire-backlinks", onBacklinksEvent);
  window.addEventListener("resize", layoutChips);
  window.addEventListener("scroll", layoutChips, { passive: true });
  void loadObject(objectId, reveal);
}

function renderObject(object: ObjectJson, reveal: boolean, focusedBlock: BlockState | null): void {
  const main = mainEl();
  clearChildren(main);
  clearAlert();
  const headingText = object.daily_date !== null ? dateHeading(object.daily_date) : object.title;
  updateTopbarTitle(headingText);
  const heading = h("h1", { id: "object-title", tabindex: "-1", text: headingText });
  const blocksHost = h("div", { class: "blocks", id: "blocks" });
  const addBlock = h("button", { class: "add-block", onclick: () => void addBlockBelow(blocksHost) }, "Add block");
  const attachBtn = h("button", { class: "ghost", onclick: attachFile }, "Attach file");
  const sharing = h("select", { "aria-label": "Sharing", onchange: changeSharing },
    h("option", { value: "follow" }, "Follow collections"),
    h("option", { value: "never" }, "Never share")
  );
  sharing.value = object.share_visibility;
  const addCollection = h("button", { class: "ghost", onclick: openAddToCollection }, "Add to collection");
  const deleteBtn = h("button", { class: "ghost danger", onclick: openDeleteNote }, "Delete note");
  const renameBtn = object.daily_date === null ? h("button", { class: "ghost", onclick: startRename }, "Rename") : null;
  const textCol = h("div", { class: "text-column" },
    heading,
    renameBtn,
    blocksHost,
    addBlock,
    attachBtn,
    sharing,
    addCollection,
    deleteBtn
  );
  main.append(textCol);

  for (const block of object.blocks ?? []) {
    const bs: BlockState = {
      id: block.id,
      kind: block.kind,
      position: block.position,
      committed: block.body ?? "",
      draft: block.body ?? "",
      version: block.version,
      origin: block.origin,
      attachment: block.attachment,
      saveTimer: null,
      inFlight: null,
      conflictExpected: false,
      latestRemoteBody: null,
      lastPresence: 0,
      focused: false,
      lastConfirmedEditId: null,
    };
    currentObject?.blocks.set(block.id, bs);
    blocksHost.append(blockElement(bs, blocksHost));
  }
  if ((object.blocks ?? []).length === 0 && object.daily_date !== null) {
    blocksHost.append(h("p", { class: "empty-prompt", text: "Nothing written today. Start with a line from what you're reading." }));
  }
  void renderMargin(object);
  updateProgress();
  if (reveal) {
    playDailyReveal(main, heading);
  }
  window.__quireDailyReveal = false;
  if (focusedBlock !== null) {
    // keep the focused block editable after a refetch
    const el = document.querySelector(`[data-block-id="${focusedBlock.id}"] .block-render`);
    if (el !== null) (el as HTMLElement).focus();
  }
}

export function playDailyReveal(main: HTMLElement, heading: HTMLElement): void {
  if (reducedMotion()) {
    main.animate([{ opacity: "0" }, { opacity: "1" }], { duration: MOTION.revealFade, easing: "linear" });
  } else {
    main.animate(
      [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }],
      { duration: MOTION.dailyRevealMs, easing: QUIRE_CURVE }
    );
  }
  heading.focus();
}

function blockElement(bs: BlockState, host: HTMLElement): HTMLElement {
  const n = bs.position;
  const historyBtn = h("button", { class: "ghost history-btn", "aria-label": `History of block ${n}`, onclick: () => openHistoryDialog(bs.id) }, "History");
  if (bs.kind === "attachment") {
    const att = bs.attachment;
    const isImage = (att?.content_type ?? "").startsWith("image/");
    return h("figure", { class: "block attachment-block", "aria-label": att?.filename ?? "attachment", "data-block-id": bs.id, "data-pos": String(n) },
      isImage
        ? h("img", { src: `/api/attachments/${att?.id}`, alt: att?.filename })
        : h("a", { href: `/api/attachments/${att?.id}` }, att?.filename ?? "attachment")
    );
  }
  if (bs.kind === "quote") {
    const origin = bs.origin;
    const chip = h("button", {
      class: "origin-chip-link",
      "aria-label": `Quoted from ${origin?.object_title}, ${origin?.backlinks} ${origin !== null && origin.backlinks === 1 ? "backlink" : "backlinks"}`,
      onclick: () => {
        if (origin !== null) void navigate(`/o/${origin.object_id}`);
      },
    }, origin?.object_title ?? "");
    const numeral = h("span", { class: "chip-numeral", "data-backlink-count": origin?.backlinks ?? 0 }, String(origin?.backlinks ?? 0));
    chip.append(numeral);
    const remove = h("button", { class: "ghost remove-quote", onclick: () => void removeQuote(bs) }, "Remove quote");
    return h("figure", { class: "block quote-block", "aria-label": `Quote from ${origin?.object_title}`, "data-block-id": bs.id, "data-pos": String(n) },
      chip,
      blockTextBox(bs, host),
      historyBtn,
      remove
    );
  }
  return h("div", { class: "block text-block", "data-block-id": bs.id, "data-pos": String(n) }, blockTextBox(bs, host), historyBtn);
}

function blockTextBox(bs: BlockState, host: HTMLElement): HTMLElement {
  const rendered = h("div", { class: "block-render", tabindex: "0", role: "textbox", "aria-label": `Block ${bs.position}`, "aria-multiline": "true", html: sanitizeBody(bs.draft) });
  rendered.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) void performRedo();
      else void performUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      void performRedo();
    }
  });
  rendered.addEventListener("focus", () => {
    // swap the rendered body for a textarea holding the edit text
    const text = editText(bs.draft);
    const box = h("textarea", {
      class: "block-input",
      "aria-label": `Block ${bs.position}`,
      rows: "1",
    });
    box.value = text;
    bs.focused = true;
    rendered.replaceWith(box);
    box.focus();
    autoGrow(box);
    const caretAt = Math.min(rendered instanceof HTMLElement ? text.length : 0, text.length);
    box.selectionStart = caretAt;
    box.selectionEnd = caretAt;
    attachBoxHandlers(bs, box, host);
  });
  return rendered;
}

function attachBoxHandlers(bs: BlockState, box: HTMLTextAreaElement, host: HTMLElement): void {
  const saveAndRestore = (): void => {
    const text = box.value;
    const newBody = editTextToBody(text);
    if (newBody !== bs.draft) {
      recordTyping(bs, bs.draft, text);
      bs.draft = newBody;
    }
    void saveBlock(bs).then(() => {
      if (!box.isConnected) return;
      if (bs.draft === bs.committed) {
        bs.focused = false;
        const fresh = blockTextBox(bs, host);
        box.replaceWith(fresh);
        refreshPositionLabels();
      }
    });
  };
  box.addEventListener("blur", () => {
    void api("DELETE", `/api/blocks/${originIdOf(bs)}/presence`).catch(() => undefined);
    saveAndRestore();
  });
  box.addEventListener("input", () => {
    autoGrow(box);
    const before = bs.draft;
    const after = editTextToBody(box.value);
    if (after !== before) {
      recordTyping(bs, before, box.value);
      bs.draft = after;
    }
    if (bs.saveTimer !== null) window.clearTimeout(bs.saveTimer);
    bs.saveTimer = window.setTimeout(() => {
      void saveBlock(bs);
    }, SAVE_DEBOUNCE);
  });
  box.addEventListener("paste", () => {
    // a paste saves the whole block as a full replacement after filtering
    setTimeout(() => {
      const after = box.value;
      const body = editTextToBody(after);
      bs.draft = body;
      void saveFullReplacement(bs, body);
    }, 0);
  });
  box.addEventListener("keydown", (e) => blockKeydown(e, bs, box, host));
  const report = (): void => {
    const now = Date.now();
    if (now - bs.lastPresence < PRESENCE.reportInterval) return;
    bs.lastPresence = now;
    // offsets are named in the edit text of the committed version
    const committedText = editText(bs.committed);
    const start = Math.min(box.selectionStart ?? 0, committedText.length);
    const end = Math.min(box.selectionEnd ?? start, committedText.length);
    void api("POST", `/api/blocks/${originIdOf(bs)}/presence`, { anchor: start, head: end, version: bs.version }).catch(() => undefined);
  };
  box.addEventListener("keyup", report);
  box.addEventListener("click", report);
  box.addEventListener("select", report);
}

function originIdOf(bs: BlockState): string {
  return bs.kind === "quote" ? bs.origin?.block_id ?? bs.id : bs.id;
}

function autoGrow(box: HTMLTextAreaElement): void {
  box.style.height = "auto";
  box.style.height = `${box.scrollHeight}px`;
}

/** Record a typing step for undo, coalescing consecutive edits in a block. */
function recordTyping(bs: BlockState, beforeBody: string, afterText: string): void {
  const ops = diffOps(editText(beforeBody), afterText);
  if (ops.length === 0) return;
  const produced = afterText;
  const last = undoStack[undoStack.length - 1];
  const now = Date.now();
  if (last !== undefined && last.t === "typing" && last.blockId === bs.id && now - (last.at ?? 0) < 1000) {
    last.ops = last.ops.concat(ops);
    last.produced = produced;
    last.at = now;
  } else {
    undoStack.push({ t: "typing", blockId: bs.id, ops, produced, version: null, at: now });
    redoStack.length = 0;
    if (undoStack.length > UNDO_STACK) undoStack.shift();
  }
}

async function saveFullReplacement(bs: BlockState, body: string): Promise<void> {
  const statusEl = document.getElementById("save-status");
  if (statusEl !== null) statusEl.textContent = "Saving";
  try {
    const res = await api<BlockJson>("PATCH", `/api/blocks/${bs.id}`, { body, base_version: bs.version });
    takeCommit(bs, res.body ?? body, res.version);
    if (statusEl !== null) statusEl.textContent = "Saved";
  } catch (e) {
    if (e instanceof ApiFailure && e.body.error === "version_conflict") {
      openConflict(bs, e.body.current as BlockJson | null);
    } else {
      if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
    }
  }
}

async function saveBlock(bs: BlockState): Promise<void> {
  if (bs.inFlight !== null) return; // one save in flight per block
  const unsaved = diffOps(editText(bs.committed), editText(bs.draft));
  if (unsaved.length === 0) return;
  const editId = `edit-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const base = bs.version;
  bs.lastEditId = editId;
  bs.inFlight = { ops: unsaved, baseVersion: base, editId };
  const statusEl = document.getElementById("save-status");
  if (statusEl !== null) statusEl.textContent = "Saving";
  try {
    const res = await api<BlockJson>("PATCH", `/api/blocks/${bs.id}`, { ops: unsaved, base_version: base, edit_id: editId });
    // a block.saved with this edit id may have arrived first; ignore the later
    if (bs.inFlight?.editId === editId) {
      takeCommit(bs, res.body ?? bs.draft, res.version);
      // mark the newest typing step with the version it produced
      const last = undoStack[undoStack.length - 1];
      if (last !== undefined && last.t === "typing" && last.blockId === bs.id && last.version === null) last.version = res.version;
      if (statusEl !== null && bs.inFlight === null) statusEl.textContent = "Saved";
    }
  } catch (e) {
    bs.inFlight = null;
    if (e instanceof ApiFailure) {
      if (e.body.error === "version_conflict") {
        openConflict(bs, e.body.current as BlockJson | null);
      } else {
        if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
      }
    } else if (e instanceof NetworkFailure) {
      if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
      // retry the same ops on the next save attempt
    }
  }
}

function refreshBlockRender(bs: BlockState): void {
  const el = document.querySelector(`[data-block-id="${bs.id}"]`);
  if (el === null) return;
  const render = el.querySelector(".block-render");
  if (render !== null) render.innerHTML = sanitizeBody(bs.draft);
  const box = el.querySelector(".block-input");
  if (box instanceof HTMLTextAreaElement && !bs.focused) box.value = editText(bs.draft);
}

function syncTextarea(bs: BlockState): void {
  const el = document.querySelector(`[data-block-id="${bs.id}"]`);
  if (el === null) return;
  const box = el.querySelector(".block-input");
  if (!(box instanceof HTMLTextAreaElement)) return;
  const before = box.value;
  const after = editText(bs.draft);
  if (before === after) return;
  const ops = diffOps(before, after);
  const selStart = box.selectionStart ?? 0;
  const selEnd = box.selectionEnd ?? 0;
  box.value = after;
  autoGrow(box);
  let pos = 0;
  let newStart = selStart;
  let newEnd = selEnd;
  for (const op of ops) {
    if ("retain" in op) pos += op.retain;
    else if ("insert" in op) {
      if (pos <= selStart) newStart += op.insert.length;
      if (pos <= selEnd) newEnd += op.insert.length;
    } else {
      const end = pos + op.delete;
      if (end <= selStart) newStart -= op.delete;
      else if (pos < selStart) newStart = pos;
      if (end <= selEnd) newEnd -= op.delete;
      else if (pos < selEnd) newEnd = pos;
      pos += op.delete;
    }
  }
  box.selectionStart = Math.max(0, Math.min(newStart, after.length));
  box.selectionEnd = Math.max(0, Math.min(newEnd, after.length));
}

// ---------------------------------------------------------------------------
// Block keyboard behaviour

function blockKeydown(e: KeyboardEvent, bs: BlockState, box: HTMLTextAreaElement, host: HTMLElement): void {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    void performUndo();
    return;
  }
  if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "z") || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y")) {
    e.preventDefault();
    void performRedo();
    return;
  }
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void createBlockAfter(bs, host);
    return;
  }
  if (e.key === "Backspace" && box.value.length === 0) {
    e.preventDefault();
    void deleteBlockAndFocusPrevious(bs);
    return;
  }
  if (e.key === "(") {
    // the caret is just after one opening paren: this keypress is the second
    const before = box.value.slice(0, box.selectionStart ?? 0);
    if (before.endsWith("(")) {
      e.preventDefault();
      openQuotePicker(bs, box, before.slice(0, -1));
      return;
    }
  }
}

async function createBlockAfter(bs: BlockState, host: HTMLElement): Promise<void> {
  if (currentObject === null) return;
  const isDaily = currentObject.object.daily_date !== null;
  const idem = `cap-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  try {
    let block: BlockJson;
    let landedDate: string | null = null;
    if (isDaily) {
      const res = await api<{ block: BlockJson; date: string }>("POST", "/api/daily/today/blocks", { body: "", after_block_id: bs.id }, { "Idempotency-Key": idem });
      block = res.block;
      landedDate = res.date;
      if (landedDate !== currentObject.object.daily_date) {
        announce(`Saved to ${dateHeading(landedDate)}, the new day on your home clock.`);
        window.__quireDailyReveal = true;
        const daily = await api<ObjectJson>("GET", `/api/daily?date=${landedDate}`);
        await navigate(`/o/${daily.id}`);
        return;
      }
    } else {
      block = await api<BlockJson>("POST", `/api/objects/${currentObject.id}/blocks`, { body: "", after_block_id: bs.id });
    }
    pushUndo({ t: "new block", blockId: block.id });
    await reloadBlocks();
    focusBlock(block.id);
  } catch (e) {
    alertMessage(apiFail(e, "body"));
  }
}

async function addBlockBelow(host: HTMLElement): Promise<void> {
  if (currentObject === null) return;
  const els = Array.from(host.querySelectorAll("[data-block-id]"));
  const last = els[els.length - 1] as HTMLElement | undefined;
  const afterId = last !== undefined ? last.dataset.blockId ?? null : null;
  const isDaily = currentObject.object.daily_date !== null;
  const idem = `cap-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  try {
    let block: BlockJson;
    let landedDate: string | null = null;
    if (isDaily) {
      const res = await api<{ block: BlockJson; date: string }>("POST", "/api/daily/today/blocks", { body: "", after_block_id: afterId }, { "Idempotency-Key": idem });
      block = res.block;
      landedDate = res.date;
      if (landedDate !== currentObject.object.daily_date) {
        announce(`Saved to ${dateHeading(landedDate)}, the new day on your home clock.`);
        window.__quireDailyReveal = true;
        const daily = await api<ObjectJson>("GET", `/api/daily?date=${landedDate}`);
        await navigate(`/o/${daily.id}`);
        return;
      }
    } else {
      block = await api<BlockJson>("POST", `/api/objects/${currentObject.id}/blocks`, { body: "", after_block_id: afterId });
    }
    pushUndo({ t: "new block", blockId: block.id });
    await reloadBlocks();
    focusBlock(block.id);
  } catch (e) {
    alertMessage(apiFail(e, "body"));
  }
}

export async function reloadCurrentObject(): Promise<void> {
  return reloadBlocks();
}

async function reloadBlocks(): Promise<void> {
  if (currentObject === null) return;
  const object = await api<ObjectJson>("GET", `/api/objects/${currentObject.id}`);
  const host = document.getElementById("blocks");
  if (host === null || currentObject === null) return;
  const focusedId = Array.from(currentObject.blocks.values()).find((b) => b.focused)?.id ?? null;
  currentObject.blocks.clear();
  currentObject.object = object;
  clearChildren(host);
  for (const block of object.blocks ?? []) {
    const bs: BlockState = {
      id: block.id,
      kind: block.kind,
      position: block.position,
      committed: block.body ?? "",
      draft: block.body ?? "",
      version: block.version,
      origin: block.origin,
      attachment: block.attachment,
      saveTimer: null,
      inFlight: null,
      conflictExpected: false,
      latestRemoteBody: null,
      lastPresence: 0,
      focused: false,
      lastConfirmedEditId: null,
    };
    currentObject.blocks.set(block.id, bs);
    host.append(blockElement(bs, host));
  }
  if ((object.blocks ?? []).length === 0 && object.daily_date !== null) {
    host.append(h("p", { class: "empty-prompt", text: "Nothing written today. Start with a line from what you're reading." }));
  }
  if (focusedId !== null) focusBlock(focusedId);
  refreshPositionLabels();
}

function focusBlock(blockId: string): void {
  const el = document.querySelector(`[data-block-id="${blockId}"] .block-render`) as HTMLElement | null;
  if (el !== null) el.focus();
}

async function deleteBlockAndFocusPrevious(bs: BlockState): Promise<void> {
  try {
    await api("DELETE", `/api/blocks/${bs.id}`);
    pushUndo({ t: "block deletion", blockId: bs.id, body: bs.committed, objectId: currentObject?.id ?? "" });
    const el = document.querySelector(`[data-block-id="${bs.id}"]`);
    const prev = el !== null ? el.previousElementSibling : null;
    if (el !== null && !reducedMotion()) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.blockGap, easing: QUIRE_CURVE }).onfinish = () => {
        el.remove();
      };
    } else {
      el?.remove();
    }
    currentObject?.blocks.delete(bs.id);
    refreshPositionLabels();
    if (prev !== null) {
      const render = prev.querySelector(".block-render") as HTMLElement | null;
      if (render !== null) render.focus();
    }
  } catch (e) {
    if (e instanceof ApiFailure && e.body.error === "block_quoted") {
      alertMessage(`This block is quoted in ${e.body.quoted_in ?? 0} places. Remove those quotes first.`);
    } else {
      alertMessage(apiFail(e, "body"));
    }
  }
}

function refreshPositionLabels(): void {
  const host = document.getElementById("blocks");
  if (host === null) return;
  Array.from(host.querySelectorAll("[data-block-id]")).forEach((el, i) => {
    (el as HTMLElement).dataset.pos = String(i + 1);
    const hist = el.querySelector(".history-btn");
    if (hist !== null) hist.setAttribute("aria-label", `History of block ${i + 1}`);
    const box = el.querySelector(".block-input");
    if (box !== null) box.setAttribute("aria-label", `Block ${i + 1}`);
    const render = el.querySelector(".block-render");
    if (render !== null) render.setAttribute("aria-label", `Block ${i + 1}`);
  });
}

async function removeQuote(bs: BlockState): Promise<void> {
  try {
    const res = await api<{ origin_object_id: string; origin_backlinks: number }>("DELETE", `/api/blocks/${bs.id}`);
    pushUndo({ t: "quote removal", hostBlockId: bs.id, originBlockId: bs.origin?.block_id ?? "" });
    const el = document.querySelector(`[data-block-id="${bs.id}"]`);
    if (el !== null && !reducedMotion()) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.blockGap, easing: QUIRE_CURVE }).onfinish = () => {
        el.remove();
        refreshPositionLabels();
      };
    } else {
      el?.remove();
      refreshPositionLabels();
    }
    currentObject?.blocks.delete(bs.id);
    const n = res.origin_backlinks;
    announce(`Quote removed. ${bs.origin?.object_title ?? ""} has ${n} ${n === 1 ? "backlink" : "backlinks"}.`);
    const host = document.getElementById("blocks");
    if (host !== null) {
      const first = host.querySelector(".block-render") as HTMLElement | null;
      const addBtn = document.querySelector(".add-block") as HTMLElement | null;
      if (first !== null) first.focus();
      else if (addBtn !== null) addBtn.focus();
    }
  } catch (e) {
    alertMessage(apiFail(e, "body"));
  }
}

async function changeSharing(e: Event): Promise<void> {
  const value = (e.target as HTMLSelectElement).value;
  try {
    await api("PATCH", `/api/objects/${currentObject?.id}`, { share_visibility: value });
  } catch (err) {
    alertMessage(apiFail(err, "share_visibility"));
  }
}

async function openAddToCollection(): Promise<void> {
  if (currentObject === null) return;
  const collections = state.app?.collections ?? [];
  const checkboxes = collections.map((c) => {
    const id = `coll-${c.id}`;
    const cb = h("input", { type: "checkbox", id, checked: currentObject?.object.collection_ids.includes(c.id) });
    cb.addEventListener("change", () => {
      if (cb.checked) {
        void api("POST", `/api/collections/${c.id}/objects`, { object_id: currentObject?.id }).catch(() => undefined);
      } else {
        void api("DELETE", `/api/collections/${c.id}/objects/${currentObject?.id}`).catch(() => undefined);
      }
    });
    return h("div", {}, h("label", { for: id }, cb, c.name));
  });
  const done = h("button", {}, "Done");
  const dialog = h("div", { role: "dialog", "aria-label": "Add to collection", class: "dialog" },
    h("h2", { text: "Add to collection" }),
    ...checkboxes,
    done
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  done.addEventListener("click", () => dialog.dispatchEvent(new CustomEvent("dialog-close")));
  done.focus();
}

function openDeleteNote(): void {
  if (currentObject === null) return;
  const quotedCount = Array.from(currentObject.blocks.values()).filter((b) => b.kind === "quote").length;
  const confirmBtn = h("button", { class: "danger" }, "Delete");
  const cancel = h("button", {}, "Cancel");
  const dialog = h("div", { role: "alertdialog", "aria-label": "Delete this note?", class: "dialog" },
    h("h2", { text: "Delete this note?" }),
    h("p", {}, `Deleting removes ${quotedCount} ${quotedCount === 1 ? "quote" : "quotes"} of its blocks from other notes.`),
    confirmBtn,
    cancel
  );
  const overlay = h("div", { class: "dialog-overlay" }, dialog);
  document.body.append(overlay);
  const handle = openDialog(overlay, document.activeElement as HTMLElement | null);
  dialog.addEventListener("dialog-close", () => {
    overlay.remove();
    handle.close();
  });
  cancel.addEventListener("click", () => dialog.dispatchEvent(new CustomEvent("dialog-close")));
  confirmBtn.addEventListener("click", async () => {
    try {
      const id = currentObject?.id;
      await api("DELETE", `/api/objects/${id}`);
      dialog.dispatchEvent(new CustomEvent("dialog-close"));
      void navigate("/today");
    } catch (e) {
      alertMessage(apiFail(e, "id"));
    }
  });
  confirmBtn.focus();
}

function startRename(): void {
  const heading = document.getElementById("object-title");
  if (heading === null || currentObject === null) return;
  const box = h("input", { type: "text", "aria-label": "Title", value: currentObject.object.title });
  heading.replaceWith(box);
  box.focus();
  box.select();
  const commit = async (): Promise<void> => {
    if (!box.isConnected) return;
    try {
      await api("PATCH", `/api/objects/${currentObject?.id}`, { title: box.value });
      box.replaceWith(h("h1", { id: "object-title", text: box.value }));
      updateTopbarTitle(box.value);
    } catch (e) {
      alertMessage(apiFail(e, "title"));
      box.replaceWith(h("h1", { id: "object-title", text: currentObject?.object.title ?? "" }));
    }
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      box.replaceWith(h("h1", { id: "object-title", text: currentObject?.object.title ?? "" }));
    }
  });
  box.addEventListener("blur", () => void commit());
}

async function attachFile(): Promise<void> {
  if (currentObject === null) return;
  const input = h("input", { type: "file" });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (file === undefined || currentObject === null) return;
    const statusEl = document.getElementById("save-status");
    if (statusEl !== null) statusEl.textContent = `Uploading ${file.name}`;
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/objects/${currentObject.id}/attachments`, {
        method: "POST",
        body: form,
        headers: { "X-CSRF-Token": getCsrfToken() },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({ error: "unknown" }))) as { error?: string };
        if (res.status === 413) {
          alertMessage("That file is too large to attach.");
          if (statusEl !== null) statusEl.textContent = "";
        } else if (res.status === 415) {
          alertMessage("Attach an image (PNG, JPEG, GIF, WebP) or a PDF.");
          if (statusEl !== null) statusEl.textContent = "";
        } else if (res.status === 503) {
          alertMessage("Storage is unavailable, so this file was not attached.");
          if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
        } else {
          alertMessage("Not saved. Check your connection and try again.");
          if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
        }
        return;
      }
      const block = (await res.json()) as BlockJson;
      if (statusEl !== null) statusEl.textContent = `${block.attachment?.filename ?? "attachment"} saved.`;
      announce(`${block.attachment?.filename} attached to ${currentObject.object.title}.`);
      await reloadBlocks();
    } catch {
      if (statusEl !== null) statusEl.textContent = "Not saved. Check your connection and try again.";
    }
  });
  input.click();
}

// ---------------------------------------------------------------------------
// The margin

async function renderMargin(object: ObjectJson): Promise<void> {
  const margin = document.getElementById("margin");
  if (margin === null) return;
  clearChildren(margin);
  const type = state.app?.types.find((t) => t.id === object.type_id);
  if (type !== undefined && type.fields.length > 0) {
    margin.append(buildProperties(object, type));
  }
  let backlinks: { count: number; backlinks: BacklinkJson[] } = { count: 0, backlinks: [] };
  try {
    backlinks = await api<{ count: number; backlinks: BacklinkJson[] }>("GET", `/api/objects/${object.id}/backlinks`);
  } catch {
    // the object page still renders
  }
  const numeral = h("span", { "data-backlink-count": backlinks.count }, String(backlinks.count));
  const list = h("ul", { id: "backlinks-list", "aria-label": "Backlinks list" });
  for (const b of backlinks.backlinks) {
    const kind = b.kind === "quote" ? "quoted" : (b.field_name ?? "");
    list.append(h("li", {}, h("a", { href: `/o/${b.from_object_id}`, onclick: (e: MouseEvent) => { e.preventDefault(); void navigate(`/o/${b.from_object_id}`); } }, b.from_title), ` ${kind}`));
  }
  margin.append(
    h("section", { "aria-label": "Backlinks", id: "backlinks-region" },
      h("h2", {}, "Backlinks ", numeral),
      list
    )
  );
  const chipsHost = h("div", { class: "chips", id: "chips", "aria-hidden": "true" });
  margin.append(chipsHost);
  layoutChips();
}

function onBacklinksEvent(ev: Event): void {
  const detail = (ev as CustomEvent).detail as { object_id: string; backlinks: number };
  if (currentObject === null) return;
  if (currentObject.id === detail.object_id) {
    const numeral = document.querySelector("#backlinks-region [data-backlink-count]");
    if (numeral !== null) {
      numeral.setAttribute("data-backlink-count", String(detail.backlinks));
      numeral.textContent = String(detail.backlinks);
    }
  }
}

/** Place each origin chip level with its quoted block, with its tether. */
export function layoutChips(): void {
  const chips = document.getElementById("chips");
  const column = document.querySelector(".text-column");
  if (chips === null || column === null || currentObject === null) return;
  clearChildren(chips);
  if (window.innerWidth < 768) return; // the phone shows chips inside the block
  let svg = document.getElementById("tethers") as SVGSVGElement | null;
  if (svg === null) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "tethers";
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("tethers");
    (column as HTMLElement).style.position = "relative";
    (column as HTMLElement).append(svg);
  }
  svg.replaceChildren();
  for (const bs of currentObject.blocks.values()) {
    if (bs.kind !== "quote" || bs.origin === null) continue;
    const el = document.querySelector(`[data-block-id="${bs.id}"]`);
    if (el === null) continue;
    const chip = h("div", { class: "origin-chip" },
      h("span", { class: "chip-title" }, bs.origin.object_title),
      h("span", { class: "chip-numeral", "data-backlink-count": bs.origin.backlinks }, String(bs.origin.backlinks))
    );
    chips.append(chip);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("data-tether", bs.id);
    line.setAttribute("stroke", "var(--quire-link)");
    line.setAttribute("stroke-width", "1");
    svg?.append(line);
    const place = (): void => {
      if (!chip.isConnected || el === null || !el.isConnected) return;
      const chipTop = chips.getBoundingClientRect().top;
      const blockTop = el.getBoundingClientRect().top;
      chip.style.top = `${blockTop - chipTop}px`;
      const chipRect = chip.getBoundingClientRect();
      const blockRect = el.getBoundingClientRect();
      const colRect = (column as HTMLElement).getBoundingClientRect();
      const x1 = blockRect.left - colRect.left;
      const y1 = blockTop - colRect.top;
      const x2 = chipRect.left - colRect.left;
      const y2 = chipTop - colRect.top + (chipRect.height - chipTop + chipTop) * 0 + 8;
      line.setAttribute("x1", String(x1));
      line.setAttribute("y1", String(y1));
      line.setAttribute("x2", String(x2));
      line.setAttribute("y2", String(y2));
      const width = Math.max(colRect.width, chipRect.width + 320);
      svg?.setAttribute("width", String(width));
      svg?.setAttribute("height", String((column as HTMLElement).scrollHeight));
      svg?.setAttribute("viewBox", `0 0 ${width} ${(column as HTMLElement).scrollHeight}`);
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
  }
}

// ---------------------------------------------------------------------------
// Live events

async function onEvent(ev: Event): Promise<void> {
  try {
    await onEventInner(ev);
  } catch (e) {
    console.error("quire event handler failed:", (e as Error).message, (e as Error).stack);
  }
}

async function onEventInner(ev: Event): Promise<void> {
  const detail = (ev as CustomEvent).detail as { event: string; data: Record<string, unknown> };
  if (currentObject === null) return;
  const data = detail.data;
  switch (detail.event) {
    case "block.saved": {
      const block = data.block as BlockJson;
      const objectId = String(data.object_id ?? "");
      if (objectId !== currentObject.id) return;
      const bs = currentObject.blocks.get(block.id);
      if (bs === undefined) {
        if (block.kind !== "attachment" && !bsKnown(block.id)) {
          // a new block from another device
          markRemoteArrival(block.id);
          await reloadBlocks();
        }
        return;
      }
      const incomingOps = data.ops as Op[] | null;
      const editId = data.edit_id === null || data.edit_id === undefined ? null : String(data.edit_id);
      // my own save's commit: whichever of the 200 or the event arrives first
      if (editId !== null && bs.inFlight !== null && bs.inFlight.editId === editId) {
        takeCommit(bs, block.body ?? bs.draft, block.version);
        const statusEl = document.getElementById("save-status");
        if (statusEl !== null) statusEl.textContent = "Saved";
        const last = undoStack[undoStack.length - 1];
        if (last !== undefined && last.t === "typing" && last.blockId === bs.id && last.version === null) last.version = block.version;
        return;
      }
      if (editId !== null && editId === bs.lastConfirmedEditId) {
        // the 200 answer already confirmed this commit
        return;
      }
      const unsaved = diffOps(editText(bs.committed), editText(bs.draft));
      if (unsaved.length === 0) {
        bs.committed = block.body ?? bs.committed;
        bs.draft = bs.committed;
        bs.version = block.version;
        if (bs.origin !== null && block.origin !== null) bs.origin.backlinks = block.origin.backlinks;
        if (bs.focused) syncTextarea(bs);
        else refreshBlockRender(bs);
        markRemoteArrival(bs.id);
        return;
      }
      if (incomingOps === null) {
        // a full replacement or restore: the draft stays, the 409 follows
        bs.conflictExpected = true;
        bs.latestRemoteBody = block.body ?? "";
        return;
      }
      const t = transformOps(unsaved, incomingOps);
      if (t.conflict) {
        bs.conflictExpected = true;
        bs.latestRemoteBody = applyOps(bs.committed, incomingOps);
        return;
      }
      const newCommitted = applyOps(bs.committed, incomingOps);
      bs.committed = newCommitted;
      bs.draft = applyOps(newCommitted, t.ops);
      bs.version = block.version;
      if (bs.focused) syncTextarea(bs);
      else refreshBlockRender(bs);
      break;
    }
    case "block.removed": {
      const blockId = String(data.block_id ?? "");
      const objectId = String(data.object_id ?? "");
      if (objectId !== currentObject.id) return;
      const el = document.querySelector(`[data-block-id="${blockId}"]`);
      if (el !== null) {
        const close = (): void => {
          el.remove();
          refreshPositionLabels();
        };
        if (!reducedMotion()) {
          el.animate([{ height: `${el.clientHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: MOTION.blockGap, easing: QUIRE_CURVE }).onfinish = close;
        } else {
          close();
        }
      }
      currentObject.blocks.delete(blockId);
      break;
    }
    case "backlinks.changed": {
      const objectId = String(data.object_id ?? "");
      const count = Number(data.backlinks ?? 0);
      for (const bs of currentObject.blocks.values()) {
        if (bs.origin !== null && bs.origin.object_id === objectId) {
          bs.origin.backlinks = count;
          const chipNum = document.querySelector(`[data-block-id="${bs.id}"] [data-backlink-count]`);
          if (chipNum !== null) {
            chipNum.textContent = String(count);
            chipNum.setAttribute("data-backlink-count", String(count));
          }
          const chip = document.querySelector(`[data-block-id="${bs.id}"] .origin-chip-link`);
          if (chip !== null) {
            chip.setAttribute("aria-label", `Quoted from ${bs.origin.object_title}, ${count} ${count === 1 ? "backlink" : "backlinks"}`);
          }
        }
      }
      document.dispatchEvent(new CustomEvent("quire-backlinks", { detail: { object_id: objectId, backlinks: count } }));
      break;
    }
    case "object.saved": {
      const objectId = String(data.object_id ?? "");
      if (objectId === currentObject.id) {
        const focused = Array.from(currentObject.blocks.values()).find((b) => b.focused) ?? null;
        await loadObject(currentObject.id, false, focused);
      }
      break;
    }
    case "presence.changed": {
      drawRemoteCaret(data);
      break;
    }
  }
}

function bsKnown(id: string): boolean {
  return currentObject !== null && currentObject.blocks.has(id);
}

/** A vermilion arrival mark beside a block from another device. */
function markRemoteArrival(blockId: string): void {
  const el = document.querySelector(`[data-block-id="${blockId}"]`);
  if (el === null) return;
  const mark = h("span", { class: "arrival-mark", "aria-hidden": "true" });
  el.classList.add("remote-arrived");
  el.append(mark);
  if (reducedMotion()) {
    setTimeout(() => mark.remove(), 2000);
  } else {
    mark.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 2000, easing: "linear" }).onfinish = () => mark.remove();
  }
}

async function loadObject(objectId: string, reveal: boolean, focusedBlock: BlockState | null = null): Promise<void> {
  if (screens.current === null || (screens.current as ObjectScreen).objectId !== objectId) return;
  let object: ObjectJson;
  try {
    object = await api<ObjectJson>("GET", `/api/objects/${objectId}`);
  } catch {
    const main = mainEl();
    clearChildren(main);
    main.append(h("h1", { text: "We can't find that note." }));
    return;
  }
  if (screens.current === null || (screens.current as ObjectScreen).objectId !== objectId) return;
  currentObject = { id: objectId, blocks: new Map(), object };
  renderObject(object, reveal, focusedBlock);
}

function drawRemoteCaret(data: Record<string, unknown>): void {
  const blockId = String(data.block_id ?? "");
  const sessionId = String(data.session_id ?? "");
  const anchor = data.anchor === null || data.anchor === undefined ? null : Number(data.anchor);
  const head = data.head === null || data.head === undefined ? null : Number(data.head);
  const label = String(data.label ?? "");
  if (sessionId === state.app?.sessionId) return;
  const el = document.querySelector(`[data-block-id="${blockId}"]`);
  if (el === null) return;
  const existing = el.querySelector(`[data-remote-caret="${sessionId}"]`);
  if (existing !== null) existing.remove();
  if (anchor === null || head === null) return;
  const host = el.querySelector(".block-input") ?? el.querySelector(".block-render");
  if (host === null) return;
  const text = host instanceof HTMLTextAreaElement ? host.value : (host as HTMLElement).textContent ?? "";
  const offset = Math.min(head, text.length);
  const caret = h("div", { class: "remote-caret", "data-remote-caret": sessionId, "aria-hidden": "true" },
    h("span", { class: "remote-caret-chip" }, label)
  );
  if ((el as HTMLElement).style.position === "") (el as HTMLElement).style.position = "relative";
  el.append(caret);
  const measure = document.createElement("div");
  measure.style.position = "absolute";
  measure.style.visibility = "hidden";
  measure.style.whiteSpace = "pre-wrap";
  const styles = window.getComputedStyle(host);
  measure.style.font = styles.font;
  measure.style.width = styles.width;
  measure.style.padding = styles.padding;
  measure.textContent = text.slice(0, offset);
  document.body.append(measure);
  const w = measure.offsetWidth;
  const lineH = styles.lineHeight !== "" && styles.lineHeight !== "normal" ? Number.parseFloat(styles.lineHeight) : 20;
  measure.remove();
  caret.style.left = `${host.getBoundingClientRect().left - el.getBoundingClientRect().left + Math.min(w, host.clientWidth)}px`;
  caret.style.top = `${host.getBoundingClientRect().top - el.getBoundingClientRect().top + lineH - 2}px`;
}

// ---------------------------------------------------------------------------
// Edit conflict

export function openConflict(bs: BlockState, current: BlockJson | null): void {
  if (bs.conflictExpected !== true && current === null) return;
  const remoteBody = current?.body ?? bs.latestRemoteBody ?? bs.committed;
  const remoteVersion = current?.version ?? bs.version;
  const mine = h("button", {}, "Keep mine");
  const theirs = h("button", {}, "Keep theirs");
  const region = h("section", { role: "region", "aria-label": "Edit conflict", class: "edit-conflict" },
    h("p", {}, "This block changed on another device."),
    h("div", { class: "conflict-other" }, h("h3", {}, "On the other device"), h("p", { html: sanitizeBody(remoteBody) })),
    h("div", { class: "conflict-mine" }, h("h3", {}, "Your draft"), h("p", { html: sanitizeBody(bs.draft) })),
    mine,
    theirs
  );
  const blockEl = document.querySelector(`[data-block-id="${bs.id}"]`);
  if (blockEl !== null) blockEl.before(region);
  else mainEl().prepend(region);
  const close = (): void => {
    region.remove();
    const focusEl = document.querySelector(`[data-block-id="${bs.id}"] .block-render`);
    if (focusEl !== null) (focusEl as HTMLElement).focus();
  };
  mine.addEventListener("click", async () => {
    // the draft as a full replacement on top of the other device's version
    const draftText = editText(bs.draft);
    const remoteText = editText(remoteBody);
    const ops = diffOps(remoteText, draftText);
    try {
      if (ops.length === 0) {
        bs.committed = remoteBody;
        bs.draft = remoteBody;
        bs.version = remoteVersion;
      } else {
        const res = await api<BlockJson>("PATCH", `/api/blocks/${bs.id}`, { ops, base_version: remoteVersion });
        takeCommit(bs, res.body ?? bs.draft, res.version);
      }
      close();
    } catch (e) {
      alertMessage(apiFail(e, "base_version"));
    }
  });
  theirs.addEventListener("click", () => {
    bs.committed = remoteBody;
    bs.draft = remoteBody;
    bs.version = remoteVersion;
    bs.conflictExpected = false;
    bs.latestRemoteBody = null;
    bs.inFlight = null;
    refreshBlockRender(bs);
    close();
  });
  mine.focus();
}

export async function captureIntoToday(body: string, afterBlockId: string | null, idemKey: string): Promise<{ block: BlockJson; date: string } | null> {
  try {
    return await api<{ block: BlockJson; date: string }>("POST", "/api/daily/today/blocks", { body, after_block_id: afterBlockId }, { "Idempotency-Key": idemKey });
  } catch {
    return null;
  }
}

export function currentObjectId(): string | null {
  return currentObject?.id ?? null;
}

export { dateTimeShort };
