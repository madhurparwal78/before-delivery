import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Category, type Constellation, type Dreamscape as DreamscapeView, type DreamSign, type Entry, type NightSettings, type NightStatus, type Tallies } from "../../shared/api";
import { api, deviceId, succeeded, upload, type ApiBody } from "../api";
import { CATEGORY_LABEL, COPY, heldNight, notSaved, synced } from "../copy";
import { prefersReducedMotion, useLayout } from "../layout";
import { flyPhrase, GATHER_AT, LIFT_AT, SETTLE_AT } from "../sky/condensation";
import { still, tweenAt, type SceneContent, type Tween } from "../sky/scene";
import type { SkyPoints } from "../sky/Sky";
import { EmptyNightDrawing, OfflineIcon } from "../ui/icons";
import { Status } from "../ui/Status";
import { forgetEntry, forgetMemo, keepEntry, keepMemo, keptEntries, pendingMemos, type KeptEntry, type PendingMemo } from "./device";
import { DrillDialog, SettingsDialog, TagDialog } from "./dialogs";
import { Dreamscape, type CondensationPhase } from "./Dreamscape";
import { KeptEntryCard, SavedEntry, type MarkRange } from "./EntryCard";
import { NewEntry, type Draft } from "./NewEntry";

const NIGHT_REFRESH_MS = 60_000;
const REDUCED_FADE_MS = 100;
const REFUSED_FADE_MS = 330;

type Outcome = "saved" | "rejected" | "kept";

interface PendingMark extends MarkRange {
  key: string;
  entryId: string;
}

interface Tagging {
  entry: Entry;
  start: number;
  end: number;
}

function rejectionReason(status: number, body: ApiBody): string {
  if (status === 409) return body.error === "entry_id_conflict" ? COPY.conflict : COPY.notOpen;
  return Object.values(body.errors ?? {}).join(" ");
}

/** UTF-16 offsets of a selection inside an entry text, counted over the whole text the way the server counts them. */
function selectionIn(root: Element, selection: Selection | null): MarkRange | null {
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end } : null;
}

function rangeRect(root: Element, start: number, end: number): DOMRect {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let begun = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!begun && start <= offset + length) {
      range.setStart(node, start - offset);
      begun = true;
    }
    if (begun && end <= offset + length) {
      range.setEnd(node, end - offset);
      break;
    }
    offset += length;
  }
  return range.getBoundingClientRect();
}

function haloTweens(scape: DreamscapeView): Record<Category, Tween> {
  const halos = { inner_awareness: still(12), action: still(12), form: still(12), context: still(12) };
  for (const c of scape.constellations) halos[c.category] = still(c.halo_px);
  return halos;
}

function nightHeading(number: number, key: string): string {
  return number >= 1 ? `Night ${number}, ${key}` : `Before night 1, ${key}`;
}

const isVisible = (): boolean => document.visibilityState === "visible";

/** The dreamer's logbook. `owner` is the signed-in enrollment id that every kept entry and memo is stamped with. */
export function Logbook({ owner }: { owner: string }) {
  const layout = useLayout();
  const [night, setNight] = useState<NightStatus | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [kept, setKept] = useState<KeptEntry[]>([]);
  const [waitingMemos, setWaitingMemos] = useState<Set<string>>(new Set());
  const [constellations, setConstellations] = useState<readonly Constellation[]>([]);
  // The first read has settled (answered or failed): until then only skeletons show, so nothing loaded later moves them.
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<Category | null>(null);
  const [halos, setHalos] = useState<Record<Category, Tween>>(() => ({ inner_awareness: still(12), action: still(12), form: still(12), context: still(12) }));
  const [arrivals, setArrivals] = useState<Map<string, Tween>>(new Map());
  const [pendingMarks, setPendingMarks] = useState<PendingMark[]>([]);
  const [phase, setPhase] = useState<CondensationPhase>("idle");
  const [online, setOnline] = useState(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState({ text: "", announcement: 0 });
  const [practice, setPractice] = useState("");
  const [signsStatus, setSignsStatus] = useState("");
  const [sharing, setSharing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ key: number; value: Draft | null; focus: boolean }>({ key: 0, value: null, focus: false });
  const [tagging, setTagging] = useState<Tagging | null>(null);
  const [tagKey, setTagKey] = useState(0);
  const [drill, setDrill] = useState<{ key: number; open: boolean; target: Category | null; opener: HTMLButtonElement | null }>({ key: 0, open: false, target: null, opener: null });
  const [settings, setSettings] = useState<{ key: number; open: boolean }>({ key: 0, open: false });

  const titleRef = useRef<HTMLInputElement>(null);
  const settingsOpener = useRef<HTMLButtonElement>(null);
  const tagOpener = useRef<HTMLButtonElement | null>(null);
  const skyPoints = useRef<SkyPoints>(null);
  const selections = useRef(new Map<string, MarkRange | null>());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const halosRef = useRef(halos);
  halosRef.current = halos;

  const announceSync = useCallback((text: string) => setSyncStatus((current) => ({ text, announcement: current.announcement + 1 })), []);

  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch((error: unknown) => console.warn("sync step failed", error));
  }, []);

  const refreshNight = useCallback(async () => {
    try {
      const result = await api<NightStatus>("GET", "/api/me/night");
      if (result.status === 200) setNight(result.data);
    } catch {
      // Offline: the panel keeps the last status the server published.
    }
  }, []);

  const uploadMemo = useCallback(
    async (memo: PendingMemo) => {
      announceSync(COPY.uploadingMemo);
      try {
        const result = await upload<{ memo: Entry["memo"] }>(`/api/me/entries/${memo.entryId}/memo`, memo.blob, {
          "Content-Type": memo.type,
          "X-Memo-Duration-Ms": String(memo.durationMs),
        });
        if (result.status === 503 || result.status === 401) {
          announceSync(COPY.memoKept);
          return;
        }
        await forgetMemo(memo.entryId);
        setWaitingMemos((current) => new Set([...current].filter((id) => id !== memo.entryId)));
        if (succeeded(result.status)) {
          const stored = result.data.memo;
          setEntries((current) => current?.map((entry) => (entry.id === memo.entryId ? { ...entry, memo: stored } : entry)) ?? current);
          announceSync(COPY.memoSaved);
        } else {
          announceSync(notSaved(result.data.error === "memo_exists" ? COPY.memoExists : Object.values(result.data.errors ?? {}).join(" ")));
        }
      } catch {
        announceSync(COPY.memoKept);
      }
    },
    [announceSync],
  );

  /** Sends one kept entry. Only 200 or 201 saves it; 409 and 422 reject it for good; anything else keeps it. */
  const sendKept = useCallback(
    async (entry: KeptEntry): Promise<Outcome> => {
      let result;
      try {
        result = await api<{ entry: Entry }>("PUT", `/api/me/entries/${entry.id}`, entry.fields);
      } catch {
        return "kept";
      }
      if (succeeded(result.status)) {
        const saved = result.data.entry;
        if (entry.memo) {
          await keepMemo({ ...entry.memo, entryId: entry.id, owner });
          setWaitingMemos((current) => new Set([...current, entry.id]));
        }
        await forgetEntry(entry.id);
        setKept((current) => current.filter((k) => k.id !== entry.id));
        setEntries((current) => [saved, ...(current ?? []).filter((e) => e.id !== saved.id)]);
        void refreshNight();
        return "saved";
      }
      if (result.status === 409 || result.status === 422) {
        const rejected = { ...entry, rejection: rejectionReason(result.status, result.data) };
        await keepEntry(rejected);
        setKept((current) => current.map((k) => (k.id === entry.id ? rejected : k)));
        announceSync(notSaved(rejected.rejection));
        return "rejected";
      }
      return "kept";
    },
    [announceSync, owner, refreshNight],
  );

  /** A sync attempt: kept entries in writing order, then kept memos, then the announcement. Nothing to send, no attempt. */
  const syncAll = useCallback(() => {
    if (!navigator.onLine) return;
    enqueue(async () => {
      const sendable = (await keptEntries(owner)).filter((entry) => entry.rejection === null);
      if (sendable.length === 0 && (await pendingMemos(owner)).length === 0) return;
      let saved = 0;
      for (const entry of sendable) {
        if ((await sendKept(entry)) === "saved") saved += 1;
      }
      for (const memo of await pendingMemos(owner)) await uploadMemo(memo);
      announceSync(synced(saved, (await keptEntries(owner)).length));
    });
  }, [announceSync, enqueue, owner, sendKept, uploadMemo]);

  useEffect(() => {
    void (async () => {
      setKept(await keptEntries(owner));
      setWaitingMemos(new Set((await pendingMemos(owner)).map((memo) => memo.entryId)));
      const [status, list, scape] = await Promise.all([
        api<NightStatus>("GET", "/api/me/night"),
        api<{ entries: Entry[] }>("GET", "/api/me/entries"),
        api<DreamscapeView>("GET", "/api/me/dreamscape"),
      ]).catch(() => [null, null, null] as const);
      if (status?.status === 200) setNight(status.data);
      if (list?.status === 200) setEntries(list.data.entries);
      if (scape?.status === 200) {
        setConstellations(scape.data.constellations);
        setTarget(scape.data.target_category);
        setHalos(haloTweens(scape.data));
      }
      setReady(true);
      syncAll();
    })();
  }, [owner, syncAll]);

  // The listeners and the 60-second timer read the latest callbacks through refs, so a re-render never restarts the countdown.
  const refreshRef = useRef(refreshNight);
  refreshRef.current = refreshNight;
  const syncRef = useRef(syncAll);
  syncRef.current = syncAll;

  useEffect(() => {
    const refreshNight = () => refreshRef.current();
    // On reconnect the server's night is read first (it also confirms the session), then kept work is sent.
    const goOnline = () => {
      setOnline(true);
      void refreshNight().then(() => syncRef.current());
    };
    const goOffline = () => setOnline(false);
    const becameVisible = () => {
      if (isVisible()) void refreshNight();
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", becameVisible);
    // The Tonight panel refreshes every 60 seconds while the page is visible.
    const timer = setInterval(() => {
      if (isVisible()) void refreshNight();
    }, NIGHT_REFRESH_MS);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", becameVisible);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const track = () => {
      const selection = document.getSelection();
      const anchor = selection?.anchorNode;
      const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
      const root = parent?.closest("[data-entry-text]");
      const id = root?.getAttribute("data-entry-text");
      // A selection that leaves the entry texts (cleared, or made elsewhere) leaves no remembered phrase behind.
      if (root && id) selections.current.set(id, selectionIn(root, selection));
      else selections.current.clear();
    };
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, []);

  const save = async (value: Draft) => {
    const entry: KeptEntry = { id: deviceId(), owner, order: Date.now() + performance.now() / 1e6 + kept.length, fields: value.fields, rejection: null, memo: value.memo };
    // Read the connection at save time: an entry written offline waits for the reconnect sync and its announcement.
    const online = navigator.onLine;
    await keepEntry(entry);
    setKept((current) => [...current, entry]);
    if (!online) return;
    enqueue(async () => {
      if ((await sendKept(entry)) !== "saved" || !entry.memo) return;
      await uploadMemo({ ...entry.memo, entryId: entry.id, owner });
    });
  };

  const editAsNew = async (entry: KeptEntry) => {
    await forgetEntry(entry.id);
    setKept((current) => current.filter((k) => k.id !== entry.id));
    setDraft((current) => ({ key: current.key + 1, value: { fields: entry.fields, memo: entry.memo }, focus: true }));
  };

  const discard = async (entry: KeptEntry) => {
    await forgetEntry(entry.id);
    await forgetMemo(entry.id);
    setKept((current) => current.filter((k) => k.id !== entry.id));
    titleRef.current?.focus();
  };

  const share = async (entry: Entry) => {
    setSharing(entry.id);
    try {
      const result = await api<{ entry: Entry }>("PUT", `/api/me/entries/${entry.id}/share`, { shared: !entry.shared });
      if (result.status === 200) {
        const updated = result.data.entry;
        setEntries((current) => current?.map((e) => (e.id === updated.id ? updated : e)) ?? current);
        setPractice(updated.shared ? COPY.shared : COPY.unshared);
      }
    } catch {
      setPractice(COPY.needsConnection);
    } finally {
      setSharing(null);
    }
  };

  const openTag = (entry: Entry, opener: HTMLButtonElement | null) => {
    const root = document.querySelector(`[data-entry-text="${entry.id}"]`);
    const selected = (root && selectionIn(root, document.getSelection())) ?? selections.current.get(entry.id);
    if (!selected) {
      setSignsStatus(COPY.noSelection);
      return;
    }
    tagOpener.current = opener;
    setTagKey((key) => key + 1);
    setTagging({ entry, start: selected.start, end: selected.end });
  };

  /**
   * The sign condensation: underline at once, the flight from 0.12 s, the settle from 0.76 s, then the
   * server-confirmed star, legend count and announcement at 1.06 s or at the confirmation if that comes later.
   * With reduced motion the phase goes from underline straight to idle when the server confirms.
   */
  const confirmTag = async (category: Category) => {
    if (!tagging) return;
    const { entry, start, end } = tagging;
    setTagging(null);
    const begun = performance.now();
    const reduced = prefersReducedMotion();
    const mark: PendingMark = { key: deviceId(), entryId: entry.id, start, end };
    setPendingMarks((current) => [...current, mark]);
    setPhase("underline");
    const steps = reduced
      ? []
      : [setTimeout(() => setPhase("flight"), LIFT_AT), setTimeout(() => setPhase("settle"), GATHER_AT)];
    const textRoot = document.querySelector(`[data-entry-text="${entry.id}"]`);
    const font = textRoot ? getComputedStyle(textRoot).font : "17px sans-serif";
    const flight = !reduced && textRoot ? flyPhrase(rangeRect(textRoot, start, end), entry.text.slice(start, end), font, () => skyPoints.current?.pointFor(category) ?? null, begun) : null;
    const dropMark = () => setPendingMarks((current) => current.filter((m) => m.key !== mark.key));
    let sign: DreamSign | null = null;
    let tallies: Tallies | null = null;
    let scape: DreamscapeView | null = null;
    let refusal: string = COPY.signRejected;
    try {
      const result = await api<{ sign: DreamSign; tallies: Tallies }>("POST", `/api/me/entries/${entry.id}/signs`, { start, end, category });
      if (succeeded(result.status)) {
        sign = result.data.sign;
        tallies = result.data.tallies;
        const latest = await api<DreamscapeView>("GET", "/api/me/dreamscape");
        if (latest.status === 200) scape = latest.data;
      } else if (result.data.error === "sign_overlap") {
        refusal = COPY.overlap;
      }
    } catch {
      sign = null;
    }
    if (!sign || !tallies) {
      for (const step of steps) clearTimeout(step);
      dropMark();
      flight?.fade();
      setPhase("refused");
      setSignsStatus(refusal);
      setTimeout(() => setPhase("idle"), REFUSED_FADE_MS);
      return;
    }
    const confirmed = performance.now();
    const settleAt = reduced ? confirmed : Math.max(begun + SETTLE_AT, confirmed);
    const starFrom = reduced ? confirmed : Math.max(begun + GATHER_AT, confirmed);
    const starUntil = reduced ? confirmed + REDUCED_FADE_MS : settleAt;
    const made = sign;
    const isNew = !entries?.some((e) => e.signs.some((s) => s.id === made.id));
    dropMark();
    setEntries((current) => current?.map((e) => (e.id === made.entry_id && isNew ? { ...e, signs: [...e.signs, made] } : e)) ?? current);
    if (isNew) setArrivals((current) => new Map([...current, [made.id, { from: 0, to: 1, start: starFrom, end: starUntil }]]));
    if (scape) {
      const next = haloTweens(scape);
      const at = performance.now();
      const grow = (c: Category): Tween => ({ from: tweenAt(halosRef.current[c], at), to: next[c].to, start: reduced ? at : starFrom, end: reduced ? at : settleAt });
      setHalos({ inner_awareness: grow("inner_awareness"), action: grow("action"), form: grow("form"), context: grow("context") });
    }
    flight?.land(() => skyPoints.current?.pointFor(category, made.id) ?? null);
    const counted = tallies[category];
    const confirmedScape = scape;
    const settle = () => {
      setPhase("idle");
      if (confirmedScape) {
        setConstellations(confirmedScape.constellations);
        setTarget(confirmedScape.target_category);
      }
      setSignsStatus(`${CATEGORY_LABEL[category]} signs: ${counted}.`);
    };
    const wait = settleAt - performance.now();
    if (wait <= 0) settle();
    else setTimeout(settle, wait);
  };

  const onSettingsSaved = (saved: NightSettings) => {
    setSettings((s) => ({ ...s, open: false }));
    setPractice(saved.night_held ? heldNight(saved.night_number) : COPY.settingsSaved);
    void refreshNight();
  };

  const scene = useMemo<SceneContent>(
    () => ({ stars: (entries ?? []).flatMap((e) => e.signs.map((s) => ({ id: s.id, category: s.category }))), halos, arrivals }),
    [entries, halos, arrivals],
  );

  const currentKey = night?.night_key ?? null;
  const earlier = useMemo(() => {
    const groups = new Map<string, Entry[]>();
    for (const entry of entries ?? []) {
      if (entry.night_key === currentKey) continue;
      groups.set(entry.night_key, [...(groups.get(entry.night_key) ?? []), entry]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
  }, [entries, currentKey]);
  const tonightEntries = (entries ?? []).filter((e) => e.night_key === currentKey);
  const keptNewestFirst = [...kept].reverse();

  const renderSaved = (entry: Entry, homeTz: string) => (
    <SavedEntry
      key={entry.id}
      entry={entry}
      homeTz={homeTz}
      pendingMarks={pendingMarks.filter((m) => m.entryId === entry.id)}
      memoWaiting={waitingMemos.has(entry.id)}
      sharing={sharing === entry.id}
      onTag={openTag}
      onShare={(e) => void share(e)}
      onMemoError={() => announceSync(COPY.memoUnavailable)}
    />
  );

  const tonightPanel = night ? (
    <section className="tonight panel" aria-label="Tonight">
      <div className="tonight-head">
        <p className="tonight-night">
          {night.night_number >= 1 ? (
            <>
              {`Night ${night.night_number} of 28 – `}
              <span className="nowrap">{night.night_key}</span>
            </>
          ) : (
            `Your first night is ${night.first_night}.`
          )}
        </p>
      </div>
      <div className="tonight-times">
        <span>{`Bedtime ${night.bedtime}`}</span>
        <span>{`Wake alarm ${night.wake_alarm}`}</span>
      </div>
      {/* Facts first, the action last, in the same order as Tab; the action shares the capture-window row. */}
      <div className="tonight-foot">
        <p className="tonight-window">{night.capture_window === "open" ? COPY.windowOpen : COPY.windowClosed}</p>
        <button ref={settingsOpener} type="button" className="button quiet" onClick={() => setSettings((s) => ({ key: s.key + 1, open: true }))}>
          Night settings
        </button>
      </div>
      <Status label="Practice">{practice}</Status>
    </section>
  ) : (
    <div className="skeleton" style={{ height: 150 }} aria-hidden="true" />
  );

  const journalColumn = !ready ? (
    <div className="journal-column" aria-busy="true">
      <div className="skeleton" style={{ height: 150 }} aria-hidden="true" />
      <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />
    </div>
  ) : (
    <div className="journal-column">
      {tonightPanel}
      <section className="journal" aria-label="Journal">
        <div className="statuses">
          <div role="status" aria-label="Connection" className={online ? "status-line connection" : "notice"}>
            {online ? null : <OfflineIcon />}
            {online ? null : <span>{COPY.offline}</span>}
          </div>
          <NewEntry key={draft.key} initial={draft.value} focusTitle={draft.focus} titleRef={titleRef} techniqueUnlocked={night?.technique_unlocked ?? false} onSave={save} />
          <Status label="Sync" announcement={syncStatus.announcement}>
            {syncStatus.text}
          </Status>
        </div>
        {night ? (
          <section className="night-section current" aria-labelledby="night-current">
            <h2 id="night-current">{nightHeading(night.night_number, night.night_key)}</h2>
            {keptNewestFirst.map((entry) => (
              <KeptEntryCard key={entry.id} entry={entry} onEdit={(e) => void editAsNew(e)} onDiscard={(e) => void discard(e)} />
            ))}
            {tonightEntries.map((entry) => renderSaved(entry, night.home_tz))}
            {entries !== null && keptNewestFirst.length === 0 && tonightEntries.length === 0 ? (
              <div className="empty-night">
                <EmptyNightDrawing />
                <p>{COPY.emptyNight}</p>
              </div>
            ) : null}
          </section>
        ) : (
          <div className="skeleton" style={{ height: 220 }} aria-hidden="true" />
        )}
        {night
          ? earlier.map(([key, list]) => (
              <section key={key} className="night-section" aria-labelledby={`night-${key}`}>
                <h2 id={`night-${key}`}>{nightHeading(list[0]?.night_number ?? 0, key)}</h2>
                {list.map((entry) => renderSaved(entry, night.home_tz))}
              </section>
            ))
          : null}
      </section>
    </div>
  );

  const dreamscape = (
    <Dreamscape
      layout={layout}
      ready={ready}
      scene={scene}
      constellations={constellations}
      target={target}
      reduced={prefersReducedMotion()}
      phase={phase}
      signsStatus={signsStatus}
      skyPoints={skyPoints}
      onDrill={(opener) => setDrill((d) => ({ key: d.key + 1, open: true, target, opener }))}
    />
  );

  return (
    <main className="workspace">
      {layout === "desktop" ? (
        <>
          {journalColumn}
          {dreamscape}
        </>
      ) : (
        <>
          {dreamscape}
          {layout === "phone" ? (
            <Status label="Dream signs" liveOutside>
              {signsStatus}
            </Status>
          ) : null}
          {journalColumn}
        </>
      )}
      <TagDialog
        key={`tag-${tagKey}`}
        open={tagging !== null}
        phrase={tagging ? tagging.entry.text.slice(tagging.start, tagging.end) : ""}
        returnFocus={() => tagOpener.current}
        onCancel={() => setTagging(null)}
        onConfirm={(category) => void confirmTag(category)}
      />
      {drill.target ? (
        <DrillDialog
          key={`drill-${drill.key}`}
          open={drill.open}
          target={drill.target}
          returnFocus={() => drill.opener}
          onClose={() => setDrill((d) => ({ ...d, open: false }))}
          onLogged={(n) => {
            setPractice(`Reality check logged. Checks this night: ${n}.`);
            setDrill((d) => ({ ...d, open: false }));
          }}
        />
      ) : null}
      {night ? (
        <SettingsDialog
          key={`settings-${settings.key}`}
          open={settings.open}
          homeTz={night.home_tz}
          bedtime={night.bedtime}
          returnFocus={() => settingsOpener.current}
          onClose={() => setSettings((s) => ({ ...s, open: false }))}
          onSaved={onSettingsSaved}
        />
      ) : null}
    </main>
  );
}
