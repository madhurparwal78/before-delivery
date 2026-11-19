import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BILLING_DOWN_CHECKIN,
  MALFORMED_RETURN_TIME,
  NO_QUEUE_LINE,
  SKIPPED_RETURN_TIME,
  STORAGE_DOWN_CHECKIN,
  STORAGE_DOWN_FINISH,
} from '../../shared/copy';
import { formatDollars } from '../../shared/format';
import { itemStatusWord, loanStatusWord, outlineStateWord, shapeClassFor } from '../../shared/status-words';
import type { Counts, Fee, Grade, Loan, MemberSummary, Part } from '../../shared/types';
import { Board, boardOrder, type BoardPart } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { FormProblems, problemsOf, type Problems } from '../components/FormProblems';
import { DueLine } from '../components/loan-lines';
import { NewLoanDialog } from '../components/NewLoanDialog';
import { PhotoPicker, type PickedPhoto } from '../components/PhotoPicker';
import { ReturnTimeFields } from '../components/ReturnTimeFields';
import { Announcements, SIGN_IN_AGAIN_ID } from '../components/Shell';
import { api, ApiFailed } from '../lib/api';
import { useApp } from '../lib/app-context';
import { paneCount, usePoll, useViewportWidth } from '../lib/hooks';
import { readReturnTime, returnTimeToIso } from '../lib/return-time';
import { insideOutline, withinSnapRadius } from '../lib/snap';

const OPEN_STATUSES = ['reserved', 'out', 'pending-photo', 'returned-partial'];

interface CheckinReply {
  loan: Loan;
  fee: Fee | null;
}

export function Desk(): JSX.Element {
  const app = useApp();
  const { board, viewer, status, announce, calendar, reducedMotion, restoredDraft, consumeDraft } =
    app;
  const isCoordinator = viewer?.user.role === 'coordinator';

  const [scanText, setScanText] = useState('');
  const [selectedLoanId, setSelectedLoanId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [grades, setGrades] = useState<Record<number, Grade>>({});
  const [picked, setPicked] = useState<PickedPhoto | null>(null);
  const [returnTime, setReturnTime] = useState('');
  const [secondHour, setSecondHour] = useState(false);
  const [problems, setProblems] = useState<Problems | null>(null);
  const [newLoanOpen, setNewLoanOpen] = useState(false);
  const [newLoanTag, setNewLoanTag] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [pickedPartId, setPickedPartId] = useState<number | null>(null);
  const [hoverPartId, setHoverPartId] = useState<number | null>(null);
  const [snapPartId, setSnapPartId] = useState<number | null>(null);
  const [settledPartIds, setSettledPartIds] = useState<ReadonlySet<number>>(new Set());
  const [dragPartId, setDragPartId] = useState<number | null>(null);

  const scanBox = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const newLoanOpener = useRef<HTMLButtonElement>(null);
  const scanOpenedDialog = useRef(false);
  const outlines = useRef(new Map<number, SVGGElement>());
  const cardRefs = useRef(new Map<number, HTMLButtonElement>());
  const checkoutButton = useRef<HTMLButtonElement>(null);
  const firstDetailControl = useRef<HTMLElement | null>(null);
  const returnTimeField = useRef<HTMLInputElement | null>(null);
  const announcedDueDates = useRef(new Map<number, string>());
  const inFlight = useRef(false);

  const width = useViewportWidth();
  const panes = paneCount(width);

  const loans = usePoll<{ loans: Loan[] }>('/api/loans', 10000);
  const members = usePoll<{ members: MemberSummary[] }>('/api/members', 10000);
  const openLoans = useMemo(
    () => (loans.data?.loans ?? []).filter((loan) => OPEN_STATUSES.includes(loan.status)),
    [loans.data],
  );
  const selectedLoan = openLoans.find((loan) => loan.id === selectedLoanId) ?? null;

  const loanRead = usePoll<{ loan: Loan }>(
    selectedLoanId === null ? null : `/api/loans/${selectedLoanId}`,
    2000,
    selectedLoan !== null,
  );
  const polled = loanRead.data?.loan;
  const liveLoan =
    polled && polled.id === selectedLoanId && OPEN_STATUSES.includes(polled.status)
      ? polled
      : selectedLoan;

  // A loan another desk returned completely leaves this desk's queue.
  useEffect(() => {
    if (polled && polled.id === selectedLoanId && polled.status === 'returned-complete') {
      setSelectedLoanId(null);
    }
  }, [polled, selectedLoanId]);

  // The board poll keeps every desk's outlines and numerals within three seconds.
  useEffect(() => {
    const timer = setInterval(() => void app.reloadBoard(), 2000);
    return () => clearInterval(timer);
  }, [app]);

  const pendingPhotoSelected = selectedLoan?.status === 'pending-photo';
  const { setStatusPollFast } = app;
  useEffect(() => {
    setStatusPollFast(pendingPhotoSelected);
    return () => setStatusPollFast(false);
  }, [pendingPhotoSelected, setStatusPollFast]);

  useEffect(() => {
    scanBox.current?.focus();
  }, []);

  useEffect(() => {
    if (!restoredDraft) return;
    if (restoredDraft.fields.scan !== undefined) setScanText(restoredDraft.fields.scan);
    if (restoredDraft.selectedItemId !== null) setSelectedItemId(restoredDraft.selectedItemId);
    if (restoredDraft.selectedLoanId !== null) {
      const stillOpen = openLoans.some((loan) => loan.id === restoredDraft.selectedLoanId);
      if (stillOpen) {
        setSelectedLoanId(restoredDraft.selectedLoanId);
        const reselected = openLoans.find((loan) => loan.id === restoredDraft.selectedLoanId);
        if (reselected?.status === 'out' && restoredDraft.fields.returnTime !== undefined) {
          setReturnTime(restoredDraft.fields.returnTime);
        }
      }
    }
    consumeDraft();
  }, [restoredDraft, consumeDraft, openLoans]);

  // A due date that moved elsewhere is announced once on the desk holding it.
  useEffect(() => {
    if (!liveLoan || liveLoan.due_date === null) return;
    const seen = announcedDueDates.current.get(liveLoan.id);
    if (seen === undefined) {
      announcedDueDates.current.set(liveLoan.id, liveLoan.due_date);
      return;
    }
    if (seen !== liveLoan.due_date) {
      announcedDueDates.current.set(liveLoan.id, liveLoan.due_date);
      if (liveLoan.id === selectedLoanId) announce(`Due date moved to ${liveLoan.due_date}.`);
    }
  }, [liveLoan, selectedLoanId, announce]);

  const items = board?.items ?? [];
  const ordered = useMemo(() => boardOrder(items), [items]);
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;

  const unhungParts = (liveLoan?.parts ?? []).filter((part) => part.state !== 'hung');
  const hungDuringCheckin = (liveLoan?.parts ?? []).filter((part) => part.state === 'hung');

  function noteSessionEnded(text: string): void {
    setConfirmOpen(false);
    setNewLoanOpen(false);
    app.noteSessionEnded(text, {
      fields: { scan: scanText, returnTime },
      hourRows: {},
      waiverReason: null,
      selectedLoanId,
      selectedItemId,
    });
    window.setTimeout(() => document.getElementById(SIGN_IN_AGAIN_ID)?.focus(), 0);
  }

  function focusAfterSelect(loan: Loan): void {
    window.setTimeout(() => {
      if (loan.status === 'out' || loan.status === 'returned-partial') {
        const firstUnhung = loan.parts
          .filter((part) => part.state !== 'hung')
          .sort((left, right) => left.row - right.row || left.col - right.col)[0];
        if (firstUnhung) {
          cardRefs.current.get(firstUnhung.id)?.focus();
          return;
        }
        document.querySelector<HTMLElement>('.condition-group input')?.focus();
        return;
      }
      firstDetailControl.current?.focus();
    }, 0);
  }

  function selectLoan(loan: Loan, moveFocus = true): void {
    setSelectedLoanId(loan.id);
    setSelectedItemId(loan.items[0]?.id ?? null);
    setPickedPartId(null);
    if (moveFocus) focusAfterSelect(loan);
  }

  function runScan(): void {
    const typed = scanText.trim();
    if (typed === '') return;
    const byRef = openLoans.find((loan) => loan.ref.toLowerCase() === typed.toLowerCase());
    if (byRef) {
      selectLoan(byRef);
      return;
    }
    const tagged = items.find((item) => item.tag.toLowerCase() === typed.toLowerCase());
    if (tagged) {
      const onLoan = openLoans.find((loan) =>
        loan.items.some((item) => item.id === tagged.id),
      );
      if (onLoan) {
        selectLoan(onLoan);
        return;
      }
      scanOpenedDialog.current = true;
      setNewLoanTag(tagged.tag);
      setNewLoanOpen(true);
      return;
    }
    setSelectedItemId(null);
  }

  const registerOutline = useCallback((partId: number, element: SVGGElement | null) => {
    if (element) outlines.current.set(partId, element);
    else outlines.current.delete(partId);
  }, []);

  function applyServerState(loan: Loan): void {
    loanRead.replace({ loan });
    void loans.reload();
    void app.reloadBoard();
  }

  async function hang(part: Part, pegPartId: number): Promise<void> {
    if (!liveLoan) return;
    try {
      const result = await api.post<{ loan: Loan; counts: Counts }>(
        `/api/loans/${liveLoan.id}/hang`,
        { part_id: part.id, peg_part_id: pegPartId },
      );
      setSettledPartIds(new Set([part.id]));
      window.setTimeout(() => setSettledPartIds(new Set()), 500);
      const complete = result.loan.status === 'returned-complete';
      announce(`${part.name} is on its peg.${complete ? ' Returned complete.' : ''}`);
      applyServerState(result.loan);
      moveFocusAfterHang(result.loan);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        noteSessionEnded(error.error);
        return;
      }
      announce(error.error);
      await loanRead.reload();
      await loans.reload();
      await app.reloadBoard();
    } finally {
      setPickedPartId(null);
      setHoverPartId(null);
      setSnapPartId(null);
      setDragPartId(null);
    }
  }

  function moveFocusAfterHang(loan: Loan): void {
    window.setTimeout(() => {
      const nextUnhung = loan.parts
        .filter((part) => part.state !== 'hung')
        .sort((left, right) => left.row - right.row || left.col - right.col)[0];
      if (nextUnhung) {
        cardRefs.current.get(nextUnhung.id)?.focus();
        return;
      }
      if (loan.status === 'out') {
        document.querySelector<HTMLElement>('.condition-group input')?.focus();
        return;
      }
      scanBox.current?.focus();
    }, 0);
  }

  async function takeDown(part: Part): Promise<void> {
    if (!liveLoan) return;
    try {
      const result = await api.remove<{ loan: Loan; counts: Counts }>(
        `/api/loans/${liveLoan.id}/hang/${part.id}`,
      );
      announce(`${part.name} is off its peg.`);
      setSelectedPartId(null);
      applyServerState(result.loan);
    } catch (error) {
      if (error instanceof ApiFailed) announce(error.error);
    }
  }

  function returnTimeProblem(): { field: string; message: string } | null {
    if (!calendar) return null;
    const reading = readReturnTime(returnTime, calendar.time_zone);
    if (reading.kind === 'malformed') {
      return { field: 'returned_at', message: MALFORMED_RETURN_TIME };
    }
    if (reading.kind === 'skipped') {
      return { field: 'returned_at', message: SKIPPED_RETURN_TIME };
    }
    return null;
  }

  function openConfirm(): void {
    if (!liveLoan || liveLoan.status !== 'out') return;
    const missing: { field: string; message: string }[] = [];
    for (const item of liveLoan.items) {
      if (!grades[item.id]) {
        missing.push({ field: `grade-${item.id}`, message: `Grade ${item.name}.` });
      }
    }
    if (picked === null) missing.push({ field: 'photo', message: 'Take or choose a photo.' });
    const timeProblem = returnTimeProblem();
    if (timeProblem) missing.push(timeProblem);
    if (missing.length > 0) {
      setProblems(problemsOf(missing));
      window.setTimeout(() => summary.current?.focus(), 0);
      return;
    }
    setProblems(null);
    setConfirmOpen(true);
  }

  function reportCheckinOutcome(reply: CheckinReply): void {
    const missing = reply.loan.missing_parts;
    const base =
      reply.loan.status === 'returned-complete'
        ? 'Returned complete.'
        : `Returned — partial. Missing: ${missing.join(', ')}.`;
    const fee = reply.fee ? ` Fee raised: $${formatDollars(reply.fee.total_cents)}.` : '';
    announce(`${base}${fee}`);
  }

  async function confirmCheckin(): Promise<void> {
    if (!liveLoan || inFlight.current || !picked || !calendar) return;
    inFlight.current = true;
    setPendingLabel('Checking in...');
    try {
      const form = new FormData();
      form.append('grades', JSON.stringify(grades));
      form.append('photo', picked.file);
      form.append('captured_at', picked.capturedAt);
      const iso = returnTimeToIso(returnTime, calendar.time_zone, secondHour);
      if (iso !== null) form.append('returned_at', iso);
      const response = await fetch(`/api/loans/${liveLoan.id}/checkin`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      const reply = (await response.json()) as CheckinReply & { error?: string };
      if (response.status === 202) {
        announce(STORAGE_DOWN_CHECKIN);
        setConfirmOpen(false);
        loanRead.replace({ loan: reply.loan });
        await loans.reload();
        await app.reloadBoard();
        window.setTimeout(() => scanBox.current?.focus(), 0);
        return;
      }
      if (!response.ok) {
        throw new ApiFailed(response.status, reply.error ?? 'Something went wrong.', null);
      }
      setConfirmOpen(false);
      reportCheckinOutcome(reply);
      setGrades({});
      setPicked(null);
      setReturnTime('');
      setSecondHour(false);
      setSelectedLoanId(null);
      await loans.reload();
      await app.reloadBoard();
      window.setTimeout(() => scanBox.current?.focus(), 0);
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        noteSessionEnded(error.error);
        return;
      }
      setConfirmOpen(false);
      announce(error.status === 503 ? BILLING_DOWN_CHECKIN : error.error);
      await loanRead.reload();
      await loans.reload();
      await app.reloadBoard();
      window.setTimeout(() => firstDetailControl.current?.focus(), 0);
    } finally {
      inFlight.current = false;
      setPendingLabel(null);
    }
  }

  async function finishCheckin(): Promise<void> {
    if (!selectedLoan || inFlight.current || !picked) return;
    inFlight.current = true;
    setPendingLabel('Checking in...');
    try {
      const form = new FormData();
      form.append('photo', picked.file);
      form.append('captured_at', picked.capturedAt);
      const reply = await api.post<CheckinReply>(`/api/loans/${selectedLoan.id}/finish`, form);
      reportCheckinOutcome(reply);
      setPicked(null);
      setSelectedLoanId(null);
      await loans.reload();
      await app.reloadBoard();
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        noteSessionEnded(error.error);
        return;
      }
      announce(
        error.status === 503
          ? status.storage === 'down'
            ? STORAGE_DOWN_FINISH
            : BILLING_DOWN_CHECKIN
          : error.error,
      );
      await loans.reload();
      await app.reloadBoard();
    } finally {
      inFlight.current = false;
      setPendingLabel(null);
    }
  }

  async function checkOutReserved(): Promise<void> {
    if (!selectedLoan || !picked || inFlight.current) return;
    inFlight.current = true;
    setPendingLabel('Checking out...');
    try {
      const form = new FormData();
      form.append('photo', picked.file);
      form.append('captured_at', picked.capturedAt);
      const result = await api.post<{ loan: Loan }>(
        `/api/loans/${selectedLoan.id}/checkout`,
        form,
      );
      announce(`Loan ${result.loan.ref} is out. Due ${result.loan.due_date} by ${result.loan.due_by}.`);
      setPicked(null);
      await loans.reload();
      await app.reloadBoard();
    } catch (error) {
      if (!(error instanceof ApiFailed)) return;
      if (error.status === 401 && error.error.includes('session')) {
        noteSessionEnded(error.error);
        return;
      }
      announce(error.status === 503 ? 'Photo storage is down. The loan stays reserved; check it out when storage is back.' : error.error);
    } finally {
      inFlight.current = false;
      setPendingLabel(null);
    }
  }

  async function cancelReserved(): Promise<void> {
    if (!selectedLoan) return;
    try {
      await api.remove(`/api/loans/${selectedLoan.id}`);
      announce(`Loan ${selectedLoan.ref} cancelled.`);
      setSelectedLoanId(null);
      await loans.reload();
      await app.reloadBoard();
    } catch (error) {
      if (error instanceof ApiFailed) announce(error.error);
    }
  }

  // Ctrl+Enter opens the confirm dialog, and `/` reaches the scan field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        openConfirm();
        return;
      }
      if (event.key === '/' && !typing && !confirmOpen && !newLoanOpen) {
        event.preventDefault();
        scanBox.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  function cardKeyDown(event: React.KeyboardEvent, part: Part): void {
    if (event.key === ' ' || event.key === 'Enter') {
      if (pickedPartId === part.id && event.key === 'Enter' && hoverPartId !== null) {
        event.preventDefault();
        void hang(part, hoverPartId);
        return;
      }
      event.preventDefault();
      setPickedPartId(part.id);
      setHoverPartId(part.id);
      return;
    }
    if (pickedPartId !== part.id) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setPickedPartId(null);
      setHoverPartId(null);
      return;
    }
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward) return;
    event.preventDefault();
    const index = ordered.findIndex((entry) => entry.part.id === hoverPartId);
    const step = forward ? 1 : -1;
    const next = (index + step + ordered.length) % ordered.length;
    setHoverPartId(ordered[next]?.part.id ?? null);
  }

  function pointerUpOnBoard(event: React.PointerEvent): void {
    if (dragPartId === null) return;
    const part = (liveLoan?.parts ?? []).find((candidate) => candidate.id === dragPartId);
    setDragPartId(null);
    setSnapPartId(null);
    setPickedPartId(null);
    if (!part) return;
    const own = outlines.current.get(part.id);
    if (own && withinSnapRadius(own, event.clientX, event.clientY)) {
      void hang(part, part.id);
      return;
    }
    for (const entry of ordered) {
      const element = outlines.current.get(entry.part.id);
      if (element && insideOutline(element, event.clientX, event.clientY)) {
        void hang(part, entry.part.id);
        return;
      }
    }
  }

  function pointerMoveOnBoard(event: React.PointerEvent): void {
    if (dragPartId === null) return;
    const own = outlines.current.get(dragPartId);
    setSnapPartId(own && withinSnapRadius(own, event.clientX, event.clientY) ? dragPartId : null);
  }

  const scanField = (
    <label className="scan-label">
      Scan or find a loan
      <input
        type="search"
        aria-label="Scan or find a loan"
        ref={scanBox}
        value={scanText}
        onChange={(event) => setScanText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            runScan();
          }
        }}
      />
    </label>
  );

  const nameFilter = scanText.trim().toLowerCase();
  const queueLoans =
    nameFilter === ''
      ? openLoans
      : openLoans.filter((loan) => loan.member_name.toLowerCase().includes(nameFilter));

  const loanQueue = (
    <section className="pane pane-list" aria-label="Loan queue">
      {scanField}
      <h2>Loan queue</h2>
      <button type="button" ref={newLoanOpener} onClick={() => {
        scanOpenedDialog.current = false;
        setNewLoanTag(null);
        setNewLoanOpen(true);
      }}>
        New loan
      </button>
      <ul aria-label="Open loans" className="open-loans">
        {queueLoans.map((loan) => (
          <li key={loan.id} className={loan.id === selectedLoanId ? 'row-selected' : ''}>
            <button
              type="button"
              className="row-link"
              onClick={() => selectLoan(loan)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  selectLoan(loan);
                }
              }}
            >
              <span className="numerals">{loan.ref}</span> {loan.member_name}{' '}
              <span className={shapeClassFor(loanStatusWord(loan.status))}>
                {loanStatusWord(loan.status)}
              </span>{' '}
              {loan.status === 'out' ? <DueLine loan={loan} /> : null}
            </button>
          </li>
        ))}
      </ul>
      {liveLoan && (liveLoan.status === 'out' || liveLoan.status === 'returned-partial') ? (
        <div className="tag-cards">
          <h3>Tag cards</h3>
          {unhungParts
            .slice()
            .sort((left, right) => left.row - right.row || left.col - right.col)
            .map((part) => (
              <button
                key={part.id}
                type="button"
                ref={(element) => {
                  if (element) cardRefs.current.set(part.id, element);
                  else cardRefs.current.delete(part.id);
                }}
                className={`tag-card ${pickedPartId === part.id ? 'tag-card-picked' : ''}`}
                onKeyDown={(event) => cardKeyDown(event, part)}
                onPointerDown={() => {
                  setDragPartId(part.id);
                  setPickedPartId(part.id);
                }}
              >
                Tag card {part.name}
              </button>
            ))}
        </div>
      ) : null}
    </section>
  );

  const boardPane = (
    <section
      className="pane pane-board"
      aria-label="Pegboard"
      onPointerMove={pointerMoveOnBoard}
      onPointerUp={pointerUpOnBoard}
    >
      <h2>Pegboard</h2>
      <Board
        items={items}
        rows={board?.rows ?? 0}
        selectedItemId={selectedItemId}
        pickedPartId={pickedPartId}
        hoverPartId={hoverPartId}
        snapPartId={snapPartId}
        settledPartIds={settledPartIds}
        reducedMotion={reducedMotion}
        onActivate={(entry: BoardPart) => {
          if (pickedPartId !== null) {
            const part = (liveLoan?.parts ?? []).find(
              (candidate) => candidate.id === pickedPartId,
            );
            if (part) {
              void hang(part, entry.part.id);
              return;
            }
          }
          const onLoan = openLoans.find((loan) =>
            loan.items.some((item) => item.id === entry.item.id),
          );
          setSelectedItemId(entry.item.id);
          setSelectedPartId(entry.part.id);
          if (!onLoan) setSelectedLoanId(null);
        }}
        registerOutline={registerOutline}
      />
    </section>
  );

  const takeDownPart = hungDuringCheckin.find((part) => part.id === selectedPartId) ?? null;

  const detailPane = (
    <section className="pane pane-detail" aria-label="Item detail">
      <h2>Item detail</h2>
      {selectedItem ? (
        <>
          <p className="detail-name">{selectedItem.name}</p>
          <p className="numerals">{selectedItem.tag}</p>
          <p>
            <span className={shapeClassFor(itemStatusWord(selectedItem.status))}>
              {itemStatusWord(selectedItem.status)}
            </span>
          </p>
          <p className="numerals">
            Replacement cost ${formatDollars(selectedItem.replacement_cost_cents)}
          </p>
          <ul className="part-states">
            {selectedItem.parts.map((part) => (
              <li key={part.id}>
                {part.name} — {outlineStateWord(part.state, selectedItem.status)}
              </li>
            ))}
          </ul>
          <p className="queue-line">
            {selectedItem.hold_queue_length > 0 ? (
              <span className="numerals">Queued holds {selectedItem.hold_queue_length}</span>
            ) : (
              NO_QUEUE_LINE
            )}
          </p>
        </>
      ) : null}

      {liveLoan ? (
        <div className="selected-loan">
          <h3 className="numerals">{liveLoan.ref}</h3>
          {liveLoan.status === 'out' || liveLoan.status === 'pending-photo' ? (
            <p>
              <DueLine loan={liveLoan} />
            </p>
          ) : null}

          {liveLoan.status === 'reserved' ? (
            <>
              <PhotoPicker
                inputId="reserved-photo"
                picked={picked}
                onPick={setPicked}
                ref={(element) => {
                  firstDetailControl.current = element;
                }}
              />
              <button
                type="button"
                ref={checkoutButton}
                aria-busy={pendingLabel !== null}
                aria-disabled={pendingLabel !== null}
                onClick={() => void checkOutReserved()}
              >
                {pendingLabel ?? `Check out ${liveLoan.ref}`}
              </button>
              <button type="button" onClick={() => void cancelReserved()}>
                Cancel loan {liveLoan.ref}
              </button>
            </>
          ) : null}

          {liveLoan.status === 'pending-photo' ? (
            <>
              <PhotoPicker
                inputId="pending-photo"
                picked={picked}
                onPick={setPicked}
                ref={(element) => {
                  firstDetailControl.current = element;
                }}
              />
              <button
                type="button"
                disabled={status.storage === 'down'}
                aria-busy={pendingLabel !== null}
                onClick={() => void finishCheckin()}
              >
                {pendingLabel ?? 'Finish check-in'}
              </button>
            </>
          ) : null}

          {liveLoan.status === 'out' ? (
            <>
              {takeDownPart ? (
                <button type="button" onClick={() => void takeDown(takeDownPart)}>
                  Take down {takeDownPart.name}
                </button>
              ) : null}
              {liveLoan.items.map((item) => (
                <fieldset
                  key={item.id}
                  className="condition-group"
                  role="radiogroup"
                  aria-label={`Condition of ${item.name}`}
                >
                  <legend>Condition of {item.name}</legend>
                  {(['good', 'worn', 'damaged'] as Grade[]).map((grade) => (
                    <label key={grade}>
                      <input
                        type="radio"
                        name={`grade-${item.id}`}
                        aria-label={grade.charAt(0).toUpperCase() + grade.slice(1)}
                        checked={grades[item.id] === grade}
                        onChange={() => setGrades({ ...grades, [item.id]: grade })}
                      />
                      {grade.charAt(0).toUpperCase() + grade.slice(1)}
                    </label>
                  ))}
                </fieldset>
              ))}
              <PhotoPicker
                inputId="checkin-photo"
                picked={picked}
                onPick={setPicked}
                ref={(element) => {
                  firstDetailControl.current = element;
                }}
              />
              <ReturnTimeFields
                zone={calendar?.time_zone ?? 'UTC'}
                text={returnTime}
                secondHour={secondHour}
                onText={setReturnTime}
                onSecondHour={setSecondHour}
                fieldRef={(element) => {
                  returnTimeField.current = element;
                }}
              />
              <button type="button" onClick={openConfirm}>
                Confirm check-in
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  return (
    <>
      <Announcements kind="desk" />
      {newLoanOpen || confirmOpen ? null : (
        <FormProblems problems={problems} ref={summary} onJump={(field) => {
          if (field === 'returned_at') returnTimeField.current?.focus();
          else document.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
        }} />
      )}
      <div className={`panes panes-${panes} panes-desk`}>
        {loanQueue}
        {boardPane}
        {detailPane}
      </div>

      {newLoanOpen ? (
        <NewLoanDialog
          members={members.data?.members ?? []}
          items={items}
          isCoordinator={isCoordinator}
          startingTag={newLoanTag}
          announce={announce}
          onSessionEnded={noteSessionEnded}
          onClose={() => {
            setNewLoanOpen(false);
            window.setTimeout(() => {
              if (scanOpenedDialog.current) scanBox.current?.focus();
              else newLoanOpener.current?.focus();
            }, 0);
          }}
          onCheckedOut={(loan) => {
            setNewLoanOpen(false);
            announce(`Loan ${loan.ref} is out. Due ${loan.due_date} by ${loan.due_by}.`);
            void loans.reload();
            void app.reloadBoard();
            window.setTimeout(() => scanBox.current?.focus(), 0);
          }}
          onReservedOnly={(loan, keptPhoto) => {
            setNewLoanOpen(false);
            setPicked(keptPhoto);
            void loans.reload().then(() => {
              setSelectedLoanId(loan.id);
              setSelectedItemId(loan.items[0]?.id ?? null);
              window.setTimeout(() => checkoutButton.current?.focus(), 0);
            });
          }}
        />
      ) : null}

      {confirmOpen && liveLoan ? (
        <Dialog
          label="Confirm check-in"
          onEscape={() => setConfirmOpen(false)}
        >
          <h2>Confirm check-in</h2>
          <p>Hung: {hungDuringCheckin.map((part) => part.name).join(', ') || 'none'}</p>
          <p>Will be missing: {unhungParts.map((part) => part.name).join(', ') || 'none'}</p>
          <p>
            Grades:{' '}
            {liveLoan.items.map((item) => `${item.name} ${grades[item.id] ?? ''}`).join(', ')}
          </p>
          <button
            type="button"
            aria-busy={pendingLabel !== null}
            aria-disabled={pendingLabel !== null}
            onClick={() => void confirmCheckin()}
          >
            {pendingLabel ?? 'Confirm'}
          </button>
          <button type="button" onClick={() => setConfirmOpen(false)}>
            Back
          </button>
        </Dialog>
      ) : null}
    </>
  );
}
