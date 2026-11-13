import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { COPY, countsLine, heldWorkLine, openRows } from "../../shared/copy";
import type { ApiError, Catalogue, Draft, EditorState, NoticeDetail, NoticeVersion, Session, Sheet, SheetRow } from "../../shared/types";
import { Alerts } from "../lib/Alerts";
import { useDesktop, useEvery } from "../lib/hooks";
import { useSignedLinks } from "../lib/links";
import { ApiFailure, LostRequest, call, get, messageOf, post } from "../lib/net";
import { takeHeld, type Held, type HeldCorrection } from "../lib/session";
import { Slide } from "../lib/Slide";
import { useAccountWatch } from "../lib/useAccount";
import { SignOut } from "./Stockist";
import { CorrectDialog, type CorrectionApi } from "./editor/Correct";
import { DraftGroup, type DraftApi } from "./editor/Draft";
import { BatchForm, RenameForms } from "./editor/Catalogue";
import { Desk, isOpen, nextOpenAfter, type RowKey } from "./editor/Desk";
import { PublishedNotices } from "./editor/Published";
import { Sheets } from "./editor/Sheets";

const sheetSig = (s: Sheet) => JSON.stringify(s.counts);

export function Editor({ session }: { session: Session }) {
  const desktop = useDesktop();
  const held = useRef(takeHeld(session.accountId));
  const [state, setState] = useState<EditorState | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [settled, setSettled] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [publishStatus, setPublishStatus] = useState(held.current ? COPY.workKept : "");
  const [printLines, setPrintLines] = useState<string[]>([]);
  const [workStatus, setWorkStatus] = useState("");
  const [focusDraft, setFocusDraft] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<{ number: string; held: HeldCorrection | null } | null>(
    held.current?.correction ? { number: held.current.correction.number, held: held.current.correction } : null,
  );
  const [lastRefusal, setLastRefusal] = useState<ApiError | null>(null);
  const printStatus = useRef<HTMLDivElement | null>(null);
  const page = useRef<HTMLElement>(null);
  const drafts = useRef(new Map<string, DraftApi>());
  const correction = useRef<CorrectionApi | null>(null);
  const seenPrint = useRef<Map<string, NoticeVersion["printState"]> | null>(null);
  const seenHeld = useRef<number | null>(null);
  const seq = useRef(0);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;
  const wantFocus = useRef<string | null>(null);
  const lastRow = useRef<RowKey | null>(null);
  const tracked = useRef<string | null>(null);

  useAccountWatch(session.accountId, (): Held | null => {
    const typed: Held = { accountId: session.accountId, drafts: {}, correction: correction.current?.capture() ?? null, endpoint: null };
    for (const [id, api] of drafts.current) {
      const value = api.capture();
      if (value) typed.drafts[id] = value;
    }
    return typed.correction || Object.keys(typed.drafts).length ? typed : null;
  });

  // ---- print and held-work announcements ----------------------------------------------------------------------------
  const notePrint = useCallback((notices: NoticeDetail[]) => {
    const first = seenPrint.current === null;
    const seen = seenPrint.current ?? new Map<string, NoticeVersion["printState"]>();
    const said: string[] = [];
    for (const n of notices) {
      for (const v of n.versions) {
        const key = `${n.number}#${v.version}`;
        const before = seen.get(key);
        if (!first && before !== v.printState && v.printState !== "pending") said.push(`Notice ${n.number} version ${v.version} is now ${v.printState === "printable" ? "Printable" : "Print failed"}.`);
        seen.set(key, v.printState);
      }
    }
    seenPrint.current = seen;
    if (said.length) setPrintLines(said);
  }, []);

  // ---- the 5-second refresh -----------------------------------------------------------------------------------------
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const [next, list, cat] = await Promise.all([get<EditorState>("/api/editor/notices"), get<{ sheets: Sheet[] }>("/api/editor/price-sheets"), get<Catalogue>("/api/catalogue")]);
    const known = new Map((sheetsRef.current ?? []).map((s) => [s.id, s]));
    const merged = await Promise.all(
      list.sheets.map(async (s) => {
        const have = known.get(s.id);
        if (have?.rows && sheetSig(have) === sheetSig(s)) return have;
        return (await get<{ sheet: Sheet }>(`/api/editor/price-sheets/${s.id}`)).sheet;
      }),
    );
    if (mine !== seq.current) return;
    setSettled(true);
    notePrint(next.notices);
    if (seenHeld.current !== null && next.heldWork > seenHeld.current) setWorkStatus(COPY.workSetAside);
    seenHeld.current = next.heldWork;
    setState((old) => (old && JSON.stringify(old) === JSON.stringify(next) ? old : next));
    setCatalogue((old) => (old && JSON.stringify(old) === JSON.stringify(cat) ? old : cat));
    setSheets(merged.sort((a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0)));
  }, [notePrint]);

  const refresh = useCallback(() => void load().catch(() => setSettled(true)), [load]);
  useEffect(refresh, [refresh]);
  useEvery(5000, refresh);

  // ---- focus: published moves, a rebuilt control, and the layers that must never cover it ----------------------------
  useLayoutEffect(() => {
    const target = wantFocus.current;
    if (target) {
      const el = document.querySelector<HTMLElement>(`[data-keep="${CSS.escape(target)}"]`);
      if (el) {
        wantFocus.current = null;
        el.focus();
      }
      return;
    }
    const active = document.activeElement;
    if (tracked.current && (!active || active === document.body)) {
      const back = document.querySelector<HTMLElement>(`[data-keep="${CSS.escape(tracked.current)}"]`);
      (back ?? printStatus.current)?.focus({ preventScroll: !back });
    }
  });

  const openCount = (sheets ?? []).reduce((sum, s) => sum + s.counts.ambiguous + s.counts.unmatched, 0);
  const showBar = !desktop && openCount > 0;
  const showBarRef = useRef(showBar);
  showBarRef.current = showBar;

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      tracked.current = el.closest?.("[data-keep]")?.getAttribute("data-keep") ?? null;
      const row = el.closest?.<HTMLElement>("[data-row]")?.dataset["row"];
      if (row) lastRow.current = row as RowKey;
      if (!showBarRef.current || el.closest(".modal-layer") || el.closest("[data-desk-bar]")) return;
      requestAnimationFrame(() => {
        const bar = document.querySelector("[data-desk-bar]")?.getBoundingClientRect();
        if (!bar) return;
        const box = el.getBoundingClientRect();
        const top = document.querySelector(".alerts")?.getBoundingClientRect().bottom ?? 0;
        if (box.bottom > bar.top - 8) window.scrollBy(0, box.bottom - bar.top + 16);
        else if (box.top < top + 8) window.scrollBy(0, box.top - top - 16);
      });
    };
    const onBlur = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      setTimeout(() => {
        if (el.isConnected && document.activeElement !== el && document.activeElement === document.body) tracked.current = null;
      }, 0);
    };
    const root = page.current!;
    root.addEventListener("focusin", onFocus);
    root.addEventListener("focusout", onBlur);
    return () => {
      root.removeEventListener("focusin", onFocus);
      root.removeEventListener("focusout", onBlur);
    };
  }, []);

  // ---- sheets -------------------------------------------------------------------------------------------------------
  const placeSheet = (sheet: Sheet) => setSheets((old) => {
    const rest = (old ?? []).filter((s) => s.id !== sheet.id);
    return [...rest, sheet].sort((a, b) => (a.importedAt < b.importedAt ? -1 : a.importedAt > b.importedAt ? 1 : 0));
  });

  const importFile = async (file: File | null) => {
    setImportStatus("Reading the sheet.");
    const form = new FormData();
    if (file) form.append("file", file, file.name);
    try {
      const { sheet } = await call<{ sheet: Sheet }>("POST", "/api/editor/price-sheets", undefined, { form });
      seq.current++;
      placeSheet(sheet);
      setImportStatus(sheet.reused ? COPY.sheetKnown : `${sheet.rowCount} rows read: ${sheet.counts.matched} matched, ${sheet.counts.ambiguous} ambiguous, ${sheet.counts.unmatched} unmatched.`);
      refresh();
    } catch (error) {
      setImportStatus(messageOf(error, COPY.unavailable));
    }
  };

  const busyRows = useRef(new Set<string>());
  const settle = async (sheet: Sheet, row: SheetRow, body: { skuCode: string } | { ignore: true }) => {
    const key = `${sheet.id}/${row.rowNumber}`;
    if (busyRows.current.has(key)) return;
    busyRows.current.add(key);
    setImportStatus(`Saving row ${row.rowNumber}.`);
    try {
      const answer = await post<{ sheet: Sheet }>(`/api/editor/price-sheets/${sheet.id}/rows/${row.rowNumber}/settle`, body);
      seq.current++;
      placeSheet(answer.sheet);
      setImportStatus(`Row ${row.rowNumber} settled.`);
      const rows = answer.sheet.rows ?? [];
      const open = rows.filter(isOpen);
      const next = open.find((r) => r.rowNumber > row.rowNumber) ?? open[0];
      wantFocus.current = next ? `combo-${sheet.id}-${next.rowNumber}` : `draft-from-${sheet.id}`;
      refresh();
    } catch (error) {
      setImportStatus(messageOf(error, COPY.unavailable));
    } finally {
      busyRows.current.delete(key);
    }
  };

  const nextRow = () => {
    const target = nextOpenAfter(sheets ?? [], lastRow.current);
    if (target) document.querySelector<HTMLElement>(`[data-keep="combo-${CSS.escape(target)}"]`)?.focus();
  };

  // ---- drafts and notices -------------------------------------------------------------------------------------------
  const onDraftMade = (draft: Draft) => {
    seq.current++;
    setFocusDraft(draft.id);
    setState((old) => (old ? { ...old, drafts: [draft, ...old.drafts] } : old));
    refresh();
  };

  const onPublished = (draftId: string, number: string, version: NoticeVersion) => {
    seq.current++;
    wantFocus.current = `correct-${number}`;
    seenPrint.current?.set(`${number}#${version.version}`, version.printState);
    setState((old) =>
      old
        ? {
            ...old,
            drafts: old.drafts.filter((d) => d.id !== draftId),
            notices: [{ number, state: version.state === "scheduled" ? "scheduled" : "in_effect", versions: [version] }, ...old.notices],
          }
        : old,
    );
    refresh();
  };

  const onCorrected = (number: string, version: NoticeVersion) => {
    seq.current++;
    wantFocus.current = `correct-${number}`;
    seenPrint.current?.set(`${number}#${version.version}`, version.printState);
    setCorrecting(null);
    refresh();
  };

  // ---- retry print --------------------------------------------------------------------------------------------------
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const retryingRef = useRef(new Set<string>());
  const retry = async (number: string, version: number) => {
    const key = `${number}#${version}`;
    if (retryingRef.current.has(key)) return;
    retryingRef.current.add(key);
    setRetrying(new Set(retryingRef.current));
    setPrintLines(["Asking for a new print."]);
    try {
      await post(`/api/editor/notices/${number}/versions/${version}/print`);
      seq.current++;
      seenPrint.current?.set(key, "pending");
      setState((old) =>
        old
          ? { ...old, notices: old.notices.map((n) => (n.number !== number ? n : { ...n, versions: n.versions.map((v) => (v.version === version ? { ...v, printState: "pending" as const } : v)) })) }
          : old,
      );
      setPrintLines(["Print requested. Check the print state shortly."]);
      printStatus.current?.focus({ preventScroll: true });
      refresh();
    } catch (error) {
      if (error instanceof LostRequest) setPrintLines([COPY.lostPrint]);
      else {
        setPrintLines([messageOf(error, COPY.lostPrint)]);
        if (error instanceof ApiFailure) printStatus.current?.focus({ preventScroll: true });
        refresh();
      }
    } finally {
      retryingRef.current.delete(key);
      setRetrying(new Set(retryingRef.current));
    }
  };

  // ---- links --------------------------------------------------------------------------------------------------------
  const links = useSignedLinks((sheets ?? []).map((s) => ({ key: `sheet-${s.id}`, path: `/api/editor/price-sheets/${s.id}/link` })));
  const registerPrint = (el: HTMLDivElement | null) => {
    printStatus.current = el;
    links.registerStatus(el);
  };

  const onCatalogue = (next: Catalogue) => setCatalogue(next);

  return (
    <main class="desk-page editor" ref={page}>
      <Alerts messages={!!state?.messagesQueued} work={!!state?.workQueued} />
      <header class="desk-head">
        <h1>{session.displayName}</h1>
        <SignOut />
      </header>
      {/* The desk body waits for the first read, so nothing already on screen is pushed down when the lists arrive. */}
      {settled && (
        <>
          <div class="desk-statuses">
            <p class="counts">{state ? countsLine(state.counts) : ""}</p>
            <section role="region" aria-label="Held work" class="held">
              <p>{heldWorkLine(state?.heldWork ?? 0)}</p>
              <div role="status" aria-label="Work status" class="status">
                {workStatus}
              </div>
            </section>
            <div role="status" aria-label="Print status" class="status print-status focus-target" tabIndex={-1} ref={registerPrint}>
              {links.sentence && <div>{links.sentence}</div>}
              {printLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div role="status" aria-label="Publish status" class="status publish-status">
              {publishStatus}
            </div>
          </div>
          <div class="two">
            <div class="col">
              <Desk sheets={sheets} catalogue={catalogue} status={importStatus} onImport={(f) => void importFile(f)} onSettle={(s, r, b) => void settle(s, r, b)} />
              <Sheets sheets={sheets} links={links} say={setPublishStatus} onDraft={onDraftMade} />
            </div>
            <div class="col">
              <section class="drafts" aria-label="Drafts">
                <h2>Drafts</h2>
                {state && state.drafts.length === 0 && <Slide line="NOTHING IN THE CAN" sentence="Draft a notice from a settled sheet." />}
                {(state?.drafts ?? []).map((d) => (
                  <DraftGroup
                    key={d.id}
                    draft={d}
                    held={held.current?.drafts[d.id]}
                    focusTitle={focusDraft === d.id}
                    say={(m) => setPublishStatus(m)}
                    onPublished={(number, version) => onPublished(d.id, number, version)}
                    onChanged={refresh}
                    register={(id, api) => {
                      if (api) drafts.current.set(id, api);
                      else drafts.current.delete(id);
                    }}
                  />
                ))}
              </section>
              <PublishedNotices notices={state?.notices ?? []} retrying={retrying} onRetry={(n, v) => void retry(n, v)} onCorrect={(number) => setCorrecting({ number, held: null })} />
              <RenameForms catalogue={catalogue} onCatalogue={onCatalogue} onRenamed={refresh} />
              <BatchForm catalogue={catalogue} />
            </div>
          </div>
        </>
      )}
      {correcting && state?.notices.some((n) => n.number === correcting.number) && (
        <CorrectDialog
          notice={state.notices.find((n) => n.number === correcting.number)!}
          held={correcting.held}
          apiRef={correction}
          say={setPublishStatus}
          lastRefusal={lastRefusal}
          onRefused={setLastRefusal}
          onClose={() => {
            const number = correcting.number;
            setCorrecting(null);
            wantFocus.current = `correct-${number}`;
          }}
          onDone={(version) => onCorrected(correcting.number, version)}
        />
      )}
      {showBar && (
        <div role="region" aria-label="Desk bar" class="desk-bar" data-desk-bar>
          <p>{openRows(openCount)}</p>
          <button type="button" class="rect-button inverse" onClick={nextRow}>
            Next open row
          </button>
        </div>
      )}
    </main>
  );
}
