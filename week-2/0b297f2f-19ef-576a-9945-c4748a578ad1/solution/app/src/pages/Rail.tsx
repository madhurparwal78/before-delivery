import { formatLength } from "../../shared/units";
import { luxText, photoCount, statusText } from "../format";
import { say } from "../copy";
import { Link } from "../ui/Shell";
import { Button } from "../ui/Button";
import { cardActions } from "./permissions";
import type { ObjectRecord, Placement, Staff } from "../types";
import type { Unit } from "../../shared/units";

export interface RailActions {
  place: (o: ObjectRecord, opener: HTMLElement) => void;
  claim: (p: Placement) => void;
  release: (p: Placement) => void;
  hang: (p: Placement) => void;
  signOff: (p: Placement) => void;
  attach: (o: ObjectRecord, file: File, input: HTMLInputElement) => void;
}

interface RailProps {
  objects: ObjectRecord[] | null;
  placements: Map<string, Placement>;
  staff: Staff | null;
  unit: Unit;
  pending: Set<string>;
  uploading: Set<string>;
  actions: RailActions;
}

export function Rail({ objects, placements, staff, unit, pending, uploading, actions }: RailProps) {
  return (
    <section aria-label="Objects" className="rail" id="objects-rail">
      <h2 className="rail-title">Objects</h2>
      {!objects ? (
        <div className="skeleton-list" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : (
        <ul aria-label="Objects" className="cards">
          {objects.map((o) => {
            const p = o.placementId ? placements.get(o.placementId) : undefined;
            const can = cardActions(staff, p);
            const status = p ? statusText(p.status, p.claimedBy?.name ?? null) : statusText(null, null);
            const headingId = `card-${o.id}`;
            const busy = (verb: string) => (p ? pending.has(`${verb}:${p.id}`) : false);
            return (
              <li key={o.id} className="card" aria-labelledby={headingId} data-object-id={o.id}>
                <h3 id={headingId} tabIndex={-1} className="card-title">
                  {o.title}
                </h3>
                <dl className="card-facts">
                  <div>
                    <dt>Object number</dt>
                    <dd>{o.objectNumber}</dd>
                  </div>
                  <div>
                    <dt>Lender</dt>
                    <dd>{o.lenderName ?? "Ashgrove collection"}</dd>
                  </div>
                  <div>
                    <dt>Dimensions</dt>
                    <dd>
                      {formatLength(o.widthMm, unit)} × {formatLength(o.heightMm, unit)}
                    </dd>
                  </div>
                  <div>
                    <dt>Lux limit</dt>
                    <dd>{luxText(o.luxLimit)}</dd>
                  </div>
                </dl>
                <p className="card-status">
                  <span className={`status-dot status-${p?.status ?? "none"}`} aria-hidden="true" />
                  {status}
                </p>
                <p className="card-photos">{photoCount(o.photos.length)}</p>
                {uploading.has(o.id) && <p className="card-uploading">{say.uploading}</p>}
                <div className="card-actions">
                  {can.place && (
                    <Button tone="primary" data-action="Place" onClick={(e) => actions.place(o, e.currentTarget)}>
                      Place
                    </Button>
                  )}
                  {can.claim && p && (
                    <Button tone="primary" data-action="Claim" busy={busy("claim")} onClick={() => actions.claim(p)}>
                      Claim
                    </Button>
                  )}
                  {can.release && p && (
                    <Button data-action="Release" busy={busy("release")} onClick={() => actions.release(p)}>
                      Release
                    </Button>
                  )}
                  {can.hang && p && (
                    <Button tone="primary" data-action="Mark hung" busy={busy("hang")} onClick={() => actions.hang(p)}>
                      Mark hung
                    </Button>
                  )}
                  {can.signOff && p && (
                    <Button tone="primary" data-action="Sign off" busy={busy("sign-off")} onClick={() => actions.signOff(p)}>
                      Sign off
                    </Button>
                  )}
                </div>
                {can.photo && (
                  <label className="photo-input">
                    <span className="photo-input-text" aria-hidden="true">
                      Add condition photo
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      aria-label={`Condition photo for ${o.title}`}
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        if (file) actions.attach(o, file, e.currentTarget);
                      }}
                    />
                  </label>
                )}
                <Link href={`/records/${o.id}`} className="card-link">
                  Open record
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
