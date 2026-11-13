import { Figure, FigureStack } from "../components/Figures.tsx";
import { Page } from "../components/Shell.tsx";
import { api, districtTime, navigate, usePoll } from "../lib.ts";
import type { DeliveryWindow, Restriction } from "../types.ts";

export function RestrictionPage({ id }: { id: string }) {
  const found = usePoll(
    () => api<{ restriction: Restriction; window: DeliveryWindow; moved_orders: string[] }>(`/api/restrictions/${encodeURIComponent(id)}`),
    [id],
  );
  const data = found.data;
  const w = data?.window;
  const announcement = data && w
    ? `Restriction published for ${w.channel_name}, ${w.label}. ${data.moved_orders.length} orders moved to requested.`
    : "";

  if (found.failure?.status === 404) {
    return (
      <Page title="Restriction not found">
        <p>There is no restriction {id}.</p>
      </Page>
    );
  }

  const lead = (
    <section className="lead" aria-label="Window remaining">
      <FigureStack>
        <Figure label="Remaining ML" value={w?.remaining_ml ?? "…"} unit="ML" size="xl" />
      </FigureStack>
    </section>
  );

  return (
    <Page title={w ? `Restriction on ${w.channel_name}` : "Restriction"} lead={lead}>
      <p role="status" aria-label="Board status" className="status-line status-banner">{announcement}</p>
      {data && w && (
        <div className="record card-sheet">
          <p className="record-status"><span className="badge badge-alert">Restricted</span></p>
          <dl className="facts">
            <div><dt>Channel</dt><dd>{w.channel_name}</dd></div>
            <div><dt>Window</dt><dd>{w.label}</dd></div>
            <div><dt>Cap</dt><dd className="num">{data.restriction.cap_ml_day} ML/day</dd></div>
            <div><dt>Reason</dt><dd>{data.restriction.reason}</dd></div>
            <div><dt>Effective</dt><dd>{districtTime(data.restriction.effective_at)}</dd></div>
            <div><dt>Cap volume</dt><dd className="num">{w.cap_volume_ml} ML</dd></div>
          </dl>
          <h2 className="panel-title">Moved orders</h2>
          {data.moved_orders.length ? (
            <ul className="rows">
              {data.moved_orders.map((n) => (
                <li key={n} className="row-item">
                  <a className="link" href={`/orders/${n}`} onClick={(e) => { e.preventDefault(); navigate(`/orders/${n}`); }}>{n}</a>
                  <span className="badge badge-requested">Requested</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No orders had to move.</p>
          )}
          <p>
            <a className="link" href={`/board?channels=${w.channel_id}&window=${w.id}`} onClick={(e) => { e.preventDefault(); navigate(`/board?channels=${w.channel_id}&window=${w.id}`); }}>
              Back to the board
            </a>
          </p>
        </div>
      )}
    </Page>
  );
}
