// A client reviewer's survey: header, chart, vessels, line files by vessel, downloads and flags.
import { useState } from "react";
import { api, NoResponse, Stale, type Coverage, type Holiday, type Line, type Mission, type Track } from "../api";
import { Chart } from "../components/Chart";
import { Dialog } from "../components/Dialog";
import { MissionHeader } from "../components/MissionHeader";
import { useAnnouncer, usePoll, useTier } from "../hooks";
import { navigate, useLocation } from "../router";
import { useServiceStatus } from "../services";
import { useSession } from "../session";
import { NotFound } from "./NotFound";

interface Data {
  mission: Mission;
  lines: Line[];
  coverage: Coverage;
  holidays: Holiday[];
  tracks: Track[];
}

export function Survey({ missionId }: { missionId: string }) {
  const { user } = useSession();
  const tier = useTier();
  const { search } = useLocation();
  const service = useServiceStatus();
  const [data, setData] = useState<Data | null | undefined>(undefined);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [flagging, setFlagging] = useState<Line | null>(null);
  const [announcements, announce] = useAnnouncer();

  usePoll(async () => {
    const base = `/api/missions/${missionId}`;
    const [m, l, c, h, t] = await Promise.all([
      api<Mission>(base), api<Line[]>(`${base}/lines`), api<Coverage>(`${base}/coverage`), api<Holiday[]>(`${base}/holidays`), api<{ tracks: Track[] }>(`${base}/tracks`),
    ]);
    if (m.status === 404) {
      setData(null);
      return;
    }
    if (m.ok && l.ok && c.ok && h.ok && t.ok) setData({ mission: m.data, lines: l.data, coverage: c.data, holidays: h.data, tracks: t.data.tracks });
  }, 5000, [missionId]);

  if (data === null) return <NotFound />;
  if (!data) return <main className="page"><p className="muted">Loading survey…</p></main>;
  const { mission, lines } = data;

  const wanted = new URLSearchParams(search).get("vessel");
  const known = mission.vessels.some((v) => v.id === wanted);
  const filter = wanted && known ? wanted : null;
  const fileRows = lines.filter((l) => ["Surveyed", "Delivered", "Superseded"].includes(l.status) && (!filter || l.vessel_id === filter));
  const storageDown = service?.storage === "down";
  // Each vessel's marker sits at the last point of its track on this mission.
  const lastPoints = new Map<string, Track["points"][number]>();
  for (const t of data.tracks) {
    const last = t.points[t.points.length - 1];
    const seen = lastPoints.get(t.vessel_id);
    if (last && (!seen || last.t > seen.t)) lastPoints.set(t.vessel_id, last);
  }
  const markers = [...lastPoints.entries()].map(([id, p]) => ({
    id, name: mission.vessels.find((v) => v.id === id)?.name ?? "", position: { easting: p.easting, northing: p.northing }, heading: 0,
  }));

  const download = (label: string, href: string, name: string) => storageDown
    ? <button type="button" disabled aria-label={name}>Storage unavailable</button>
    : <a className="button" href={href} download aria-label={name}>{label}</a>;

  return (
    <main className={tier === "wide" ? "survey-wide" : "page"}>
      <MissionHeader mission={mission} />
      <div className={tier === "wide" ? "survey-grid" : "survey-stack"}>
        <div className="survey-chart">
          <Chart data={{ areas: [{ id: mission.id, area: mission.survey_area, fence: mission.geofence }], lines, tracks: data.tracks, coverage: data.coverage,
            holidays: data.holidays.filter((h) => h.status !== "Closed"), markers }} units={user.units} />
        </div>
        <div className="survey-lists page">
          <section aria-labelledby="vessels-heading">
            <h2 id="vessels-heading">Vessels</h2>
            <ul aria-label="Vessels" className="slip-rows">
              {mission.vessels.map((v) => <li key={v.id}><span>{v.name}</span><span className="state-word">{v.link_state ?? "Off survey"}</span></li>)}
            </ul>
          </section>
          <div className="field">
            <label htmlFor="vessel-filter">Vessel</label>
            <div className="row">
              <select id="vessel-filter" value={filter ?? ""} onChange={(e) => {
                const p = new URLSearchParams(search);
                if (e.target.value) p.set("vessel", e.target.value);
                else p.delete("vessel");
                const q = p.toString();
                navigate(`/surveys/${mission.id}${q ? `?${q}` : ""}`, { replace: true });
              }}>
                <option value="">All vessels</option>
                {[...mission.vessels].sort((a, b) => a.name.localeCompare(b.name)).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {wanted && !known && <span>No such vessel on this survey</span>}
            </div>
          </div>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Line files table">
            <table aria-label="Line files">
              <thead><tr><th>Line</th><th>Vessel</th><th>Status</th><th>File</th><th>Size</th><th>SHA-256</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {fileRows.map((l) => (
                  <tr key={l.id}>
                    <td>{l.label}</td>
                    <td>{l.vessel_name}</td>
                    <td>{l.status}</td>
                    <td>{l.file?.state ?? ""}</td>
                    <td className="num">{l.file?.size_bytes != null ? `${l.file.size_bytes} bytes` : ""}</td>
                    <td className="num bytes">{l.file?.sha256 ? `SHA-256 ${l.file.sha256}` : ""}</td>
                    <td>
                      <div className="row">
                        {l.file?.state === "Stored" && download(`Download ${l.label}`, `/api/lines/${l.id}/file`, `Download ${l.label}`)}
                        {l.status === "Delivered" && (flagged.has(l.id) ? <span>Flagged</span>
                          : <button type="button" aria-label={`Flag ${l.label}`} onClick={() => setFlagging(l)}>Flag</button>)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section aria-labelledby="report-heading" className="section">
            <h2 id="report-heading">Coverage report</h2>
            {mission.report.state === "Ready" ? download("Download coverage report", `/api/missions/${mission.id}/report`, "Download coverage report")
              : mission.report.state === "Pending" ? <p>Coverage report is being prepared</p>
                : <p className="muted">The coverage report is written when the mission is complete.</p>}
          </section>
          <div className="sr-only" role="status" aria-live="polite" aria-label="Survey announcements">{announcements.join(" ")}</div>
        </div>
      </div>
      {flagging && <FlagDialog line={flagging} missionId={mission.id} onClose={() => setFlagging(null)} onSent={(line) => {
        setFlagged((s) => new Set(s).add(line.id));
        announce(`Flag sent for ${line.label}`);
        setFlagging(null);
      }} />}
    </main>
  );
}

const SPOKEN_AT = [450, 490, 500];

function FlagDialog({ line, missionId, onClose, onSent }: { line: Line; missionId: string; onClose: () => void; onSent: (line: Line) => void }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    try {
      const r = await api(`/api/missions/${missionId}/lines/${line.id}/flags`, { method: "POST", body: { comment } });
      if (r.ok) onSent(line);
      else setError(r.error?.errors?.comment ?? r.error?.message ?? null);
    } catch (e) {
      if (e instanceof NoResponse) setError(`Could not reach Swathdeck — the flag on ${line.label} is not sent yet`);
      else if (!(e instanceof Stale)) throw e;
    }
  };
  return (
    <Dialog label="Flag line" onClose={onClose}>
      <h2>Flag line</h2>
      <p className="muted">{line.label}</p>
      <div className="field">
        <label htmlFor="comment">Comment</label>
        <textarea id="comment" value={comment} maxLength={500} onChange={(e) => {
          setComment(e.target.value);
        }} />
        <p role="status" aria-live={SPOKEN_AT.includes(comment.length) ? "polite" : "off"} aria-label="Comment length" className="num">{comment.length}/500</p>
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void send()}>Send flag</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
