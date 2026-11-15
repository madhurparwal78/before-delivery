import { useEffect, useRef, useState } from "preact/hooks";
import { paneNames, type DiffResult, type Pen, type Version, type VersionEntry } from "../../shared/types";
import { api, idempotencyKey } from "../api";
import { StageCrossfade, StatePanel } from "../components";
import { changeCounts, formatDate, unverifiedText } from "../format";
import { crossfadeMs, prefersReducedMotion, restMs, useReducedMotion } from "../hooks";
import { Page } from "../layout";
import { Link, navigate, replaceAddress } from "../router";
import { setFlash, useAppState } from "../store";
import { NotFound } from "./simple";

const paneLabels = { html: "HTML", css: "CSS", js: "JS" } as const;

function bandHeight(entry: VersionEntry): number {
  return 6 + 4 * Math.log2(1 + entry.changed_chars);
}

function parseVersion(raw: string | null, count: number): number | null {
  const match = /^v(\d+)$/.exec(raw ?? "");
  const value = match ? Number(match[1]) : NaN;
  return Number.isInteger(value) && value >= 1 && value <= count ? value : null;
}

/** Counts a figure from its previous value to the new one over the crossfade time. */
function useTicker(target: number): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target || prefersReducedMotion()) {
      from.current = target;
      setShown(target);
      return;
    }
    const steps = 12;
    const timers: number[] = [];
    for (let step = 1; step <= steps; step += 1) {
      timers.push(
        window.setTimeout(() => {
          const value = Math.round(start + ((target - start) * step) / steps);
          from.current = value;
          setShown(value);
        }, (crossfadeMs * step) / steps),
      );
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [target]);
  return shown;
}

function Counts({ added, removed }: { added: number; removed: number }) {
  return <p class="diff-counts figure">{changeCounts(useTicker(added), useTicker(removed))}</p>;
}

export function History({ penId }: { penId: string }) {
  const [data, setData] = useState<{ pen: Pen; versions: VersionEntry[] } | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    void Promise.all([api<Pen>("GET", `/api/pens/${penId}`), api<{ versions: VersionEntry[] }>("GET", `/api/pens/${penId}/versions`)]).then(([pen, versions]) => {
      if (pen.ok && versions.ok) setData({ pen: pen.data, versions: versions.data.versions });
      else setMissing(true);
    });
  }, [penId]);
  if (missing) return <NotFound />;
  if (!data) {
    return (
      <Page class="split">
        <div class="stage" />
        <div class="column">
          <StatePanel>Loading the history…</StatePanel>
        </div>
      </Page>
    );
  }
  return <CoreSample pen={data.pen} initialVersions={data.versions} />;
}

function CoreSample({ pen, initialVersions }: { pen: Pen; initialVersions: VersionEntry[] }) {
  const { user } = useAppState();
  const reduced = useReducedMotion();
  const [versions, setVersions] = useState(initialVersions);
  const count = initialVersions.length;
  const [initialA, initialB] = (() => {
    const search = new URLSearchParams(location.search);
    const a = parseVersion(search.get("a"), count);
    const b = parseVersion(search.get("b"), count);
    return a !== null && b !== null ? [a, b] : [count, count];
  })();
  const [marker, setMarker] = useState(initialB);
  const [pinned, setPinned] = useState(initialA);
  const [rested, setRested] = useState(initialB);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [status, setStatus] = useState("");
  const [settling, setSettling] = useState<number | null>(null);
  const [stageHeight, setStageHeight] = useState(480);
  const restTimer = useRef<number | undefined>(undefined);
  const diffRequest = useRef(0);
  const strataRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<number | null>(null);
  const isOwner = user !== null && user.handle === pen.owner;

  useEffect(() => {
    const measure = () => setStageHeight(strataRef.current?.parentElement?.clientHeight ?? 480);
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(restTimer.current);
    };
  }, []);

  const compare = (a: number, b: number) => {
    if (count === 0) return;
    replaceAddress(`/pen/${pen.id}/history?a=v${a}&b=v${b}`);
    const request = ++diffRequest.current;
    void api<DiffResult>("GET", `/api/pens/${pen.id}/diff?a=${a}&b=${b}`).then((result) => {
      if (result.ok && request === diffRequest.current) setDiff(result.data);
    });
  };

  useEffect(() => compare(initialA, initialB), []);

  const moveMarker = (value: number) => {
    const next = Math.min(count, Math.max(1, value));
    setMarker(next);
    window.clearTimeout(restTimer.current);
    restTimer.current = window.setTimeout(() => {
      setRested(next);
      compare(pinned, next);
    }, restMs);
  };

  const pin = () => {
    setPinned(marker);
    compare(marker, rested);
  };

  const restore = async () => {
    const result = await api<Version>("POST", `/api/pens/${pen.id}/restore`, { version: rested, base_version: count }, { "Idempotency-Key": idempotencyKey() });
    if (!result.ok) {
      if (result.error.error === "unverified") setStatus(unverifiedText(user?.email ?? ""));
      else if (result.error.error === "version_conflict") setStatus(`Version ${result.error.head ?? ""} of this pen was saved somewhere else. Reload to see it.`);
      else setStatus(`Storage is unreachable, so version ${rested} was not restored.`);
      return;
    }
    const restored = result.data;
    setFlash(`save:${pen.id}`, `Restored version ${rested} as version ${restored.number}`);
    const land = () => navigate(`/pen/${pen.id}`);
    const listed = await api<{ versions: VersionEntry[] }>("GET", `/api/pens/${pen.id}/versions`);
    if (listed.ok) setVersions(listed.data.versions);
    setSettling(restored.number);
    if (prefersReducedMotion()) land();
    else window.setTimeout(land, restMs);
  };

  if (count === 0) {
    return (
      <Page class="split">
        <div class="stage" />
        <div class="column">
          <h1>{pen.title}</h1>
          <StatePanel>This pen has no versions yet. Save one in the editor and it becomes the first layer here.</StatePanel>
          <Link href={`/pen/${pen.id}`}>Back to editor</Link>
        </div>
      </Page>
    );
  }

  const natural = versions.reduce((sum, entry) => sum + bandHeight(entry), 0);
  if (settling === null || scaleRef.current === null) scaleRef.current = natural > stageHeight ? stageHeight / natural : 1;
  const scale = scaleRef.current;
  const selected = versions[marker - 1];
  const below = versions.slice(0, marker - 1).reduce((sum, entry) => sum + bandHeight(entry) * scale, 0);
  const markerOffset = below + ((selected ? bandHeight(selected) : 0) * scale) / 2;

  const versionFromPointer = (event: PointerEvent): number => {
    const rect = strataRef.current?.getBoundingClientRect();
    if (!rect) return marker;
    let offset = rect.bottom - event.clientY;
    for (const entry of versions.slice(0, count)) {
      offset -= bandHeight(entry) * scale;
      if (offset <= 0) return entry.number;
    }
    return count;
  };

  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    document.getElementById("core-sample-marker")?.focus();
    moveMarker(versionFromPointer(event));
    const move = (moveEvent: PointerEvent) => moveMarker(versionFromPointer(moveEvent));
    const stop = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", stop);
      target.removeEventListener("pointercancel", stop);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", stop);
    target.addEventListener("pointercancel", stop);
  };

  const valueText = selected
    ? `Version ${selected.number} of ${count}, saved ${formatDate(selected.created_at)}, ${changeCounts(selected.added, selected.removed)}`
    : "";

  return (
    <Page class="split history-page">
      <div class={`stage core-sample${reduced ? " reduced" : ""}`}>
        <div class="history-preview">
          <StageCrossfade source={{ penId: pen.id, version: rested }} sourceKey={`${pen.id}-${rested}`} />
        </div>
        <div class="strata-wrap">
          <div class="strata" ref={strataRef} onPointerDown={onPointerDown}>
            {versions.map((entry) => (
              <div
                key={entry.number}
                class={`band${entry.number % 2 === 0 ? " even" : ""}${entry.number === settling ? " settling" : ""}`}
                data-version={String(entry.number)}
                data-selected={entry.number === marker ? "true" : undefined}
                style={{ height: `${bandHeight(entry) * scale}px` }}
              />
            ))}
          </div>
          <div
            id="core-sample-marker"
            role="slider"
            tabIndex={0}
            aria-label="Core sample"
            aria-orientation="vertical"
            aria-valuemin={1}
            aria-valuemax={count}
            aria-valuenow={marker}
            aria-valuetext={valueText}
            class="marker"
            style={{ bottom: `${markerOffset}px` }}
            onPointerDown={onPointerDown}
            onKeyDown={(event) => {
              const moves: Record<string, number> = { ArrowUp: marker + 1, ArrowDown: marker - 1, Home: 1, End: count };
              if (event.key in moves) {
                event.preventDefault();
                moveMarker(moves[event.key] ?? marker);
              } else if (event.key === "Enter") {
                event.preventDefault();
                pin();
              }
            }}
          >
            <span class="marker-label figure" aria-hidden="true">
              v{marker}
            </span>
          </div>
        </div>
      </div>
      <div class="column">
        <h1>{pen.title}</h1>
        <p class="lede">Walk the Core sample with Up and Down. Enter pins a version to compare against.</p>
        <section role="region" aria-label="Compare" class="compare">
          <h2>{`Comparing version ${diff?.a ?? pinned} with version ${diff?.b ?? rested}`}</h2>
          {diff && (
            <>
              <Counts added={diff.added} removed={diff.removed} />
              {paneNames.map((pane) => (
                <section key={pane} role="region" aria-label={`${paneLabels[pane]} changes`} class="pane-diff">
                  <Counts added={diff.panes[pane].added} removed={diff.panes[pane].removed} />
                  <p class="pane-caption">{paneLabels[pane]}</p>
                  <div class="diff-rows">
                    {diff.panes[pane].rows.map((row, index) => (
                      <div key={index} class={`diff-row ${row.change}`} data-change={row.change}>
                        {row.text}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}
        </section>
        <p role="status" aria-label="History status" class="quiet-status">
          {status}
        </p>
        <div class="history-actions">
          {isOwner && rested !== count && (
            <button type="button" class="primary" onClick={() => void restore()}>
              {`Restore version ${rested}`}
            </button>
          )}
          <Link href={`/pen/${pen.id}`}>Back to editor</Link>
        </div>
      </div>
    </Page>
  );
}
