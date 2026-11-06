import { data, useLoaderData } from "react-router";
import { Icon } from "../icons.jsx";
import { Legend, MonthGrid } from "../month.jsx";
import { Page } from "../page.jsx";

const SCREEN = "Team calendar";

export async function loader({ request, context }) {
  const search = new URL(request.url).search;
  const { month, days, people, narrowed } = await context.desk.teamMonth(context.caller, search).catch((error) => {
    throw error.status === 403 || error.status === 400 ? data({ crumb: SCREEN }, { status: error.status }) : error;
  });
  return {
    month,
    days,
    people: people.map(({ name, work_address }) => ({ name, work_address })),
    narrowed: narrowed && { id: narrowed.id, work_address: narrowed.work_address },
    publicUrl: context.desk.publicUrl,
  };
}

function shift(month, by) {
  const [year, mon] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, mon - 1 + by, 1));
  return moved.toISOString().slice(0, 7);
}

export default function CalendarScreen() {
  const { month, days, people, narrowed, publicUrl } = useLoaderData();
  const step = (by) => {
    const params = new URLSearchParams({ month: shift(month, by) });
    if (narrowed) params.set("person", narrowed.work_address);
    return `/calendar?${params}`;
  };
  return (
    <Page title={SCREEN} crumb={SCREEN}>
      <div className="screen-head">
        <h1>{SCREEN}</h1>
      </div>
      <div className="cal-tools">
        <div className="month-steps">
          <a className="btn" href={step(-1)}>
            <Icon name="chevron-right" className="flip" />
            Previous month
          </a>
          <a className="btn" href={step(1)}>
            Next month
            <Icon name="chevron-right" />
          </a>
        </div>
        <form className="cal-person" method="get" action="/calendar">
          <input type="hidden" name="month" value={month} />
          <div className="field">
            <label className="label" htmlFor="cal-person">Person</label>
            <select id="cal-person" name="person" defaultValue={narrowed?.work_address ?? ""}>
              <option value="">Everyone in scope</option>
              {people.map((p) => <option key={p.work_address} value={p.work_address}>{p.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn primary">
            <Icon name="user" />
            Show
          </button>
          {narrowed && (
            <button type="button" className="btn" data-share={narrowed.id} data-month={month}
              data-public-url={publicUrl || undefined}>
              <Icon name="link" />
              Share this month
            </button>
          )}
        </form>
      </div>
      {narrowed && (
        <div className="sharing">
          <p className="inline-alert" data-share-refusal hidden />
          <div className="shared-link" data-shared hidden>
            <div className="field">
              <label className="label" htmlFor="shared-link">Shared link</label>
              <textarea id="shared-link" readOnly rows={1} spellCheck={false} />
            </div>
            <button type="button" className="btn" data-revoke>
              <Icon name="cross" />
              Revoke link
            </button>
          </div>
        </div>
      )}
      <MonthGrid month={month} days={days} />
      <Legend />
    </Page>
  );
}
