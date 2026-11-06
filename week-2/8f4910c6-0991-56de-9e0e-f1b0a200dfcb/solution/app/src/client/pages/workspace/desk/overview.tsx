// The director's overview (/workspace/overview): per office, held days ahead, bookings this month, licence
// counts by status and statements due for last month.

import { useEffect, useState } from "react";
import { api } from "../../../api.js";
import { Link, definePage } from "../../../router.js";
import { Shell } from "../../../workspace/shell.js";
import { formatMonth } from "../../../../shared/format.js";
import { OFFICES, OFFICE_IDS, addMonthsToMonth, type OfficeId } from "../../../../shared/zones.js";
import { isLive, useOfficeToday, type Booking, type Ladder, type TalentSummary } from "./common.js";
import { useResource } from "../../../workspace/data.js";

interface Figures {
  held: number | null;
  bookings: number | null;
  due: number | null;
}

/** Days in the next 14 that hold at least one live option, across the office's active talent. */
async function heldDays(office: OfficeId, today: string): Promise<number> {
  const roster = await api<{ talent: TalentSummary[] }>("GET", `/api/talent?office=${office}&state=active`);
  if (!roster.ok) return 0;
  let held = 0;
  for (let i = 0; i < roster.data.talent.length; i += 8) {
    const ladders = await Promise.all(roster.data.talent.slice(i, i + 8).map((t) =>
      api<Ladder>("GET", `/api/talent/${t.id}/ladder?from=${today}&days=14`)));
    for (const ladder of ladders) {
      if (ladder.ok) held += ladder.data.days.filter((day) => day.options.some(isLive)).length;
    }
  }
  return held;
}

function OfficeTiles({ office }: { office: OfficeId }) {
  const [figures, setFigures] = useState<Figures>({ held: null, bookings: null, due: null });
  const today = useOfficeToday(office);
  useEffect(() => {
    if (!today) return;
    const month = today.slice(0, 7);
    const last = addMonthsToMonth(month, -1);
    void api<{ bookings: Booking[] }>("GET", `/api/bookings?office=${office}&month=${month}`).then((result) =>
      setFigures((f) => ({ ...f, bookings: result.ok ? result.data.bookings.length : 0 })));
    void api<{ bookings: Booking[] }>("GET", `/api/bookings?office=${office}&month=${last}`).then((result) =>
      setFigures((f) => ({ ...f, due: result.ok
        ? new Set(result.data.bookings.flatMap((b) => b.talent.map((t) => t.talentId))).size : 0 })));
    void heldDays(office, today).then((held) => setFigures((f) => ({ ...f, held })));
  }, [office, today]);
  const month = today?.slice(0, 7) ?? "";
  const show = (value: number | null) => (value === null ? "…" : String(value));
  return (
    <section className="office-overview" aria-labelledby={`overview-${office}`}>
      <h2 id={`overview-${office}`} className="section-title">{OFFICES[office].city}</h2>
      <div className="tiles">
        <p className="tile"><span className="tile-label">Days held, next 14 days</span> <span className="tile-count num">{show(figures.held)}</span></p>
        <p className="tile"><span className="tile-label">Bookings this month</span> <span className="tile-count num">{show(figures.bookings)}</span></p>
        <p className="tile"><span className="tile-label">Statements due{month ? ` for ${formatMonth(addMonthsToMonth(month, -1))}` : ""}</span>{" "}
          <span className="tile-count num">{show(figures.due)}</span></p>
      </div>
      <p className="muted">
        <Link href={`/workspace/board?office=${office}`}>Open the {OFFICES[office].city} board</Link>{" · "}
        <Link href={`/workspace/bookings?office=${office}&month=${month || "all"}`}>Bookings{month ? ` in ${formatMonth(month)}` : ""}</Link>
      </p>
    </section>
  );
}

function OverviewPage() {
  const licences = useResource<{ counts: Record<string, number> }>("/api/licences?status=expiring");
  const counts = licences.data?.counts ?? null;
  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">Both offices at a glance</p>
        <h1>Overview</h1>
      </div>
      <section className="office-overview" aria-labelledby="overview-licences">
        <h2 id="overview-licences" className="section-title">Licence exposure</h2>
        <div className="tiles">
          <p className="tile"><span className="tile-label">Active</span> <span className="tile-count num">{counts?.active ?? "…"}</span></p>
          <p className="tile"><span className="tile-label">Expiring</span> <span className="tile-count num">{counts?.expiring ?? "…"}</span></p>
          <p className="tile"><span className="tile-label">Expired</span> <span className="tile-count num">{counts?.expired ?? "…"}</span></p>
        </div>
        <p className="muted"><Link href="/workspace/licences">Open licences</Link></p>
      </section>
      {OFFICE_IDS.map((office) => <OfficeTiles key={office} office={office} />)}
    </Shell>
  );
}

definePage({ pattern: "/workspace/overview", kind: "workspace", roles: ["agency_director"], render: () => <OverviewPage /> });
