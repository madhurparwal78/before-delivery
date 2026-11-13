// Compare (DP-30..DP-32, DP-68): two revisions by the material added and removed, address as history.
import { useEffect, useMemo, useRef, useState } from "react";
import type { CompareJson, LiveEvent, PartJson, RevisionJson, RevisionListJson } from "../shared/api";
import { parseDecimal, volumeText } from "../shared/numbers";
import { buildManifest, parseTine, poseOfSolid, type Pose } from "../shared/tine";
import { api, get } from "./api";
import { PageHeading } from "./chrome";
import { RadioGroup } from "./controls";
import { useEpoch } from "./epoch";
import { clockTime } from "./hooks";
import { useLiveEvents } from "./live";
import { changeLine } from "./partAddress";
import { navigate, rewrite, useLocation } from "./router";
import { Link, NotFound } from "./shell";
import { fetchSolid, StorageDown } from "./solids";
import { Viewport, type ViewportHandle } from "./viewport/Viewport";
import type { Scene } from "./viewport/engine";

const VIEWS = ["overlay", "added", "removed", "swipe"] as const;
type View = (typeof VIEWS)[number];

export function ComparePage({ slug }: { slug: string }) {
  const [part, setPart] = useState<PartJson | null | undefined>(undefined);
  useEffect(() => {
    void get<PartJson>(`/api/parts/${slug}`).then((reply) => setPart(reply.ok ? reply.data : null));
  }, [slug]);
  if (part === null) return <NotFound />;
  if (part === undefined) return <div className="loading-page" aria-busy="true" />;
  return <CompareView part={part} />;
}

function optionText(rev: RevisionJson, authors: Record<string, string>): string {
  return `${rev.label} · ${rev.message} · ${authors[rev.authorId] ?? ""}`;
}

function CompareView({ part }: { part: PartJson }) {
  const slug = part.slug;
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const [revisions, setRevisions] = useState<RevisionJson[] | null>(null);
  const [authors, setAuthors] = useState(part.authors);
  const [activity, setActivity] = useState("");
  const [result, setResult] = useState<{ base: string; head: string; data: CompareJson } | null>(null);
  const [outage, setOutage] = useState(false);
  const [lastGood, setLastGood] = useState<string | null>(null);
  const [epoch, bumpEpoch] = useEpoch(`tinework:epoch:compare:${slug}`);
  const [divider, setDivider] = useState(50);
  const viewport = useRef<ViewportHandle>(null);
  const defaultPose = useRef<Pose | null>(null);

  useEffect(() => {
    void get<RevisionListJson>(`/api/parts/${slug}/revisions`).then((reply) => reply.ok && setRevisions(reply.data.revisions));
  }, [slug]);
  useLiveEvents(slug, (event: LiveEvent) => {
    if (event.type !== "revision") return;
    setRevisions((list) => (list && !list.some((r) => r.id === event.revision.id) ? [event.revision, ...list] : list));
    setAuthors((a) => ({ ...a, [event.revision.authorId]: event.authorDisplayName }));
    setActivity(`New revision ${event.revision.label} by ${event.authorDisplayName}.`);
  });

  const byId = (id: string | null) => revisions?.find((r) => r.id === id);
  const headRev = byId(params.get("head")) ?? revisions?.[0];
  const baseRev = byId(params.get("base")) ?? byId(headRev?.parentRevisionId ?? null) ?? headRev;
  const view: View = VIEWS.find((v) => v === params.get("view")) ?? "overlay";
  const baseId = baseRev?.id;
  const headId = headRev?.id;

  // Missing or unusable parameters are rewritten in place to the default pair.
  useEffect(() => {
    if (!revisions || !baseId || !headId) return;
    const wanted = new URLSearchParams();
    wanted.set("base", baseId);
    wanted.set("head", headId);
    wanted.set("view", view);
    const hunk = params.get("hunk");
    if (hunk !== null) wanted.set("hunk", hunk);
    if (wanted.toString() !== params.toString()) rewrite(`/parts/${slug}/compare?${wanted}`);
    // Rewrites depend on the resolved pair and view only.
  }, [revisions, baseId, headId, view]);

  // One request per pair; a newer pair aborts the older and an answer for a stale pair is never painted.
  useEffect(() => {
    if (!baseId || !headId) return;
    const controller = new AbortController();
    setOutage(false);
    void (async () => {
      try {
        const reply = await api<CompareJson>("GET", `/api/compare?base=${baseId}&head=${headId}`, undefined, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (reply.status === 503) {
          setResult(null);
          setOutage(true);
          return;
        }
        if (reply.ok) {
          setResult({ base: baseId, head: headId, data: reply.data });
          setLastGood(clockTime(new Date()));
          bumpEpoch();
        }
      } catch {
        /* aborted */
      }
    })();
    return () => controller.abort();
  }, [baseId, headId]);

  const compare = result && result.base === baseId && result.head === headId ? result.data : null;
  const hunkParam = params.get("hunk");
  const asked = hunkParam === null ? null : parseDecimal(hunkParam);
  const hunkIndex = compare && asked !== null && Number.isInteger(asked) && asked >= 1 && asked <= compare.hunks.length ? asked : null;

  // Once the pair is painted, a hunk that does not select anything is removed from the address in place.
  useEffect(() => {
    if (!compare || hunkParam === null || hunkIndex !== null) return;
    const next = new URLSearchParams(search);
    next.delete("hunk");
    rewrite(`/parts/${slug}/compare?${next}`);
  }, [compare, hunkParam, hunkIndex]);

  // The selected hunk's pose is applied whenever the address selects it (click, J/K, Back, reload).
  useEffect(() => {
    if (compare && hunkIndex !== null) viewport.current?.glideTo((compare.hunks[hunkIndex - 1] as { pose: Pose }).pose);
  }, [compare, hunkIndex]);

  const go = (edits: Record<string, string | null>, replace: boolean) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(edits)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    navigate(`/parts/${slug}/compare?${next}`, replace);
  };

  const selectHunk = (index: number) => go({ hunk: String(index) }, true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((key !== "j" && key !== "k") || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("textarea, input:not([type=radio]):not([type=range]):not([type=checkbox])")) return;
      if (!compare || compare.hunks.length === 0) return;
      event.preventDefault();
      const next = key === "j" ? Math.min(compare.hunks.length, (hunkIndex ?? 0) + 1) : Math.max(1, (hunkIndex ?? 1) - 1);
      if (key === "k" && hunkIndex === null) return;
      if (next !== hunkIndex) selectHunk(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Scene
  const [solids, setSolids] = useState<{ base: import("../shared/tine").Solid; head: import("../shared/tine").Solid } | null>(null);
  useEffect(() => {
    if (!baseRev || !headRev) return;
    let alive = true;
    Promise.all([fetchSolid(baseRev.geometryDigest), fetchSolid(headRev.geometryDigest)]).then(
      ([base, head]) => alive && setSolids({ base, head }),
      (error: unknown) => {
        if (alive && error instanceof StorageDown) setOutage(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [baseRev?.geometryDigest, headRev?.geometryDigest]);

  const scene = useMemo<Scene | null>(() => {
    if (!solids || !compare) return null;
    const added = compare.hunks.filter((h) => h.kind === "added").map((h) => ({ kind: "box" as const, min: h.box.min, max: h.box.max }));
    const removed = compare.hunks.filter((h) => h.kind === "removed").map((h) => ({ kind: "box" as const, min: h.box.min, max: h.box.max }));
    const key = `compare:${baseId}:${headId}:${view}`;
    if (view === "added") return { key, solid: null, lit: added };
    if (view === "removed") return { key, solid: null, ghost: removed };
    if (view === "swipe") return { key, solid: solids.head, swipe: { base: solids.base, divider: divider / 100 } };
    return { key, solid: solids.head, lit: added, ghost: removed };
  }, [solids, compare, view, baseId, headId, divider]);
  if (solids && !defaultPose.current) defaultPose.current = poseOfSolid(solids.head);

  const manifest = useMemo(() => {
    const parsed = parseTine(part.source);
    return parsed.ok ? buildManifest(parsed.model, {}) : [];
  }, [part.source]);

  if (!revisions || !baseRev || !headRev) return <div className="loading-page" aria-busy="true" />;
  return (
    <div className="page compare-page">
      <header className="part-header">
        <PageHeading>{`Compare ${baseRev.label} and ${headRev.label}`}</PageHeading>
        <p className="by muted">
          <Link to={`/parts/${slug}`}>{part.title}</Link>
        </p>
        <p className="activity" role="status" aria-label="Part activity">
          {activity}
        </p>
      </header>
      <div className="compare-controls">
        <label className="stacked">
          <span>Base revision</span>
          <select aria-label="Base revision" value={baseRev.id} onChange={(event) => go({ base: event.target.value, hunk: null }, false)}>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {optionText(r, authors)}
              </option>
            ))}
          </select>
        </label>
        <label className="stacked">
          <span>Head revision</span>
          <select aria-label="Head revision" value={headRev.id} onChange={(event) => go({ head: event.target.value, hunk: null }, false)}>
            {revisions.map((r) => (
              <option key={r.id} value={r.id}>
                {optionText(r, authors)}
              </option>
            ))}
          </select>
        </label>
        <RadioGroup
          label="View"
          name="compare-view"
          value={view}
          options={VIEWS.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))}
          onChange={(v) => go({ view: v }, true)}
        />
      </div>
      <div className="compare-grid">
        <div className="stage">
          <Viewport
            ref={viewport}
            attrs={{ "data-epoch": epoch }}
            scene={scene}
            defaultPose={defaultPose.current}
            outage={outage ? { lastGood } : null}
            fallback={{ src: `/api/solids/${headRev.geometryDigest}/thumbnail.svg`, alt: `${part.title}, ${headRev.label}` }}
          >
            {view === "swipe" ? (
              <input
                data-ui-control
                className="swipe"
                type="range"
                min={0}
                max={100}
                value={divider}
                aria-label="Swipe divider"
                onChange={(event) => setDivider(Number(event.target.value))}
              />
            ) : null}
          </Viewport>
        </div>
        <div className="compare-lists">
          <section className="volume-change" role="region" aria-label="Volume change">
            {compare ? (
              compare.identical ? (
                <p>No geometric change: both revisions evaluate to the same solid.</p>
              ) : (
                <>
                  <p>{`Added ${volumeText(compare.added)}`}</p>
                  <p>{`Removed ${volumeText(compare.removed)}`}</p>
                  <p>{`Unchanged ${volumeText(compare.unchanged)}`}</p>
                </>
              )
            ) : null}
          </section>
          <ul className="hunks" aria-label="Hunks">
            {(compare?.hunks ?? []).map((h) => (
              <li key={h.index}>
                <button type="button" aria-current={hunkIndex === h.index ? "true" : undefined} onClick={() => selectHunk(h.index)}>
                  {`Hunk ${h.index} of ${compare?.hunks.length} · ${h.kind === "added" ? "Added" : "Removed"} · ${volumeText(h.volume)}`}
                </button>
              </li>
            ))}
          </ul>
          <ul className="changes" aria-label="Parameter changes">
            {(compare?.parameterChanges ?? []).map((c) => {
              const entry = manifest.find((m) => m.name === c.name);
              return entry ? <li key={c.name}>{changeLine(entry, c.base, c.head)}</li> : null;
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
