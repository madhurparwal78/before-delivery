// The Fleet region: one card per vessel, updated in place as fixes arrive.
import type { Vessel } from "../api";
import { useSession } from "../session";
import { hours, position, speed } from "../units";

interface Props {
  vessels: Vessel[];
  coverageOf: (missionId: string | null) => number | null;
  selected?: string | null;
  onOpen?: (vesselId: string) => void;
}

export function VesselCards({ vessels, coverageOf, selected = null, onOpen }: Props) {
  const { user } = useSession();
  return (
    <section className="fleet" aria-labelledby="fleet-heading">
      <h2 id="fleet-heading" className="sr-only">Fleet</h2>
      <ul className="cards" aria-label="Vessels">
        {vessels.map((v) => {
          const coverage = coverageOf(v.mission_id);
          return (
            <li key={v.id}>
              <div className="card" aria-current={selected === v.id ? "true" : undefined}>
                <button type="button" className="card-open" onClick={() => onOpen?.(v.id)} aria-label={v.name}>
                  {v.name}
                </button>
                <p className="card-line"><span className="state-word">{v.link_state}</span><span>{v.afloat ? "Afloat" : "Ashore"}</span></p>
                {v.last_fix ? (
                  <>
                    <p className="card-line"><span className="num">{position(v.last_fix.position, user.units)}</span></p>
                    <p className="card-line">
                      <span>Speed <span className="num">{speed(v.last_fix.speed_mps, user.units)}</span></span>
                      <span>Battery <span className="num">{v.last_fix.battery_pct.toFixed(0)} %</span></span>
                    </p>
                  </>
                ) : <p className="card-line muted">No fix yet</p>}
                <p className="card-line"><span>Coverage <span className="num">{coverage === null ? "—" : `${coverage}%`}</span></span></p>
                <p className="card-line"><span><span className="num">{hours(v.hours_since_service)}</span> since service</span></p>
                {v.service_overdue && <p className="overdue-note">Service overdue</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
