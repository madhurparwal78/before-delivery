// Board detail: the shop drawing, the cut list editor with undo, live totals, Fit check with the
// kerf draw-on, layout files, and the hold, pay and cancel controls.
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Board, Fit, Hold } from "../../shared/api";
import {
  BOARD_LABELS, DEPOSIT_CENTS, formatWhen, inchesToMm, lengthText, MAX_PIECES, money, nearestMark, nextMark, overDefect,
  validCardNumber, type Unit,
} from "../../shared/domain";
import { api, navigate, reducedMotion, refreshServices, sessionStore, setUnit, signInPath, useMedia, useServices, useSession, useUnit } from "../api";
import { Link } from "../app";
import { Dialog } from "../dialog";
import { Elevation, Ruler, type DrawnPiece, type KerfDrawing } from "../elevation";
import { HOLD_COPY, newKey, useHoldActions } from "../holdactions";
import { Icon } from "../icons";
import { NotFound } from "./notfound";

// ---- layout state and history ----

interface Chip extends DrawnPiece {
  rotated: boolean;
  extras: Record<string, unknown>;
}

interface History {
  layout: Chip[];
  past: Chip[][];
  future: Chip[][];
  version: number;
}

type HistoryAction =
  | { type: "commit"; layout: Chip[]; merge: boolean }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; layout: Chip[] };

const UNDO_DEPTH = 50;

function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "commit":
      if (action.merge) return { ...state, layout: action.layout, future: [], version: state.version + 1 };
      return { layout: action.layout, past: [...state.past, state.layout].slice(-UNDO_DEPTH), future: [], version: state.version + 1 };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return { layout: previous, past: state.past.slice(0, -1), future: [state.layout, ...state.future], version: state.version + 1 };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (next === undefined) return state;
      return { layout: next, past: [...state.past, state.layout].slice(-UNDO_DEPTH), future: rest, version: state.version + 1 };
    }
    case "reset":
      return { layout: action.layout, past: [], future: [], version: state.version + 1 };
  }
}

let chipCounter = 0;
const makeChip = (p: { label: string; length_mm: number; width_mm: number; start_mm: number }, extras: Record<string, unknown> = {}, rotated = false): Chip =>
  ({ id: ++chipCounter, label: p.label, length_mm: p.length_mm, width_mm: p.width_mm, start_mm: p.start_mm, rotated, extras });

const piecesOf = (layout: Chip[]) => layout.map((c) => ({ label: c.label, length_mm: c.length_mm, width_mm: c.width_mm, start_mm: c.start_mm }));

const STORE_PREFIX = "kerfwell.layout.";

/** Keeps the layout in this tab only, under the board's tag, for the trip through sign-in. */
function keepLayout(tag: string, layout: Chip[]): void {
  sessionStorage.setItem(STORE_PREFIX + tag, JSON.stringify(layout.map((c) => ({ ...piecesOf([c])[0], rotated: c.rotated }))));
}

function takeKeptLayout(tag: string): Chip[] | null {
  const raw = sessionStorage.getItem(STORE_PREFIX + tag);
  if (raw === null) return null;
  sessionStorage.removeItem(STORE_PREFIX + tag);
  try {
    const parsed = JSON.parse(raw) as { label: string; length_mm: number; width_mm: number; start_mm: number; rotated: boolean }[];
    return parsed.map((p) => makeChip(p, {}, p.rotated));
  } catch {
    return null;
  }
}

const isTextField = (el: EventTarget | null): boolean =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(el.type));

function chipName(c: Chip, unit: Unit, defects: Board["defects"]): string {
  return `${c.label}, ${lengthText(c.length_mm, unit)} at ${lengthText(c.start_mm, unit)}${overDefect(c, defects) ? ", over defect" : ""}`;
}

function parseLength(text: string, unit: Unit): number | null {
  const t = text.trim();
  if (unit === "mm") return /^\d+$/.test(t) ? Number(t) : null;
  return inchesToMm(t);
}

// ---- motion ----

const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const KERF_LINE_MS = 125;
const OFFCUT_MS = 250;
const FIGURES_MS = 350;

/** Kerf lines draw left to right one after another, the offcut fades in, then the figures settle. */
function playKerf(svg: SVGSVGElement, figures: HTMLElement | null): Animation[] {
  const lines = [...svg.querySelectorAll<SVGElement>("[data-kerf]")].sort((a, b) => Number(a.dataset["kerf"]) - Number(b.dataset["kerf"]));
  const played: Animation[] = [];
  lines.forEach((line, i) => {
    played.push(line.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], { duration: KERF_LINE_MS, delay: i * KERF_LINE_MS, easing: EASE, fill: "both" }));
  });
  let at = lines.length * KERF_LINE_MS;
  const offcut = svg.querySelector<SVGElement>(".offcut-group");
  if (offcut) {
    played.push(offcut.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OFFCUT_MS, delay: at, easing: EASE, fill: "both" }));
    at += OFFCUT_MS;
  }
  if (figures) played.push(figures.animate([{ opacity: 0.5 }, { opacity: 1 }], { duration: FIGURES_MS, delay: at, easing: EASE, fill: "both" }));
  return played;
}

// ---- the page ----

interface FitShown {
  version: number;
  fit: Fit;
  token: number;
}

export function BoardPage({ tag }: { tag: string }) {
  const unit = useUnit();
  const { loaded, user } = useSession();
  const services = useServices();
  const billingDown = services.billing === "down";
  const wide = useMedia("(min-width: 1200px)");
  const phone = useMedia("(max-width: 767px)");

  const [board, setBoard] = useState<Board | null | "missing">(null);
  const [history, dispatch] = useReducer(historyReducer, { layout: [], past: [], future: [], version: 0 });
  const { layout, version } = history;
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; pointer: number; x0: number; origin: number; at: number; moved: boolean } | null>(null);
  const [totals, setTotals] = useState<{ version: number; fit: Fit | null } | null>(null);
  const [fitPending, setFitPending] = useState(false);
  const [fitText, setFitText] = useState("");
  const [shown, setShown] = useState<FitShown | null>(null);
  const [form, setForm] = useState({ label: "", length: "", width: "" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [fileStatus, setFileStatus] = useState("");
  const [fileBusy, setFileBusy] = useState<"export" | "import" | null>(null);
  const [extras, setExtras] = useState<Record<string, unknown>>({});
  const [holdStatus, setHoldStatus] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [card, setCard] = useState("");
  const [cardError, setCardError] = useState("");
  const [holdSending, setHoldSending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [width, setWidth] = useState(0);

  const latestTotals = useRef(0);
  const holdKey = useRef("");
  const sending = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const figuresRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const redoRef = useRef<HTMLButtonElement>(null);
  const holdRef = useRef<HTMLButtonElement>(null);
  const payRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const chipRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingFocus = useRef<{ kind: "chip"; id: number } | { kind: "label" } | { kind: "after-undo" } | { kind: "after-redo" } | { kind: "chip-or-label"; id: number } | { kind: "hold" } | { kind: "pay" } | { kind: "card" } | null>(null);
  const repeatChip = useRef<number | null>(null);
  const animations = useRef<Animation[]>([]);
  const restored = useRef(false);
  const observer = useRef<ResizeObserver | null>(null);
  const holderActions = useHoldActions();

  // ---- loading the board ----

  const loadBoard = useCallback(async (): Promise<Board | null> => {
    const r = await api<{ board: Board }>("GET", `/api/boards/${encodeURIComponent(tag)}`);
    if (!r.ok) {
      if (r.status === 404) setBoard("missing");
      return null;
    }
    setBoard(r.data.board);
    return r.data.board;
  }, [tag]);

  useEffect(() => {
    if (loaded) void loadBoard();
  }, [loaded, loadBoard, user?.id]);

  const boardStatus = board !== null && board !== "missing" ? board.status : null;
  useEffect(() => {
    if (boardStatus !== "held") return;
    const timer = setInterval(() => void loadBoard(), 4000);
    return () => clearInterval(timer);
  }, [boardStatus, loadBoard]);

  const measure = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (el === null) return;
    observer.current = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.floor(e.contentRect.width));
    });
    observer.current.observe(el);
  }, []);

  // ---- fit requests ----

  const requestFit = useCallback(async (pieces: ReturnType<typeof piecesOf>) => {
    return api<Fit>("POST", `/api/boards/${encodeURIComponent(tag)}/fit`, { pieces });
  }, [tag]);

  const stopKerf = (): void => {
    for (const a of animations.current) a.cancel();
    animations.current = [];
  };

  const runFitCheck = useCallback(async (pieces: ReturnType<typeof piecesOf>, forVersion: number): Promise<Fit | null> => {
    if (pieces.length === 0) {
      setFitText("Fit check failed. Try again.");
      return null;
    }
    stopKerf();
    setShown(null);
    setFitPending(true);
    const r = await requestFit(pieces);
    setFitPending(false);
    if (!r.ok) {
      setFitText("Fit check failed. Try again.");
      return null;
    }
    setFitText(r.data.verdict);
    setShown((s) => ({ version: forVersion, fit: r.data, token: (s?.token ?? 0) + 1 }));
    return r.data;
  }, [requestFit]);

  // Live totals: every layout change asks the fit endpoint; only the reply for the latest layout is shown.
  useEffect(() => {
    if (board === null || board === "missing") return;
    stopKerf();
    setShown((s) => (s && s.version !== version ? null : s));
    if (layout.length === 0) {
      latestTotals.current = version;
      setTotals({ version, fit: null });
      return;
    }
    latestTotals.current = version;
    const forVersion = version;
    void requestFit(piecesOf(layout)).then((r) => {
      if (latestTotals.current !== forVersion) return;
      setTotals({ version: forVersion, fit: r.ok ? r.data : null });
    });
    // Only a layout change triggers a new request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, board === null || board === "missing"]);

  // The kerf draw-on starts when a Fit check result is drawn.
  useLayoutEffect(() => {
    if (shown === null || svgRef.current === null) return;
    if (reducedMotion()) return;
    animations.current = playKerf(svgRef.current, figuresRef.current);
  }, [shown?.token]);

  // ---- restoring a hold's layout, or the layout kept through sign-in ----

  const realBoard = board !== null && board !== "missing" ? board : null;
  const myHold: Hold | null = realBoard?.my_hold ?? null;
  const fitApplies = shown !== null && shown.version === version;
  const fitClear = fitApplies && shown.fit.pieces.every((p) => p.status === "clear") && (shown.fit.price_cents ?? 0) > DEPOSIT_CENTS;
  const isMaker = user?.role === "maker";
  const canHold = isMaker && realBoard?.status === "available" && fitClear && !billingDown;

  useEffect(() => {
    if (realBoard === null || !loaded || restored.current) return;
    restored.current = true;
    const kept = takeKeptLayout(tag);
    const hold = realBoard.my_hold;
    const start = kept ?? (hold ? hold.pieces.map((p) => makeChip(p)) : null);
    if (start === null) return;
    dispatch({ type: "reset", layout: start });
    const forVersion = version + 1;
    void runFitCheck(piecesOf(start), forVersion).then((fit) => {
      if (kept === null || fit === null || !isMaker || realBoard.status !== "available") return;
      const allClear = fit.pieces.every((p) => p.status === "clear") && (fit.price_cents ?? 0) > DEPOSIT_CENTS;
      if (allClear && services.billing === "up") openHoldDialog();
    });
    // Runs once, when the board and session are first known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realBoard, loaded]);

  // ---- focus moves after a change ----

  useLayoutEffect(() => {
    const want = pendingFocus.current;
    if (want === null) return;
    const label = labelRef.current;
    const focus = (el: HTMLElement | null | undefined): boolean => {
      if (!el) return false;
      el.focus();
      return true;
    };
    let done = true;
    switch (want.kind) {
      case "chip": done = focus(chipRefs.current.get(want.id)); break;
      case "label": done = focus(label); break;
      case "chip-or-label": focus(chipRefs.current.get(want.id) ?? label); break;
      case "after-undo":
        if (history.past.length === 0) focus(history.future.length > 0 ? redoRef.current : label);
        break;
      case "after-redo":
        if (history.future.length === 0) focus(history.past.length > 0 ? undoRef.current : label);
        break;
      case "hold": done = focus(holdRef.current); break;
      case "pay": done = focus(payRef.current); break;
      case "card": done = focus(cardRef.current); break;
    }
    // A target that is not on the page yet (it appears once the board reloads) keeps the request.
    if (done) pendingFocus.current = null;
  });

  // ---- layout edits ----

  const commit = (next: Chip[], merge = false): void => dispatch({ type: "commit", layout: next, merge });

  const undo = (fromButton: boolean): void => {
    const active = document.activeElement;
    const focusedChip = [...chipRefs.current.entries()].find(([, el]) => el === active)?.[0];
    dispatch({ type: "undo" });
    if (fromButton) pendingFocus.current = { kind: "after-undo" };
    else if (focusedChip !== undefined) pendingFocus.current = { kind: "chip-or-label", id: focusedChip };
  };
  const redo = (fromButton: boolean): void => {
    const active = document.activeElement;
    const focusedChip = [...chipRefs.current.entries()].find(([, el]) => el === active)?.[0];
    dispatch({ type: "redo" });
    if (fromButton) pendingFocus.current = { kind: "after-redo" };
    else if (focusedChip !== undefined) pendingFocus.current = { kind: "chip-or-label", id: focusedChip };
  };

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      if (isTextField(e.target) || (e.target instanceof Element && e.target.closest('[role="dialog"]'))) return;
      e.preventDefault();
      if (e.shiftKey) redo(false);
      else undo(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const addPiece = (e: FormEvent): void => {
    e.preventDefault();
    const errors: Record<string, string> = {};
    const label = form.label.trim();
    if ([...label].length < 1 || [...label].length > 40) errors["label"] = "Enter a label of 1 to 40 characters.";
    const length = parseLength(form.length, unit);
    if (length === null || length < 1 || length > 12_000) errors["length"] = unit === "mm" ? "Enter a length from 1 to 12000 mm." : "Enter a length in inches, such as 23.625.";
    const width = parseLength(form.width, unit);
    if (width === null || width < 1 || width > 600) errors["width"] = unit === "mm" ? "Enter a width from 1 to 600 mm." : "Enter a width in inches, such as 4.";
    setFormErrors(errors);
    pendingFocus.current = { kind: "label" };
    if (Object.keys(errors).length > 0 || length === null || width === null || layout.length >= MAX_PIECES) return;
    const last = layout[layout.length - 1];
    const start = last ? last.start_mm + last.length_mm + 10 : 0;
    commit([...layout, makeChip({ label, length_mm: length, width_mm: width, start_mm: start })]);
    setForm((f) => ({ ...f, label: "" }));
  };

  const moveChip = (id: number, to: number, merge: boolean): void => {
    commit(layout.map((c) => (c.id === id ? { ...c, start_mm: to } : c)), merge);
  };

  const onChipKey = (chip: Chip, index: number, e: KeyboardEvent<HTMLButtonElement>): void => {
    if (chip.id !== selectedId) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      let to: number | null = chip.start_mm;
      for (let i = 0; i < (e.shiftKey ? 10 : 1); i++) {
        const next: number | null = to === null ? null : nextMark(to, dir, unit);
        if (next === null || next > 12_000) break;
        to = next;
      }
      const merge = e.repeat && repeatChip.current === chip.id;
      repeatChip.current = chip.id;
      if (to !== null && to !== chip.start_mm) moveChip(chip.id, to, merge);
      return;
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      commit(layout.map((c) => (c.id === chip.id ? { ...c, length_mm: c.width_mm, width_mm: c.length_mm, rotated: !c.rotated } : c)));
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const rest = layout.filter((c) => c.id !== chip.id);
      const next = rest[index] ?? rest[index - 1];
      pendingFocus.current = next ? { kind: "chip", id: next.id } : { kind: "label" };
      setSelectedId(null);
      commit(rest);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setSelectedId(null);
    }
  };

  const scale = realBoard && width > 0 ? width / realBoard.length_mm : 0;

  const startDrag = (id: number, e: ReactPointerEvent<Element>): void => {
    const chip = layout.find((c) => c.id === id);
    if (!chip || scale === 0) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id, pointer: e.pointerId, x0: e.clientX, origin: chip.start_mm, at: chip.start_mm, moved: false });
  };
  const moveDrag = (e: ReactPointerEvent<Element>): void => {
    if (drag === null || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x0;
    setDrag({ ...drag, at: Math.min(Math.max(drag.origin + dx / scale, 0), 12_000), moved: drag.moved || Math.abs(dx) > 3 });
  };
  const endDrag = (e: ReactPointerEvent<Element>): void => {
    if (drag === null || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x0;
    setDrag(null);
    if (!drag.moved && Math.abs(dx) <= 3) return;
    const to = Math.min(nearestMark(Math.max(drag.origin + dx / scale, 0), unit), 12_000);
    if (to !== drag.origin) moveChip(drag.id, to, false);
  };

  const effective = drag?.moved ? layout.map((c) => (c.id === drag.id ? { ...c, start_mm: Math.round(drag.at) } : c)) : layout;

  // ---- Fit check ----

  const fitCheck = (): void => {
    if (fitPending || layout.length === 0) return;
    void runFitCheck(piecesOf(layout), version);
  };

  const onLayoutKey = (e: KeyboardEvent<HTMLElement>): void => {
    if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(e.target)) {
      e.preventDefault();
      fitCheck();
    }
  };

  // ---- layout files ----

  const fileBody = () => ({
    format: "kerf", version: 2, board: tag, unit: "mm",
    pieces: layout.map((c) => ({ label: c.label, length_mm: c.length_mm, width_mm: c.width_mm, start_mm: c.start_mm, ...c.extras })),
    ...extras,
  });

  const exportLayout = async (): Promise<void> => {
    if (fileBusy || layout.length === 0) return;
    setFileBusy("export");
    const stored = await api("POST", `/api/boards/${encodeURIComponent(tag)}/layout`, fileBody());
    let bytes: Blob | null = null;
    if (stored.ok) {
      try {
        const response = await fetch(`/api/boards/${encodeURIComponent(tag)}/layout.kerf`, { credentials: "same-origin" });
        if (response.ok) bytes = await response.blob();
      } catch {
        bytes = null;
      }
    }
    setFileBusy(null);
    if (bytes === null) {
      setFileStatus("Something went wrong. Try again.");
      return;
    }
    const url = URL.createObjectURL(bytes);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tag}.kerf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setFileStatus(`Layout exported as ${tag}.kerf.`);
  };

  const importLayout = async (file: File): Promise<void> => {
    setFileBusy("import");
    const text = await file.text();
    const r = await api<{ layout: { pieces: Record<string, unknown>[] } & Record<string, unknown> }>(
      "POST", `/api/boards/${encodeURIComponent(tag)}/layout`, text);
    setFileBusy(null);
    if (!r.ok) {
      const code = r.error.error;
      setFileStatus(code === "unsupported_version" ? "This layout file is from a newer version of Kerfwell. Nothing was changed."
        : code === "wrong_board" ? "This layout file is for another board. Nothing was changed."
          : code === "validation" || code === "bad_json" ? "This layout file can't be read. Nothing was changed."
            : "Something went wrong. Try again.");
      return;
    }
    const { format: _f, version: _v, board: _b, unit: _u, pieces, ...rest } = r.data.layout;
    const chips = pieces.map((p) => {
      const { label, length_mm, width_mm, start_mm, ...more } = p;
      return makeChip({ label: String(label), length_mm: Number(length_mm), width_mm: Number(width_mm), start_mm: Number(start_mm) }, more);
    });
    setExtras(rest);
    setSelectedId(null);
    commit(chips);
    setFileStatus(chips.length === 1 ? "Imported 1 piece from the layout file." : `Imported ${chips.length} pieces from the layout file.`);
  };

  // ---- hold ----

  function openHoldDialog(): void {
    holdKey.current = newKey();
    setCard("");
    setCardError("");
    setConflict(false);
    setDialogOpen(true);
  }

  const goSignIn = (): void => {
    keepLayout(tag, layout);
    sessionStore.set({ loaded: true, user: null });
    navigate(signInPath(`/boards/${tag}`));
  };

  const pressHold = async (): Promise<void> => {
    if (!canHold) return;
    const r = await api("GET", "/api/session");
    if (!r.ok) {
      goSignIn();
      return;
    }
    openHoldDialog();
  };

  const submitHold = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (sending.current || billingDown || conflict) return;
    if (!validCardNumber(card)) {
      setCardError("Enter a valid card number.");
      return;
    }
    setCardError("");
    sending.current = true;
    setHoldSending(true);
    setHoldStatus("Waiting for billing to confirm your deposit");
    const r = await api<{ hold: Hold }>("POST", "/api/holds", { board: tag, pieces: piecesOf(layout), card_number: card }, { "Idempotency-Key": holdKey.current });
    sending.current = false;
    setHoldSending(false);
    if (r.ok) {
      setHoldStatus("Board held. Deposit paid.");
      setDialogOpen(false);
      pendingFocus.current = { kind: "pay" };
      await loadBoard();
      return;
    }
    switch (r.error.error) {
      case "card_declined":
        setDialogOpen(false);
        setHoldStatus("Your card was declined. The board is still available.");
        return;
      case "payment_failed":
        setDialogOpen(false);
        setHoldStatus("Billing did not confirm the payment. You were not charged.");
        return;
      case "already_held":
        setConflict(true);
        setHoldStatus("");
        void loadBoard();
        return;
      case "billing_unavailable":
        setHoldStatus("Billing is offline. Your card was not charged.");
        pendingFocus.current = { kind: "card" };
        void refreshServices();
        return;
      case "unauthenticated":
        setDialogOpen(false);
        goSignIn();
        return;
      default:
        setHoldStatus("Something went wrong. Try again.");
    }
  };

  const holderPay = async (hold: Hold): Promise<void> => {
    if (billingDown || holderActions.pending) return;
    const outcome = await holderActions.pay(hold);
    if (outcome.kind === "unauthenticated") return goSignIn();
    setHoldStatus(outcome.message);
    if (outcome.kind === "paid") {
      const sold = outcome.sale.sale === "cut" ? "cut" : "sold-whole";
      setBoard((current) => (current !== null && current !== "missing" ? { ...current, status: sold, my_hold: null, price_cents: null, rate_cents: null } : current));
    } else if (outcome.kind === "not_active") await loadBoard();
  };
  const holderCancel = async (hold: Hold): Promise<void> => {
    if (billingDown || holderActions.pending) return;
    const outcome = await holderActions.cancel(hold);
    if (outcome.kind === "unauthenticated") return goSignIn();
    setHoldStatus(outcome.message);
    if (outcome.kind !== "failed") {
      pendingFocus.current = { kind: "hold" };
      await loadBoard();
    }
  };

  // ---- render ----

  if (board === "missing") return <NotFound />;
  if (realBoard === null) return <p className="muted loading">Loading the board…</p>;

  const b = realBoard;
  const totalsFit = totals?.fit ?? null;
  const showFigures = layout.length > 0 && totalsFit !== null && totalsFit.take_mm !== null;
  const kerf: KerfDrawing | null = fitApplies && shown.fit.take_mm !== null
    ? { cuts: shown.fit.cuts_mm, take: shown.fit.take_mm, offcut: shown.fit.offcut_mm } : null;
  const heldByMe = myHold !== null && myHold.status === "held";
  const badge = BOARD_LABELS[b.status];
  const holdButtonLabel = billingDown ? "Holds paused" : "Hold board";

  return (
    <article className="board-page">
      <header className="board-head">
        <div>
          <h1 className="mono-title">{b.tag}</h1>
          <p className="board-species">{b.species}{b.grade ? ` · ${b.grade}` : ""}</p>
        </div>
        <span className={`badge ${b.status}`}>{badge}</span>
      </header>
      <dl className="facts">
        <div><dt>Lot</dt> <dd>{b.lot.name}, {b.lot.origin}, built {b.lot.built_year}</dd></div>
        {b.parent_tag && <div><dt>Lineage</dt> <dd>Cut from <span className="mono">{b.parent_tag}</span></dd></div>}
        <div><dt>Size</dt> <dd className="mono measure">{[b.length_mm, b.width_mm, b.thickness_mm].map((v) => lengthText(v, unit)).join(" × ")}</dd></div>
        <div><dt>Rate</dt> <dd className="mono">{b.rate_cents === null ? "Not priced" : `$${money(b.rate_cents)} per bd ft`}</dd></div>
        <div><dt>Whole board</dt> <dd className="mono">{b.board_feet} bd ft{b.price_cents !== null && ` · $${money(b.price_cents)}`}</dd></div>
        {heldByMe && myHold.expires_at && <div><dt>Hold</dt> <dd>Held until {formatWhen(myHold.expires_at)}</dd></div>}
      </dl>
      <div role="radiogroup" aria-label="Units" className="units">
        <label className="check"><input type="radio" name="units" checked={unit === "mm"} onChange={() => setUnit("mm")} /><span>Millimetres</span></label>
        <label className="check"><input type="radio" name="units" checked={unit === "in"} onChange={() => setUnit("in")} /><span>Inches</span></label>
      </div>
      {b.photos.length > 0 && (
        <div className="photos">
          {b.photos.map((p, i) => <PhotoImage key={p.id} src={p.url} alt={`Photo ${i + 1} of ${b.tag}`} width={p.width} height={p.height} />)}
        </div>
      )}
      <div className={`drawing${phone ? " full-bleed" : ""}`} ref={measure}>
        {width > 0 && (
          <>
            <Elevation
              ref={svgRef}
              tag={b.tag}
              lengthMm={b.length_mm}
              defects={b.defects}
              width={width}
              boardHeight={phone ? 72 : 88}
              pieces={effective}
              selectedId={selectedId}
              kerf={kerf}
              unit={unit}
              onPiecePointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
            />
            <Ruler lengthMm={b.length_mm} width={width} />
          </>
        )}
      </div>
      <section role="region" aria-label="Layout" className={`layout${wide ? " two-col" : ""}`} onKeyDown={onLayoutKey}>
        <div className="layout-left">
          <div role="group" aria-label="Cut list" className="chips">
            {effective.length === 0 && <p className="muted">No pieces yet. Add the first one below.</p>}
            {effective.map((c, i) => {
              const over = overDefect(c, b.defects);
              const serverStatus = fitApplies ? shown.fit.pieces[i]?.status : undefined;
              return (
                <button
                  key={c.id}
                  ref={(el) => { if (el) chipRefs.current.set(c.id, el); else chipRefs.current.delete(c.id); }}
                  type="button"
                  className={`chip${over ? " over" : ""}${drag?.id === c.id ? " dragging" : ""}`}
                  aria-pressed={selectedId === c.id}
                  aria-label={chipName(c, unit, b.defects)}
                  onClick={() => setSelectedId(c.id)}
                  onKeyDown={(e) => onChipKey(c, i, e)}
                  onKeyUp={() => { repeatChip.current = null; }}
                  onPointerDown={(e) => startDrag(c.id, e)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span className="chip-label">{c.label}</span>{" "}
                  <span className="mono measure">{lengthText(c.length_mm, unit)} at {lengthText(c.start_mm, unit)}</span>
                  {over && <span className="chip-flag"> over defect</span>}
                  {!over && serverStatus && serverStatus !== "clear" && <span className="chip-flag"> {serverStatus}</span>}
                </button>
              );
            })}
          </div>
          <div className="history-buttons">
            <button ref={undoRef} type="button" className="quiet" disabled={history.past.length === 0} onClick={() => undo(true)}>
              <Icon name="undo" />Undo
            </button>
            <button ref={redoRef} type="button" className="quiet" disabled={history.future.length === 0} onClick={() => redo(true)}>
              <Icon name="redo" />Redo
            </button>
          </div>
          <form className="piece-form" onSubmit={addPiece} noValidate>
            <label className="field">
              <span>Piece label</span>
              <input ref={labelRef} type="text" value={form.label} maxLength={40} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-invalid={formErrors["label"] ? true : undefined} />
              {formErrors["label"] && <span className="field-error">{formErrors["label"]}</span>}
            </label>
            <label className="field">
              <span>Piece length</span>
              <span className="unit-input"><input type="text" inputMode="decimal" className="mono" value={form.length} onChange={(e) => setForm({ ...form, length: e.target.value })} aria-invalid={formErrors["length"] ? true : undefined} /><span className="unit">{unit}</span></span>
              {formErrors["length"] && <span className="field-error">{formErrors["length"]}</span>}
            </label>
            <label className="field">
              <span>Piece width</span>
              <span className="unit-input"><input type="text" inputMode="decimal" className="mono" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} aria-invalid={formErrors["width"] ? true : undefined} /><span className="unit">{unit}</span></span>
              {formErrors["width"] && <span className="field-error">{formErrors["width"]}</span>}
            </label>
            <button type="submit" className="quiet" disabled={layout.length >= MAX_PIECES}>Add piece</button>
          </form>
        </div>
        <div className="layout-right">
          <button type="button" className="primary fit-button" onClick={fitCheck} aria-disabled={layout.length === 0 ? true : undefined}>
            {fitPending ? "Checking fit" : "Fit check"}
          </button>
          <div role="status" aria-label="Fit result" className="verdict">{fitText}</div>
          <div role="status" aria-label="Layout totals" className="totals">
            {layout.length === 0 && "Add a piece to see the take and price."}
            {layout.length > 0 && totals !== null && !showFigures && totals.version > 0 && "Fix the layout to see the take and price."}
            {showFigures && totalsFit && (
              <div ref={figuresRef} className={`figures-row${fitPending ? " dim" : ""}`}>
                <div><span className="fig-label">Take</span> <span className="mono measure">{lengthText(totalsFit.take_mm ?? 0, unit)}</span></div>{" "}
                <div><span className="fig-label">Board feet</span> <span className="mono">{totalsFit.board_feet} bd ft</span></div>{" "}
                <div><span className="fig-label">Price</span> <span className="mono">${money(totalsFit.price_cents ?? 0)}</span></div>{" "}
                <div><span className="fig-label">Clear offcut</span> <span className="mono measure">{totalsFit.sale === "whole" ? "none" : lengthText(totalsFit.clear_offcut_mm ?? 0, unit)}</span></div>
              </div>
            )}
          </div>
          {isMaker && (
            <div className="file-controls">
              <button type="button" className="quiet" disabled={layout.length === 0 || fileBusy !== null} onClick={() => void exportLayout()}>
                <Icon name="download" />{fileBusy === "export" ? "Exporting" : "Export layout"}
              </button>
              <button type="button" className="quiet" disabled={fileBusy !== null} onClick={() => importRef.current?.click()}>
                <Icon name="upload" />{fileBusy === "import" ? "Importing" : "Import layout"}
              </button>
              <input ref={importRef} type="file" accept=".kerf,.json,application/json" hidden onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importLayout(file);
              }} />
              <div role="status" aria-label="Layout file status" className="status-line">{fileStatus}</div>
            </div>
          )}
          <div className="hold-controls">
            {heldByMe ? (
              <>
                <p>Held until {formatWhen(myHold.expires_at ?? "")}</p>
                <div className="card-actions">
                  <button ref={payRef} type="button" className="primary" aria-disabled={billingDown ? true : undefined} onClick={() => void holderPay(myHold)}>
                    {holderActions.pending?.action === "pay" ? "Paying" : "Pay and cut"}
                  </button>
                  <button type="button" className="quiet" aria-disabled={billingDown ? true : undefined} onClick={() => void holderCancel(myHold)}>
                    {holderActions.pending?.action === "cancel" ? "Cancelling" : "Cancel hold"}
                  </button>
                </div>
                {billingDown && <p className="paused">{HOLD_COPY.paused}</p>}
              </>
            ) : !loaded ? null : user === null ? (
              b.status === "available" && <Link to={signInPath(`/boards/${tag}`)} className="button primary" onBeforeNavigate={() => keepLayout(tag, layout)}>Sign in to hold</Link>
            ) : isMaker && b.status === "available" ? (
              <button ref={holdRef} type="button" className="primary" aria-disabled={canHold ? undefined : true} onClick={() => void pressHold()}>
                {holdButtonLabel}
              </button>
            ) : isMaker && b.status === "held" ? (
              <p className="muted">On hold for another maker.</p>
            ) : null}
            {isMaker && !heldByMe && b.status === "available" && !fitClear && !billingDown && (
              <p className="hint">Run Fit check with every piece clear to hold this board for a ${money(DEPOSIT_CENTS)} deposit.</p>
            )}
            <div role="status" aria-label="Hold status" className="status-line">{holdStatus}</div>
          </div>
        </div>
      </section>
      <Dialog open={dialogOpen} title="Hold this board" variant="dialog" onClose={() => setDialogOpen(false)} returnFocus={holdRef} initialFocus={cardRef}>
        {conflict ? (
          <div className="conflict">
            <h3>Already held by another maker</h3>
            <p>Someone held this board a moment before you. Your card was not charged.</p>
          </div>
        ) : (
          <p className="dialog-note">A ${money(DEPOSIT_CENTS)} deposit holds {b.tag} for you. You pay the rest when it is cut.</p>
        )}
        <form onSubmit={(e) => void submitHold(e)} noValidate>
          {!conflict && (
            <label className="field">
              <span>Card number</span>
              <input ref={cardRef} type="text" inputMode="numeric" autoComplete="cc-number" className="mono" value={card}
                onChange={(e) => setCard(e.target.value)} aria-invalid={cardError ? true : undefined} />
              {cardError && <span className="field-error">{cardError}</span>}
            </label>
          )}
          <div className="dialog-actions">
            {!conflict && (
              <button type="submit" className="primary" disabled={holdSending} aria-disabled={billingDown ? true : undefined}>
                {holdSending ? "Holding" : billingDown ? "Holds paused" : "Pay deposit and hold"}
              </button>
            )}
            <button type="button" className="quiet" onClick={() => setDialogOpen(false)}>Close</button>
          </div>
        </form>
      </Dialog>
    </article>
  );
}

function PhotoImage({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="photo-missing" role="img" aria-label={alt}>Photo unavailable</div>;
  return <img src={src} alt={alt} width={width} height={height} className="photo" onError={() => setFailed(true)} />;
}
