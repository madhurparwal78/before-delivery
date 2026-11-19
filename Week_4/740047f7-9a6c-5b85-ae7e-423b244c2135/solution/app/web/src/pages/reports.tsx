import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiFailure, get, post, isDefect, type LinkRecord, type Pen, type Revision } from "../api";
import { FlatChart, type ChartGeo, type ChartPin } from "../charts";
import { plural, remaining, utcDate, utcStamp } from "../format";
import { recentPens } from "../recent";
import { useLive } from "../shell";
import { Confirm, Dialog, useDialog, useInterval, useReducedMotion } from "../ui";

interface Pack { defects: ({ id: string; removed?: boolean; chart_x_m?: number; depth_m?: number; bearing_deg?: number })[] }
const packCache = new Map<string, ChartPin[]>();
const revealed = new Set<string>();

async function packPins(penId: string, n: number): Promise<ChartPin[]> {
  const key = `${penId}:${n}`;
  const known = packCache.get(key);
  if (known) return known;
  const pack = await get<Pack>(`/api/pens/${penId}/reports/${n}/pack`, { silent: true });
  const pins = pack.defects.filter((d) => !d.removed).map((d) => ({ id: d.id, chart_x_m: d.chart_x_m ?? 0, depth_m: d.depth_m ?? 0, bearing_deg: d.bearing_deg ?? 0 }));
  packCache.set(key, pins);
  return pins;
}

const geoOf = (pen: Pen): ChartGeo => ({ circumference_m: pen.circumference_m, net_depth_m: pen.net_depth_m, grid: pen.grid });

/** Each band rises and fades in once, the first time it scrolls into view. */
function useReveal(key: string, stagger: () => number) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(!reduced && !revealed.has(key));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pending) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      observer.disconnect();
      revealed.add(key);
      el.animate(
        [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
        { duration: 1000, delay: stagger() * 80, easing: "cubic-bezier(0.19, 1, 0.22, 1)", fill: "backwards" },
      );
      setPending(false);
    }, { threshold: 0.12 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [key, pending, stagger]);
  return { ref, className: pending ? "reveal-pending" : "" };
}

let batch = 0;
let batchTimer = 0;
const nextStagger = () => {
  const index = batch++;
  window.clearTimeout(batchTimer);
  batchTimer = window.setTimeout(() => { batch = 0; }, 50);
  return index;
};

export function ReportsPage() {
  const [pens, setPens] = useState<Pen[]>([]);
  const [penId, setPenId] = useState("");
  const [pen, setPen] = useState<Pen | null>(null);
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [links, setLinks] = useState<LinkRecord[] | null>(null);
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<LinkRecord | null>(null);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [working, setWorking] = useState<string[]>([]);
  const penSeq = useRef(0);
  const linkSeq = useRef(0);
  const penRef = useRef("");
  const alive = useRef(true);
  penRef.current = penId;

  useEffect(() => {
    alive.current = true;
    get<{ pens: Pen[] }>("/api/pens", { silent: true }).then((reply) => {
      if (!alive.current) return;
      setPens(reply.pens);
      const known = new Set(reply.pens.map((p) => p.id));
      setPenId((cur) => cur || recentPens().find((id) => known.has(id)) || reply.pens[0]?.id || "");
    }, () => undefined);
    return () => { alive.current = false; };
  }, []);

  const loadPen = useCallback(async (id: string) => {
    const mine = ++penSeq.current;
    try {
      const [detail, list] = await Promise.all([get<{ pen: Pen }>(`/api/pens/${id}`, { silent: true }), get<{ revisions: Revision[] }>(`/api/pens/${id}/reports`, { silent: true })]);
      if (alive.current && mine === penSeq.current) { setPen(detail.pen); setRevisions(list.revisions); }
    } catch { /* the next event loads again */ }
  }, []);

  const loadLinks = useCallback(async (id: string) => {
    const mine = ++linkSeq.current;
    try {
      const reply = await get<{ links: LinkRecord[] }>(`/api/pens/${id}/links`, { silent: true });
      if (alive.current && mine === linkSeq.current) setLinks(reply.links);
    } catch { /* the next refresh tries again */ }
  }, []);

  useEffect(() => {
    if (!penId) return;
    setPen(null);
    setRevisions(null);
    setLinks(null);
    setStatus("");
    void loadPen(penId);
    void loadLinks(penId);
  }, [penId, loadPen, loadLinks]);

  useInterval(() => { if (penRef.current) void loadLinks(penRef.current); }, 30000);
  useLive((event) => {
    const id = penRef.current;
    if (!id) return;
    if (event.type === "resync") { void loadPen(id); void loadLinks(id); }
    else if (event.type.startsWith("link.") && event.pen_id === id) void loadLinks(id);
    else if ((event.type === "revision.published" || event.type.startsWith("defect.")) && event.pen_id === id) void loadPen(id);
  });

  const inflight = useRef(new Set<string>());
  const guard = async (key: string, run: () => Promise<void>) => {
    if (inflight.current.has(key)) return;
    inflight.current.add(key);
    setWorking((w) => [...w, key]);
    try { await run(); } finally {
      inflight.current.delete(key);
      if (alive.current) setWorking((w) => w.filter((k) => k !== key));
    }
  };
  const describe = (error: unknown) => (error instanceof ApiFailure ? error.message : "");

  const publish = () => guard("publish", async () => {
    setStatus("Publishing…");
    try {
      const reply = await post<{ revision: Revision }>(`/api/pens/${penId}/reports`);
      setStatus(`Published revision ${reply.revision.number}`);
      await loadPen(penId);
    } catch (error) { setStatus(describe(error)); }
  });

  const restore = async (n: number) => {
    setRestoring(null);
    await guard("restore", async () => {
      setStatus("Restoring…");
      try {
        await post(`/api/pens/${penId}/restore`, { revision: n });
        setStatus(`Restored revision ${n}`);
        await loadPen(penId);
      } catch (error) { setStatus(describe(error)); }
    });
  };

  const createLink = async (seconds: number) => {
    await guard("create", async () => {
      setStatus("Working…");
      try {
        await post(`/api/pens/${penId}/links`, { expires_in_seconds: seconds });
        setStatus("Link created");
        setCreating(false);
        await loadLinks(penId);
      } catch (error) { setStatus(describe(error)); setCreating(false); }
    });
  };

  const regenerate = (link: LinkRecord) => guard(`regen:${link.id}`, async () => {
    setStatus("Working…");
    try {
      await post(`/api/links/${link.id}/regenerate`, { token: link.token });
      setStatus("Link regenerated — the old link no longer works");
    } catch (error) { setStatus(describe(error)); }
    await loadLinks(penId);
  });

  const revoke = async (link: LinkRecord) => {
    await guard(`revoke:${link.id}`, async () => {
      setStatus("Working…");
      try {
        await post(`/api/links/${link.id}/revoke`);
        setStatus("Link revoked");
      } catch (error) { setStatus(describe(error)); }
      setRevoking(null);
      await loadLinks(penId);
    });
  };

  const copy = async (link: LinkRecord) => {
    try {
      await navigator.clipboard.writeText(link.url);
    } catch {
      const area = document.createElement("textarea");
      area.value = link.url;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setStatus("Link copied");
  };

  const latest = revisions?.[0] ?? null;
  return (
    <div className="reports-page">
      <div className="reports-head">
        <h1 className="visually-hidden">Reports</h1>
        <label className="field"><span>Pen</span>
          <select aria-label="Pen" value={penId} onChange={(e) => setPenId(e.target.value)}>
            {pens.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-solid" aria-busy={working.includes("publish")} disabled={working.includes("publish")} onClick={() => void publish()}>Publish revision</button>
      </div>
      <p role="status" aria-label="Report status" className="report-status">{status}</p>
      {!pen || !revisions ? <div className="skeleton band-skeleton" aria-hidden="true" /> : (
        <>
          {latest ? <LatestRow pen={pen} revision={latest} /> : <section aria-label="Latest report" className="latest-empty"><h2 className="statement">No revision published yet</h2></section>}
          <div className="stats">
            <section aria-label="Condition grade" className="stat stat-olive">
              <h2>Condition grade</h2>
              <div className="stat-frame"><FlatChart name={pen.name} geo={geoOf(pen)} pins={pinsOf(pen)} labels={false} /></div>
              <span className="numeral num">{pen.grade.letter}</span>
            </section>
            <section aria-label="Open defects" className="stat stat-stone">
              <h2>Open defects</h2>
              <div className="stat-frame"><FlatChart name={pen.name} geo={geoOf(pen)} pins={pinsOf(pen)} labels={false} /></div>
              <span className="numeral num">{pen.open_defects}</span>
            </section>
          </div>
          {revisions.map((revision) => <Band key={revision.number} pen={pen} revision={revision} onRestore={() => setRestoring(revision.number)} />)}
        </>
      )}
      <section aria-label="Report links" className="links">
        <div className="links-head">
          <h2>Report links</h2>
          <button type="button" className="btn btn-solid" onClick={() => setCreating(true)}>Create report link</button>
        </div>
        {!links ? <div className="skeleton rows-skeleton" aria-hidden="true" /> : links.length === 0 ? (
          <h2 className="statement">No report links yet</h2>
        ) : (
          <ul role="list" className="plain link-rows">
            {links.map((link) => (
              <li key={link.id} className="link-row">
                <input type="text" readOnly aria-label="Report link URL" value={link.url} />
                <p className="num">{link.status === "active" ? `Active — expires ${utcStamp(link.expires_at)} (${remaining(link.expires_in_s)})` : link.status === "revoked" ? "Revoked" : "Expired"}</p>
                <div className="link-actions">
                  <button type="button" className="btn" onClick={() => void copy(link)}>Copy link</button>
                  <button type="button" className="btn" disabled={link.status !== "active"} onClick={() => void regenerate(link)}>Regenerate link</button>
                  <button type="button" className="btn" disabled={link.status === "revoked"} onClick={() => setRevoking(link)}>Revoke link</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {creating && <CreateDialog pending={working.includes("create")} onCreate={(s) => void createLink(s)} onClose={() => setCreating(false)} />}
      {revoking && (
        <Confirm title="Revoke link" action="Revoke" pending={working.includes(`revoke:${revoking.id}`)} onConfirm={() => void revoke(revoking)} onClose={() => setRevoking(null)}
          message="The farm manager's link stops working at once." />
      )}
      {restoring !== null && (
        <Confirm title="Restore revision" action="Restore" onConfirm={() => void restore(restoring)} onClose={() => setRestoring(null)}
          message={`Bring ${pen?.name ?? "the pen"} back to revision ${restoring}. Defects added since are removed.`} />
      )}
    </div>
  );
}

const pinsOf = (pen: Pen): ChartPin[] => (pen.defects ?? []).filter(isDefect).map((d) => ({ id: d.id, chart_x_m: d.chart_x_m, depth_m: d.depth_m, bearing_deg: d.bearing_deg }));

function usePack(penId: string, n: number): ChartPin[] {
  const [pins, setPins] = useState<ChartPin[]>(packCache.get(`${penId}:${n}`) ?? []);
  useEffect(() => {
    let live = true;
    packPins(penId, n).then((p) => live && setPins(p), () => undefined);
    return () => { live = false; };
  }, [penId, n]);
  return pins;
}

function LatestRow({ pen, revision }: { pen: Pen; revision: Revision }) {
  const pins = usePack(pen.id, revision.number);
  const reveal = useReveal(`latest:${pen.id}:${revision.number}`, nextStagger);
  return (
    <section ref={reveal.ref} aria-label="Latest report" className={`latest ${reveal.className}`}>
      <div className="latest-text">
        <p className="num label-light">{utcDate(revision.published_at)}</p>
        <h2>{pen.name} — Grade {revision.grade.letter}</h2>
        <p>{revision.open_defects} open {plural(revision.open_defects, "defect", "defects")}</p>
      </div>
      <div className="media-frame"><FlatChart name={pen.name} geo={geoOf(pen)} pins={pins} /></div>
    </section>
  );
}

function Band({ pen, revision, onRestore }: { pen: Pen; revision: Revision; onRestore: () => void }) {
  const pins = usePack(pen.id, revision.number);
  const reveal = useReveal(`band:${pen.id}:${revision.number}`, nextStagger);
  return (
    <section ref={reveal.ref} aria-label={`Revision ${revision.number}`} className={`band ${reveal.className}`}>
      <div className="band-text">
        <h2 className="band-title">Revision {revision.number}</h2>
        <p className="num label-light">{utcDate(revision.published_at)}</p>
        <p className="num">Grade {revision.grade.letter} · {revision.open_defects} open {plural(revision.open_defects, "defect", "defects")}</p>
        <div className="band-actions">
          <a className="btn" href={`/api/pens/${pen.id}/reports/${revision.number}/pack`} download>Download pack</a>
          <button type="button" className="btn" aria-label={`Restore revision ${revision.number}`} onClick={onRestore}>Restore</button>
        </div>
      </div>
      <div className="media-frame"><FlatChart name={`${pen.name} revision ${revision.number}`} geo={geoOf(pen)} pins={pins} /></div>
    </section>
  );
}

const EXPIRIES: [string, number][] = [["24 hours", 86400], ["7 days", 604800], ["30 days", 2592000]];

function CreateDialog({ pending, onCreate, onClose }: { pending: boolean; onCreate: (seconds: number) => void; onClose: () => void }) {
  const [seconds, setSeconds] = useState(86400);
  return (
    <Dialog title="Create report link" onClose={onClose}>
      <h2>Create report link</h2>
      <div role="radiogroup" aria-label="Expires in" className="radios">
        {EXPIRIES.map(([label, value]) => (
          <label key={label} className="radio">
            <input type="radio" name="expires" checked={seconds === value} onChange={() => setSeconds(value)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <CancelButton />
        <button type="button" className="btn btn-solid" disabled={pending} aria-busy={pending} onClick={() => onCreate(seconds)}>Create link</button>
      </div>
    </Dialog>
  );
}

function CancelButton() {
  const dialog = useDialog();
  return <button type="button" className="btn" onClick={() => dialog?.close()}>Cancel</button>;
}
