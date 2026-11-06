// A talent's own calendar (/workspace/me): their next 14 days read-only, the private feed link and its
// regeneration, and the way to their statements.

import { useState } from "react";
import { api } from "../../../api.js";
import { Link, definePage } from "../../../router.js";
import { sessionCopy } from "../../../session.js";
import { Shell } from "../../../workspace/shell.js";
import { Button } from "../../../ui/button.js";
import { StatusLine, useAnnouncer } from "../../../ui/status.js";
import { formatDate, formatMonth, formatOfficeTime, ordinal } from "../../../../shared/format.js";
import { isLive, useOfficeToday, type Ladder } from "./common.js";
import { useResource, useMember } from "../../../workspace/data.js";

function MyCalendarPage() {
  const member = useMember();
  const office = member.office;
  const today = useOfficeToday(office);
  const talentId = member.talentId ?? "";
  const ladder = useResource<Ladder>(talentId && today ? `/api/talent/${talentId}/ladder?from=${today}&days=14` : null);
  const feed = useResource<{ url: string }>("/api/me/calendar-feed");
  const { message, announce } = useAnnouncer();
  const [pending, setPending] = useState(false);
  const month = today?.slice(0, 7) ?? "";

  const regenerate = async () => {
    setPending(true);
    const result = await api<{ url: string }>("POST", "/api/me/calendar-feed", {});
    setPending(false);
    if (result.ok) {
      feed.setData(result.data);
      announce("New feed link ready. The old link no longer works.");
      return;
    }
    announce(sessionCopy(result.error) ?? "The feed link was not changed. Try again.");
  };

  const days = (ladder.data?.days ?? []).map((day) => ({
    ...day,
    shown: day.options.filter((o) => isLive(o) || o.state === "confirmed").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
  }));

  return (
    <Shell>
      <div className="workspace-head">
        <p className="eyebrow">{member.name}</p>
        <h1>My calendar</h1>
      </div>
      <StatusLine name="Calendar" message={message} />
      <section className="feed-panel" aria-labelledby="feed-title">
        <h2 id="feed-title" className="section-title">Calendar feed</h2>
        <p className="muted">Subscribe to this private link in your calendar app. Options show as tentative, bookings as confirmed.</p>
        <div className="field">
          <label htmlFor="feed-link">Feed link</label>
          <input id="feed-link" className="input" type="text" readOnly value={feed.data?.url ?? ""}
            onFocus={(event) => event.currentTarget.select()} />
        </div>
        <div className="btn-row">
          <Button variant="quiet" pending={pending} pendingLabel="Creating new link…" onClick={() => void regenerate()}>
            Regenerate feed link</Button>
          {month ? <Link href={`/workspace/statements/${talentId}/${month}`}>My statement for {formatMonth(month)}</Link> : null}
        </div>
      </section>
      <h2 className="section-title">Next 14 days</h2>
      {!ladder.data ? <p className="muted">Loading your days…</p> : (
        <ul className="rows my-days">
          {days.map((day) => (
            <li key={day.date} className="row-line">
              <span className="tnum my-day">{formatDate(day.date)}</span>
              <span>
                {day.shown.length ? day.shown.map((option) => (
                  <span key={option.id} className="my-option">
                    {option.state === "confirmed"
                      ? `Booked: ${option.jobTitle} for ${option.clientCompany}`
                      : `${ordinal(option.rank ?? 1)} option: ${option.jobTitle} for ${option.clientCompany}, releases ${
                        formatOfficeTime(option.releaseAt, office)}`}
                  </span>
                )) : <span className="muted">Free</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

definePage({ pattern: "/workspace/me", kind: "workspace", roles: ["talent"], render: () => <MyCalendarPage /> });
