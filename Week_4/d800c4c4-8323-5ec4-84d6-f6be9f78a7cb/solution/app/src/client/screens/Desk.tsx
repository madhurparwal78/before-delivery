import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  request,
  sessionEnded,
  type Answer,
  type Board,
  type CalendarInfo,
  type Counts,
  type Fee,
  type Grade,
  type Item,
  type Loan,
  type Part,
} from "../api";
import { BoardView } from "../board/Board";
import { LOAN_WORD } from "../board/outline";
import { ActionButton, Dialog, DueLine, FieldMessage, focusables, Num, prefersReducedMotion, Status, usePoll, type Problem } from "../components/ui";
import { NewLoanDialog, type NewLoanEntries, type NewLoanOutcome } from "../desk/NewLoanDialog";
import { photoForm, PhotoPicker } from "../desk/PhotoPicker";
import { dollars } from "../format";
import { readReturnTime } from "../returnTime";
import { takeDraft } from "../session";
import { useShell, type Me } from "../shell";
import { PaneAnnouncements, ToolDetail } from "./Pegboard";
import { useAnnouncer } from "./useAnnouncer";

const OPEN_STATUSES = "reserved,out,pending-photo,returned-partial";
const SPRING = "cubic-bezier(.34,1.45,.55,1)";
const SNAP_PX = 24;
const GRADES: Grade[] = ["good", "worn", "damaged"];

type FocusTarget = "scan" | "first-card" | "detail-first" | "detail-photo" | "check-out" | "member-list" | { element: HTMLElement } | { card: number } | null;

function outcomeCopy(loan: Loan, fee: Fee | null): string {
  const base = loan.status === "returned-complete" ? "Returned complete." : `Returned — partial. Missing: ${loan.missing_parts.join(", ")}.`;
  return fee ? `${base} Fee raised: $${dollars(fee.total_cents)}.` : base;
}

const unhungParts = (loan: Loan) => loan.parts.filter((p) => (loan.status === "out" ? p.state === "out" : loan.status === "returned-partial" && p.state === "missing"));

function isTextField(element: Element | null): boolean {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  return element instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "file"].includes(element.type);
}

function springBack(card: HTMLElement): void {
  const from = card.style.transform;
  card.style.transform = "";
  card.classList.remove("is-dragging");
  if (!from || prefersReducedMotion()) return;
  card.animate([{ transform: from }, { transform: "none" }], { duration: 380, easing: SPRING });
}

export function Desk({ me }: { me: Me }) {
  const shell = useShell();
  const news = useAnnouncer(me);
  const coordinator = me.user.role === "coordinator";
  const summary = useRef<HTMLDivElement>(null);
  const scanBox = useRef<HTMLInputElement>(null);
  const newLoanButton = useRef<HTMLButtonElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const queueRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const outlines = useRef(new Map<number, HTMLButtonElement>());
  const cards = useRef(new Map<number, HTMLButtonElement>());

  const [board, setBoard] = useState<Board | null>(null);
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [selected, setSelected] = useState<Loan | null>(null);
  const [toolId, setToolId] = useState<number | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [scanText, setScanText] = useState("");
  const typedScan = useRef(false);
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [grades, setGrades] = useState<Record<number, Grade>>({});
  const [photo, setPhoto] = useState<File | null>(null);
  const [returnText, setReturnText] = useState("");
  const typedReturn = useRef(false);
  const [secondHour, setSecondHour] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [returnMessage, setReturnMessage] = useState("");
  const [picked, setPicked] = useState<{ partId: number; over: number } | null>(null);
  const [tapPicked, setTapPicked] = useState<number | null>(null);
  const [snapPart, setSnapPart] = useState<number | null>(null);
  const [justHung, setJustHung] = useState<number | null>(null);
  const [takeDown, setTakeDown] = useState<number | null>(null);
  const [newLoan, setNewLoan] = useState<{ tools: Item[]; opener: "button" | "scan" } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState<"checkout" | "cancel" | "checkin" | "finish" | "takedown" | null>(null);
  const confirmOpener = useRef<HTMLElement | null>(null);
  const focusAfter = useRef<FocusTarget>(null);
  const writes = useRef(0);
  const selectedRef = useRef<Loan | null>(null);
  selectedRef.current = selected;
  const knownDue = useRef<{ id: number; due: string | null } | null>(null);
  const focusWasInDetail = useRef(false);
  const dragging = useRef<{ partId: number; pointerId: number; grabX: number; grabY: number; tx: number; ty: number; moved: boolean; startX: number; startY: number } | null>(null);
  const hangInFlight = useRef(false);

  /** Applies a fresh read of the selected loan; a due date moved elsewhere is announced once. */
  const applySelected = (loan: Loan | null) => {
    const before = selectedRef.current;
    if (loan && before && loan.id === before.id && loan.status !== before.status) {
      const active = document.activeElement;
      focusWasInDetail.current = !!active && (detailRef.current?.contains(active) || queueRef.current?.querySelector(".tag-cards")?.contains(active) || false);
    }
    if (loan && knownDue.current?.id === loan.id && knownDue.current.due !== null && loan.due_date !== null && loan.due_date !== knownDue.current.due) {
      news.announce(`Due date moved to ${loan.due_date}.`);
    }
    knownDue.current = loan ? { id: loan.id, due: loan.due_date } : null;
    selectedRef.current = loan;
    setSelected(loan && loan.status === "returned-complete" ? null : loan);
  };

  useLayoutEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (typeof target === "object" && target !== null) {
      if ("card" in target) (cards.current.get(target.card) ?? scanBox.current)?.focus();
      else target.element.focus();
    } else if (target === "scan") scanBox.current?.focus();
    else if (target === "first-card" && selected) {
      const first = unhungParts(selected)[0];
      if (first) cards.current.get(first.id)?.focus();
      else detailRef.current?.querySelector<HTMLInputElement>('[role="radiogroup"] input:checked, [role="radiogroup"] input')?.focus();
    } else if (target === "detail-photo") detailRef.current?.querySelector<HTMLButtonElement>(".photo-picker button")?.focus();
    else if (target === "detail-first" && detailRef.current) focusables(detailRef.current)[0]?.focus();
    else if (target === "check-out") detailRef.current?.querySelector<HTMLButtonElement>("[data-check-out]")?.focus();
    else if (target === "member-list") listRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    if (focusWasInDetail.current && (document.activeElement === document.body || document.activeElement === null) && detailRef.current) {
      focusables(detailRef.current)[0]?.focus();
    }
    focusWasInDetail.current = false;
  });

  useLayoutEffect(() => {
    if (!picked) return;
    outlines.current.get(picked.over)?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }, [picked?.over]);

  const readBoard = useCallback(async () => {
    const seq = writes.current;
    const [boardAnswer, loanAnswer] = await Promise.all([request<Board>("GET", "/api/board"), request<{ loans: Loan[] }>("GET", `/api/loans?status=${OPEN_STATUSES}`)]);
    if (seq !== writes.current) return;
    if (boardAnswer.status === 200) {
      setBoard(boardAnswer.body);
      shell.setCounts(boardAnswer.body.counts);
    }
    if (loanAnswer.status === 200) {
      setLoans(loanAnswer.body.loans);
      const current = selectedRef.current;
      if (current) applySelected(loanAnswer.body.loans.find((l) => l.id === current.id) ?? null);
    }
  }, []);

  const readSelected = useCallback(async () => {
    const current = selectedRef.current;
    if (!current) return;
    const seq = writes.current;
    const answer = await request<{ loan: Loan }>("GET", `/api/loans/${current.id}`);
    if (seq !== writes.current || selectedRef.current?.id !== current.id) return;
    if (answer.status === 200) applySelected(answer.body.loan);
  }, []);

  const readCalendar = useCallback(async () => {
    const answer = await request<CalendarInfo>("GET", "/api/calendar");
    if (answer.status === 200) setZone(answer.body.time_zone);
  }, []);

  useEffect(() => {
    scanBox.current?.focus();
    void Promise.all([readBoard(), readCalendar()]).then(() => {
      const draft = takeDraft("/desk", me.user.id);
      if (!draft) return;
      if (draft.toolId !== undefined) setToolId(draft.toolId);
      const loan = draft.loanId !== undefined ? selectedLoanFrom(draft.loanId) : undefined;
      if (loan) applySelected(loan);
      if (draft.fields.scan !== undefined) {
        typedScan.current = true;
        setScanText(draft.fields.scan);
      }
      if (draft.fields.returnTime !== undefined && loan?.status === "out") {
        typedReturn.current = true;
        setReturnText(draft.fields.returnTime);
      }
    });
  }, []);
  // The loan rows wrap differently in the fallback face, so they wait for the faces they use (at most 3 s);
  // otherwise the swap rewraps them and moves the board below on a phone.
  const [fontsReady, setFontsReady] = useState(() => !("fonts" in document));
  useEffect(() => {
    if (fontsReady) return;
    const faces = ["400 1em 'IBM Plex Sans'", "600 1em 'IBM Plex Sans'", "400 1em 'IBM Plex Mono'", "500 1em 'IBM Plex Mono'"];
    const done = () => setFontsReady(true);
    const cap = window.setTimeout(done, 3000);
    void Promise.all(faces.map((face) => document.fonts.load(face))).then(done, done);
    return () => window.clearTimeout(cap);
  }, []);
  usePoll(readBoard, 2000);
  usePoll(readSelected, 2000, selected !== null);
  usePoll(readCalendar, 10_000);
  useEffect(() => shell.setFastStatus(selected?.status === "pending-photo"), [selected?.status]);
  useEffect(() => () => shell.setFastStatus(false), []);

  const loansRef = useRef<Loan[] | null>(null);
  loansRef.current = loans;
  const selectedLoanFrom = (id: number) => loansRef.current?.find((l) => l.id === id);

  /** Selects a loan; a user's selection also moves focus to the loan's first control. */
  const selectLoan = (loan: Loan, moveFocus: boolean) => {
    if (selectedRef.current?.id !== loan.id) {
      setGrades({});
      setPhoto(null);
      setReturnText("");
      typedReturn.current = false;
      setSecondHour(false);
      setReturnMessage("");
      setPicked(null);
      setTapPicked(null);
      setTakeDown(null);
    }
    knownDue.current = { id: loan.id, due: loan.due_date };
    applySelected(loan);
    if (moveFocus) focusAfter.current = loan.status === "out" || loan.status === "returned-partial" ? "first-card" : "detail-photo";
  };

  const sessionGone = () => {
    setNewLoan(null);
    setConfirmOpen(false);
    const fields: Record<string, string> = {};
    if (typedScan.current) fields.scan = scanText;
    if (typedReturn.current) fields.returnTime = returnText;
    news.sessionEnded({
      fields,
      ...(selectedRef.current ? { loanId: selectedRef.current.id } : {}),
      ...(toolId !== null ? { toolId } : {}),
    });
  };

  /** Merges a hang or take-down answer into the board at once, then reads the board again. */
  const applyLoanParts = (loan: Loan, counts: Counts, bumped: boolean) => {
    writes.current += 1;
    setBoard((current) =>
      current && {
        ...current,
        counts,
        items: current.items.map((item) => ({ ...item, parts: item.parts.map((p) => loan.parts.find((lp) => lp.id === p.id) ?? p) })),
      },
    );
    shell.setCounts(counts, bumped);
    applySelected(loan);
    setLoans((current) => current && (loan.status === "returned-complete" ? current.filter((l) => l.id !== loan.id) : current.map((l) => (l.id === loan.id ? loan : l))));
    void readBoard();
  };

  const hang = async (part: Part, pegId: number, card: HTMLElement | null) => {
    const loan = selectedRef.current;
    if (!loan || hangInFlight.current) return;
    hangInFlight.current = true;
    const answer = await request<{ loan: Loan; counts: Counts }>("POST", `/api/loans/${loan.id}/hang`, { part_id: part.id, peg_part_id: pegId });
    hangInFlight.current = false;
    setPicked(null);
    setSnapPart(null);
    if (answer.status === 200) {
      const completed = loan.status === "returned-partial" && answer.body.loan.status === "returned-complete";
      setJustHung(part.id);
      setTakeDown(null);
      applyLoanParts(answer.body.loan, answer.body.counts, true);
      news.announce(`${part.name} is on its peg.${completed ? " Returned complete." : ""}`);
      const next = unhungParts(answer.body.loan)[0];
      focusAfter.current = next ? { card: next.id } : answer.body.loan.status === "out" ? "first-card" : "scan";
      return;
    }
    if (card) springBack(card);
    if (sessionEnded(answer)) return sessionGone();
    news.announce(answer.error);
    if (answer.status === 409) await Promise.all([readSelected(), readBoard()]);
  };

  const takeDownPart = async (part: Part) => {
    const loan = selectedRef.current!;
    setPending("takedown");
    const answer = await request<{ loan: Loan; counts: Counts }>("DELETE", `/api/loans/${loan.id}/hang/${part.id}`);
    setPending(null);
    if (answer.status === 200) {
      setTakeDown(null);
      applyLoanParts(answer.body.loan, answer.body.counts, false);
      news.announce(`${part.name} is off its peg.`);
      focusAfter.current = { card: part.id };
      return;
    }
    if (sessionEnded(answer)) return sessionGone();
    news.announce(answer.error);
    if (answer.status === 409) await Promise.all([readSelected(), readBoard()]);
  };

  const allParts = (board?.items ?? []).flatMap((i) => i.parts).sort((a, b) => a.row - b.row || a.col - b.col);

  const onOutline = useCallback((part: Part, item: Item) => {
    const loan = selectedRef.current;
    const tapped = tapPickedRef.current;
    if (tapped !== null && loan) {
      const own = loan.parts.find((p) => p.id === tapped);
      setTapPicked(null);
      if (own) void hang(own, part.id, null);
      return;
    }
    if (loan?.status === "out" && part.state === "hung" && loan.parts.some((p) => p.id === part.id)) {
      setTakeDown(part.id);
      return;
    }
    const onLoan = loansRef.current?.find((l) => l.items.some((i) => i.id === item.id));
    if (onLoan) {
      selectLoan(onLoan, true);
      return;
    }
    applySelected(null);
    setToolId(item.id);
  }, []);
  const tapPickedRef = useRef<number | null>(null);
  tapPickedRef.current = tapPicked;

  const register = useCallback((id: number, el: HTMLButtonElement | null) => {
    if (el) outlines.current.set(id, el);
    else outlines.current.delete(id);
  }, []);

  // A scan made before the first read has answered runs as soon as the desk has its data.
  const scanWaiting = useRef(false);
  useEffect(() => {
    if (scanWaiting.current && loans && board) {
      scanWaiting.current = false;
      scan();
    }
  }, [loans, board]);

  const scan = () => {
    const text = scanText.trim();
    if (!text) return;
    if (!loans || !board) {
      scanWaiting.current = true;
      return;
    }
    const upper = text.toUpperCase();
    const byRef = loans.find((l) => l.ref.toUpperCase() === upper);
    const byTag = loans.find((l) => l.items.some((i) => i.tag.toUpperCase() === upper));
    if (byRef || byTag) {
      setMemberFilter(null);
      selectLoan((byRef ?? byTag)!, true);
      return;
    }
    const tool = board.items.find((i) => i.tag.toUpperCase() === upper);
    if (tool && (tool.status === "on-wall" || tool.status === "held")) {
      setNewLoan({ tools: [tool], opener: "scan" });
      return;
    }
    const needle = text.toLowerCase();
    if (loans.some((l) => l.member_name.toLowerCase().includes(needle))) {
      setMemberFilter(needle);
      focusAfter.current = "member-list";
      return;
    }
    news.announce(`Nothing on the desk matches ${text}.`);
  };

  const validateCheckin = (loan: Loan): boolean => {
    const missing: Problem[] = [];
    for (const item of loan.items) {
      if (!grades[item.id]) missing.push({ field: `grade-${item.id}`, label: `Condition of ${item.name}`, message: "Choose good, worn or damaged.", target: `grade-${item.id}-good` });
    }
    if (!photo) missing.push({ field: "photo", label: "Photo", message: "Take or choose the check-in photo.", target: "checkin-photo" });
    const typed = readReturnTime(returnText, zone ?? "UTC");
    let message = "";
    if (typed.kind === "malformed") message = "Use YYYY-MM-DD HH:MM in library time.";
    if (typed.kind === "skipped") message = "That time does not exist in library time because the clocks go forward.";
    if (message) missing.push({ field: "return-time", label: "Return time", message, target: "return-time" });
    setReturnMessage(message);
    setProblems(missing);
    if (missing.length) focusAfter.current = { element: summary.current! };
    return missing.length === 0;
  };

  const openConfirm = () => {
    const loan = selectedRef.current;
    if (!loan || loan.status !== "out") return;
    confirmOpener.current = document.activeElement as HTMLElement | null;
    if (validateCheckin(loan)) setConfirmOpen(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (newLoanOpenRef.current || confirmOpenRef.current) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && selectedRef.current?.status === "out") {
        event.preventDefault();
        openConfirmRef.current();
      } else if (event.key === "/" && !isTextField(document.activeElement)) {
        event.preventDefault();
        scanBox.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const newLoanOpenRef = useRef(false);
  newLoanOpenRef.current = newLoan !== null;
  const confirmOpenRef = useRef(false);
  confirmOpenRef.current = confirmOpen;
  const openConfirmRef = useRef(openConfirm);
  openConfirmRef.current = openConfirm;

  const finishReply = async (answer: Answer<{ loan: Loan; fee: Fee | null }>, storageDownCopy: string) => {
    if (sessionEnded(answer)) return sessionGone();
    if (answer.status === 200 || answer.status === 202) {
      writes.current += 1;
      setConfirmOpen(false);
      setProblems([]);
      news.announce(answer.status === 202 ? storageDownCopy : outcomeCopy(answer.body.loan, answer.body.fee));
      applySelected(answer.body.loan);
      focusAfter.current = "scan";
      void readBoard();
      return;
    }
    news.announce(answer.error);
    if (answer.status === 409) {
      setConfirmOpen(false);
      focusAfter.current = "detail-first";
      await Promise.all([readSelected(), readBoard()]);
    }
  };

  const confirmCheckin = async () => {
    const loan = selectedRef.current!;
    const typed = readReturnTime(returnText, zone ?? "UTC");
    const fields: Record<string, string> = { grades: JSON.stringify(Object.fromEntries(loan.items.map((i) => [String(i.id), grades[i.id]]))) };
    if (typed.kind === "once") fields.returned_at = typed.iso;
    if (typed.kind === "repeated") fields.returned_at = secondHour ? typed.second : typed.first;
    const form = await photoForm(fields, photo!);
    setPending("checkin");
    const answer = await request<{ loan: Loan; fee: Fee | null }>("POST", `/api/loans/${loan.id}/checkin`, form);
    setPending(null);
    await finishReply(answer, "Saved as pending photo. Nothing has been charged.");
  };

  const finishCheckin = async () => {
    const loan = selectedRef.current!;
    if (!photo) {
      setProblems([{ field: "photo", label: "Photo", message: "Take or choose the check-in photo.", target: "checkin-photo" }]);
      focusAfter.current = { element: summary.current! };
      return;
    }
    const form = await photoForm({}, photo);
    setPending("finish");
    const answer = await request<{ loan: Loan; fee: Fee | null }>("POST", `/api/loans/${loan.id}/finish`, form);
    setPending(null);
    await finishReply(answer, "");
  };

  const checkOutReserved = async (loan: Loan, file: File | null): Promise<boolean> => {
    if (!file) {
      setProblems([{ field: "photo", label: "Photo", message: "Take or choose the checkout photo.", target: "checkin-photo" }]);
      focusAfter.current = { element: summary.current! };
      return false;
    }
    const form = await photoForm({}, file);
    const answer = await request<{ loan: Loan }>("POST", `/api/loans/${loan.id}/checkout`, form);
    if (sessionEnded(answer)) {
      sessionGone();
      return false;
    }
    if (answer.status === 200) {
      writes.current += 1;
      const out = answer.body.loan;
      news.announce(`Loan ${out.ref} is out. Due ${out.due_date} by ${out.due_by}.`);
      applySelected(null);
      setPhoto(null);
      setProblems([]);
      focusAfter.current = "scan";
      void readBoard();
      return true;
    }
    news.announce(answer.error);
    return false;
  };

  const cancelReserved = async (loan: Loan) => {
    setPending("cancel");
    const answer = await request("DELETE", `/api/loans/${loan.id}`);
    setPending(null);
    if (sessionEnded(answer)) return sessionGone();
    if (answer.status === 204) {
      writes.current += 1;
      news.announce(`Loan ${loan.ref} cancelled.`);
      applySelected(null);
      focusAfter.current = "scan";
      void readBoard();
      return;
    }
    news.announce(answer.error);
  };

  const newLoanCheckOut = async (entries: NewLoanEntries, setPhase: (phase: "reserving" | "checking-out" | null) => void): Promise<NewLoanOutcome> => {
    setPhase("reserving");
    const body: Record<string, unknown> = { member_id: entries.member!.id, item_ids: entries.tools.map((t) => t.id) };
    if (entries.checkedOutAt.trim()) {
      const typed = readReturnTime(entries.checkedOutAt, zone ?? "UTC");
      if (typed.kind === "once") body.checked_out_at = typed.iso;
      if (typed.kind === "repeated") body.checked_out_at = typed.first;
    }
    const reserved = await request<{ loan: Loan }>("POST", "/api/loans", body);
    if (sessionEnded(reserved)) {
      setPhase(null);
      sessionGone();
      return { kind: "ended" };
    }
    if (reserved.status === 422) {
      setPhase(null);
      const labels: Record<string, [string, string]> = {
        member_id: ["Member", "new-loan-member"],
        item_ids: ["Add tool by tag", "new-loan-tag"],
        checked_out_at: ["Checked out at", "new-loan-checked-out"],
      };
      return {
        kind: "refused",
        problems: Object.entries(reserved.fields).map(([field, message]) => ({ field, message, label: labels[field]?.[0] ?? field, target: labels[field]?.[1] ?? field })),
      };
    }
    if (reserved.status !== 201) {
      setPhase(null);
      news.announce(reserved.error);
      return { kind: "refused" };
    }
    setPhase("checking-out");
    writes.current += 1;
    const loan = reserved.body.loan;
    const form = await photoForm({}, entries.photo!);
    const answer = await request<{ loan: Loan }>("POST", `/api/loans/${loan.id}/checkout`, form);
    setPhase(null);
    setNewLoan(null);
    if (sessionEnded(answer)) {
      sessionGone();
      return { kind: "ended" };
    }
    if (answer.status === 200) {
      const out = answer.body.loan;
      news.announce(`Loan ${out.ref} is out. Due ${out.due_date} by ${out.due_by}.`);
      focusAfter.current = "scan";
    } else {
      news.announce(answer.error);
      setLoans((current) => current && [...current, loan]);
      selectLoan(loan, false);
      setPhoto(entries.photo);
      focusAfter.current = "check-out";
    }
    void readBoard();
    return { kind: "out" };
  };

  const closeNewLoan = () => {
    const opener = newLoan?.opener;
    setNewLoan(null);
    focusAfter.current = opener === "scan" ? "scan" : { element: newLoanButton.current! };
  };

  // Tag cards: picked up by keyboard, or dragged and dropped by pointer or touch.
  const cardKeyDown = (part: Part, event: KeyboardEvent) => {
    const current = picked;
    if (!current || current.partId !== part.id) {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setTapPicked(null);
        setPicked({ partId: part.id, over: part.id });
      }
      return;
    }
    const index = allParts.findIndex((p) => p.id === current.over);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setPicked({ ...current, over: allParts[(index + 1) % allParts.length]!.id });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setPicked({ ...current, over: allParts[(index - 1 + allParts.length) % allParts.length]!.id });
    } else if (event.key === "Enter") {
      event.preventDefault();
      void hang(part, current.over, null);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setPicked(null);
    } else if (event.key === " ") event.preventDefault();
  };

  const nearOwn = (partId: number, x: number, y: number) => {
    const rect = outlines.current.get(partId)?.getBoundingClientRect();
    return !!rect && x >= rect.left - SNAP_PX && x <= rect.right + SNAP_PX && y >= rect.top - SNAP_PX && y <= rect.bottom + SNAP_PX;
  };

  const cardPointerDown = (part: Part, event: PointerEvent) => {
    if (event.button !== 0 || hangInFlight.current) return;
    const card = event.currentTarget as HTMLElement;
    card.setPointerCapture(event.pointerId);
    const rect = card.getBoundingClientRect();
    dragging.current = {
      partId: part.id,
      pointerId: event.pointerId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      tx: 0,
      ty: 0,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    };
  };

  const cardPointerMove = (event: PointerEvent) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const card = event.currentTarget as HTMLElement;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      card.classList.add("is-dragging");
      setPicked(null);
      setTapPicked(null);
    }
    const rect = card.getBoundingClientRect();
    drag.tx = event.clientX - drag.grabX - (rect.left - drag.tx);
    drag.ty = event.clientY - drag.grabY - (rect.top - drag.ty);
    card.style.transform = `translate(${drag.tx}px, ${drag.ty}px)`;
    const snap = nearOwn(drag.partId, event.clientX, event.clientY);
    setSnapPart(snap ? drag.partId : null);
  };

  const cardPointerUp = (part: Part, event: PointerEvent) => {
    const drag = dragging.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragging.current = null;
    const card = event.currentTarget as HTMLElement;
    if (!drag.moved) {
      setTapPicked((current) => (current === part.id ? null : part.id));
      return;
    }
    setSnapPart(null);
    const { clientX: x, clientY: y } = event;
    if (nearOwn(part.id, x, y)) {
      void hang(part, part.id, card);
      return;
    }
    for (const [id, el] of outlines.current) {
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        void hang(part, id, card);
        return;
      }
    }
    springBack(card);
  };

  const states = useCallback(
    (part: Part, item: Item) => ({
      selected: (selected ? selected.items.some((i) => i.id === item.id) : item.id === toolId) || part.id === takeDown,
      snap: part.id === snapPart,
      hover: part.id === picked?.over,
      animateHang: part.id === justHung,
    }),
    [selected, toolId, takeDown, snapPart, picked?.over, justHung],
  );

  const loan = selected;
  const visibleLoans = (loans ?? []).filter((l) => memberFilter === null || l.member_name.toLowerCase().includes(memberFilter));
  const cardsShown = loan && (loan.status === "out" || loan.status === "returned-partial") ? unhungParts(loan) : [];
  const typedReturnTime = readReturnTime(returnText, zone ?? "UTC");
  const tool = toolId !== null ? board?.items.find((i) => i.id === toolId) : undefined;
  const takeDownPartRecord = loan && takeDown !== null ? loan.parts.find((p) => p.id === takeDown && p.state === "hung") : undefined;
  const dialogOpen = newLoan !== null || confirmOpen;

  return (
    <div class="panes panes-desk">
      <PaneAnnouncements news={news} summary={summary} label="Desk announcements" problems={problems} showProblems={!dialogOpen} />
      <section class="pane pane-list" aria-label="Loan queue" ref={queueRef}>
        <div class="scan-row">
          <label class="field grow">
            <span class="field-label">
              <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <path d="M7 12h10" />
              </svg>
              Scan or find a loan
            </span>
            <input
              type="search"
              ref={scanBox}
              aria-label="Scan or find a loan"
              placeholder="Tag, loan ref or member"
              value={scanText}
              onInput={(e) => {
                typedScan.current = true;
                setScanText(e.currentTarget.value);
                if (memberFilter !== null) setMemberFilter(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.preventDefault();
                  scan();
                }
              }}
            />
          </label>
          <button type="button" class="btn btn-primary" ref={newLoanButton} onClick={() => setNewLoan({ tools: [], opener: "button" })}>
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            New loan
          </button>
        </div>
        {cardsShown.length > 0 && (
          <div class="tag-cards" aria-label={`Tag cards for ${loan!.ref}`} role="group">
            {cardsShown.map((part) => (
              <button
                type="button"
                key={part.id}
                ref={(el) => {
                  if (el) cards.current.set(part.id, el);
                  else cards.current.delete(part.id);
                }}
                class={`tag-card${picked?.partId === part.id || tapPicked === part.id ? " is-picked" : ""}`}
                onKeyDown={(e) => cardKeyDown(part, e)}
                onKeyUp={(e) => e.key === " " && e.preventDefault()}
                onPointerDown={(e) => cardPointerDown(part, e)}
                onPointerMove={cardPointerMove}
                onPointerUp={(e) => cardPointerUp(part, e)}
                onPointerCancel={(e) => {
                  dragging.current = null;
                  setSnapPart(null);
                  springBack(e.currentTarget);
                }}
              >
                <span class="tag-hole" aria-hidden="true" />
                Tag card {part.name}
              </button>
            ))}
          </div>
        )}
        <h2 class="pane-title">Open loans</h2>
        <ul aria-label="Open loans" class="loan-list" ref={listRef}>
          {loans === null || !fontsReady ? (
            <li class="loading-line">Loading loans…</li>
          ) : visibleLoans.length === 0 ? (
            <li class="empty-note">No open loans.</li>
          ) : (
            visibleLoans.map((l) => (
              <li key={l.id} class={l.id === loan?.id ? "is-selected" : ""}>
                <button
                  type="button"
                  class="loan-row"
                  onClick={() => selectLoan(l, true)}
                  onKeyDown={(e) => {
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    e.preventDefault();
                    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button.loan-row") ?? [])];
                    const at = buttons.indexOf(e.currentTarget);
                    buttons[(at + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                  }}
                >
                  <span class="loan-row-head">
                    <Num>{l.ref}</Num> <span>{l.member_name}</span>
                  </span>
                  <Status word={LOAN_WORD[l.status]!} />
                  {l.status === "out" && <DueLine loan={l} />}
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
      {/* Board and detail wait for the first read, so the loaded list does not push them down the page. */}
      {loans !== null && fontsReady && (
        <>
      <BoardView
        board={board}
        states={states}
        onActivate={onOutline}
        register={register}
        ghost={picked ? { partId: picked.over, label: loan?.parts.find((p) => p.id === picked.partId)?.name ?? "" } : null}
      />
      <section class="pane pane-detail" aria-label="Item detail" ref={detailRef}>
        {loan ? (
          <div class="loan-detail">
            <div class="title-row">
              <h2 class="detail-title">
                Loan <Num>{loan.ref}</Num>
              </h2>
              <Status word={LOAN_WORD[loan.status]!} />
            </div>
            <p class="meta">
              {loan.member_name} · {loan.items.map((i) => `${i.name} (${i.tag})`).join(", ")}
            </p>
            {(loan.status === "out" || loan.status === "pending-photo") && (
              <p class="due">
                <DueLine loan={loan} />
              </p>
            )}
            {loan.status === "reserved" && (
              <div class="control-stack">
                <PhotoPicker photo={photo} onPick={setPhoto} id="checkin-photo" />
                <button
                  type="button"
                  data-check-out
                  class={`btn btn-primary${pending === "checkout" ? " is-pending" : ""}`}
                  aria-busy={pending === "checkout" ? "true" : undefined}
                  aria-disabled={pending === "checkout" ? "true" : undefined}
                  onClick={async () => {
                    if (pending) return;
                    setPending("checkout");
                    await checkOutReserved(loan, photo);
                    setPending(null);
                  }}
                >
                  {pending === "checkout" ? "Checking out..." : `Check out ${loan.ref}`}
                </button>
                <ActionButton label={`Cancel loan ${loan.ref}`} pendingLabel="Cancelling..." pending={pending === "cancel"} onAct={() => void cancelReserved(loan)} />
              </div>
            )}
            {loan.status === "out" && (
              <div class="control-stack">
                {takeDownPartRecord && (
                  <ActionButton label={`Take down ${takeDownPartRecord.name}`} pending={pending === "takedown"} onAct={() => void takeDownPart(takeDownPartRecord)} />
                )}
                {loan.items.map((item) => (
                  <div role="radiogroup" aria-label={`Condition of ${item.name}`} class="grades" key={item.id}>
                    <span class="field-label" aria-hidden="true">
                      Condition of {item.name}
                    </span>
                    {GRADES.map((grade) => (
                      <label class="grade" key={grade}>
                        <input
                          type="radio"
                          id={`grade-${item.id}-${grade}`}
                          name={`grade-${item.id}`}
                          checked={grades[item.id] === grade}
                          onChange={() => setGrades((current) => ({ ...current, [item.id]: grade }))}
                        />
                        <span>{grade.charAt(0).toUpperCase() + grade.slice(1)}</span>
                      </label>
                    ))}
                  </div>
                ))}
                <PhotoPicker photo={photo} onPick={setPhoto} id="checkin-photo" />
                <label class="field">
                  <span class="field-label">Return time</span>
                  <input
                    id="return-time"
                    class="num"
                    placeholder="YYYY-MM-DD HH:MM"
                    value={returnText}
                    aria-label="Return time"
                    onInput={(e) => {
                      typedReturn.current = true;
                      setReturnText(e.currentTarget.value);
                      setReturnMessage("");
                      if (readReturnTime(e.currentTarget.value, zone ?? "UTC").kind !== "repeated") setSecondHour(false);
                    }}
                  />
                </label>
                {typedReturnTime.kind === "repeated" && (
                  <label class="check">
                    <input type="checkbox" checked={secondHour} onChange={(e) => setSecondHour(e.currentTarget.checked)} />
                    <span>
                      Second {typedReturnTime.hour} o'clock hour ({typedReturnTime.laterZone})
                    </span>
                  </label>
                )}
                <FieldMessage id="return-time" message={returnMessage} />
                <p class="note">Library time. Leave empty for now; type it for drop-box returns.</p>
                <ActionButton label="Confirm check-in" primary pending={false} onAct={openConfirm} />
              </div>
            )}
            {loan.status === "pending-photo" && (
              <div class="control-stack">
                <PhotoPicker photo={photo} onPick={setPhoto} id="checkin-photo" />
                <ActionButton
                  label="Finish check-in"
                  pendingLabel="Checking in..."
                  pending={pending === "finish"}
                  primary
                  disabled={shell.status.storage === "down"}
                  onAct={() => void finishCheckin()}
                />
              </div>
            )}
            {loan.status === "returned-partial" && (
              <p class="note">
                Missing: {loan.missing_parts.join(", ")}. Hang each part on its outline when it comes back.
              </p>
            )}
          </div>
        ) : tool ? (
          <ToolDetail item={tool} />
        ) : (
          <p class="empty-note">Scan a tag or a loan ref, or choose a tool on the board.</p>
        )}
      </section>
        </>
      )}
      {newLoan && (
        <NewLoanDialog
          items={board?.items ?? []}
          initialTools={newLoan.tools}
          coordinator={coordinator}
          zone={zone ?? "UTC"}
          onCheckOut={newLoanCheckOut}
          onClose={closeNewLoan}
        />
      )}
      {confirmOpen && loan && (
        <Dialog
          label="Confirm check-in"
          onEscape={() => {
            setConfirmOpen(false);
            if (confirmOpener.current) focusAfter.current = { element: confirmOpener.current };
          }}
        >
          <h2 class="dialog-title">Confirm check-in</h2>
          <dl class="facts">
            <div>
              <dt>Hung</dt>
              <dd>{loan.parts.filter((p) => p.state === "hung").map((p) => p.name).join(", ") || "None"}</dd>
            </div>
            <div>
              <dt>Will be missing</dt>
              <dd>{loan.parts.filter((p) => p.state !== "hung").map((p) => p.name).join(", ") || "None"}</dd>
            </div>
            {loan.items.map((item) => (
              <div key={item.id}>
                <dt>{item.name}</dt>
                <dd>{grades[item.id]}</dd>
              </div>
            ))}
          </dl>
          <div class="dialog-actions">
            <ActionButton label="Confirm" pendingLabel="Checking in..." pending={pending === "checkin"} primary onAct={() => void confirmCheckin()} />
            <button
              type="button"
              class="btn"
              onClick={() => {
                setConfirmOpen(false);
                if (confirmOpener.current) focusAfter.current = { element: confirmOpener.current };
              }}
            >
              Back
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
