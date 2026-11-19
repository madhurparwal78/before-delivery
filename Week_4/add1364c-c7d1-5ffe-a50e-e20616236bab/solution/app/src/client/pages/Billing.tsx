import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "../lib/api";
import { useTitle } from "../lib/hooks";
import { officeDateYear } from "../lib/office";
import { useEvent, useStore } from "../lib/store";
import type { Billing as BillingData } from "../lib/types";

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

/** The one inverted band for a lasting outage; it slides in from the folder edge and back out. */
export function OutageBand({ text, show }: { text: string; show: boolean }) {
  const { reduced } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(show);
  const [shownText, setShownText] = useState(text);
  useEffect(() => {
    if (show) { setShownText(text); setMounted(true); }
  }, [show, text]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !mounted) return;
    if (show) {
      if (!reduced) el.animate([{ transform: "translateY(-100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], { duration: 300, easing: EASE });
      return;
    }
    if (reduced) { setMounted(false); return; }
    const out = el.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], { duration: 300, easing: EASE, fill: "forwards" });
    out.onfinish = () => setMounted(false);
  }, [show, mounted, reduced]);
  if (!mounted) return null;
  return <div ref={ref} role="alert" className="band outage-band">{shownText}</div>;
}

export function BillingBand() {
  return <OutageBand show text="Billing can't be reached. Seat changes wait here and are not counted until billing confirms them." />;
}

export function Billing() {
  useTitle("Billing");
  const [data, setData] = useState<BillingData | null>(null);
  const load = useCallback(async () => { setData(await get<BillingData>("/api/billing")); }, []);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  useEvent("billing-changed", () => { void load().catch(() => undefined); });
  useEvent("seat-confirmed", () => { void load().catch(() => undefined); });
  const down = data !== null && !data.reachable;
  const dash = "—";
  return (
    <div className="folder-page">
      {down ? <BillingBand /> : null}
      <section className="folder band-0">
        <header className="folder-title"><h1>Billing</h1></header>
        <div className="slip billing-slip">
          <div className="fig-block">
            <span className="cap">Seats in use</span>
            <span className="big fig">{data && data.seats !== null ? data.seats : dash}</span>
          </div>
          <div className="fig-block">
            <span className="cap">Next invoice</span>
            <span className="big fig">{data?.next_invoice ? `$${data.next_invoice.amount}` : dash}</span>
            <span className="fig">{data?.next_invoice ? `on ${officeDateYear(data.next_invoice.date)}` : ""}</span>
          </div>
          <div className="fig-block">
            <span className="cap">Licence term ends</span>
            <span className="big fig">{data?.licence_term_ends_on ? officeDateYear(data.licence_term_ends_on) : dash}</span>
          </div>
          <p className="muted price-line fig">{data ? `${data.currency} $${data.seat_price} per seat, per year` : ""}</p>
        </div>
        <h2 className="list-title">Changes waiting on billing</h2>
        {data && data.waiting.length === 0 ? <p className="muted pad">Nothing is waiting on billing.</p> : null}
        <ul className="slips plain-slips" aria-label="Waiting on billing">
          {(data?.waiting ?? []).map((w) => (
            <li className="slip wait-slip" key={`${w.person_id}-${w.change}`}>
              <strong>{w.name}</strong>
              <span>{w.change === "add" ? "Waiting on billing" : "Release waiting on billing"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
