import type { Grant, Portal } from "../../shared/types.js";
import { displayDate, displayInstant, groupThousands } from "../../shared/format.js";
import { useResource } from "../hooks.js";
import { Link } from "../router.js";
import { useSession } from "../session.js";
import { Band, CountedNumber, Countdown, groupedCount } from "../ui.js";
import { WarningStrips } from "./strips.js";

const TOPICS = ["grants", "registry", "board", "tenders", "orders", "people"];

function Tiles({ portal }: { portal: Portal }) {
  if ("vested_today" in portal) {
    return (
      <>
        <div className="tile tile-dark">
          <p className="tile-label">Vested today:</p>
          <p className="tile-figure">
            <CountedNumber value={String(portal.vested_today)} render={groupedCount} />
          </p>
          <p className="tile-extra">of {groupThousands(portal.total_options)}</p>
        </div>
        <div className="tile tile-red">
          {portal.next_tranche_date ? (
            <>
              <p className="tile-label">Next tranche</p>
              <p className="tile-date">{displayDate(portal.next_tranche_date)}</p>
            </>
          ) : (
            <p className="tile-date">Fully vested</p>
          )}
        </div>
      </>
    );
  }
  if ("exercisable" in portal) {
    return (
      <>
        <div className="tile tile-dark">
          <p className="tile-label">Exercisable now:</p>
          <p className="tile-figure">
            <CountedNumber value={String(portal.exercisable)} render={groupedCount} />
          </p>
        </div>
        <div className="tile tile-red">
          {portal.window_ends_at && <Countdown to={portal.window_ends_at} label="Exercise window" suffix=" left" done="Window closed" className="tile-date" />}
        </div>
      </>
    );
  }
  if ("ownership" in portal) {
    return (
      <>
        <div className="tile tile-dark">
          <p className="tile-label">Your fully diluted ownership:</p>
          <p className="tile-figure">{portal.ownership}%</p>
        </div>
        <div className="tile tile-red">
          {portal.open_tender ? (
            <>
              <p className="tile-label">Tender open until</p>
              <p className="tile-date tile-date-small">{displayInstant(portal.open_tender.closes_at)}</p>
            </>
          ) : (
            <p className="tile-date">No tender open</p>
          )}
        </div>
      </>
    );
  }
  if ("awaiting_vote" in portal) {
    return (
      <>
        <div className="tile tile-dark">
          <p className="tile-label">Grants awaiting your vote:</p>
          <p className="tile-figure">{portal.awaiting_vote}</p>
        </div>
        <div className="tile tile-red">
          <p className="tile-date">
            Quorum {portal.quorum} of {portal.board_size}
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="tile tile-dark">
        <p className="tile-label">Fully diluted:</p>
        <p className="tile-figure">
          <CountedNumber value={String(portal.fully_diluted_total)} render={groupedCount} />
        </p>
      </div>
      <div className="tile tile-red">
        <p className="tile-label">Offers to send:</p>
        <p className="tile-figure">{portal.offers_to_send}</p>
      </div>
    </>
  );
}

export function PortalPage() {
  const { person } = useSession();
  const portal = useResource<Portal>("/api/portal", TOPICS);
  const holds = person.role === "option_holder" || person.role === "leaver";
  const grants = useResource<{ grants: Grant[] }>(holds ? "/api/grants" : null, ["grants"]);
  if (!portal.data) {
    return (
      <main className="page-state">
        <Band tone="black" className="band-fill band-delayed">
          Loading your register.
        </Band>
      </main>
    );
  }
  const offers = (grants.data?.grants ?? []).filter((grant) => grant.state === "offered" || grant.state === "expired");
  return (
    <main className="portal">
      <WarningStrips grants={grants.data?.grants ?? []} />
      <section className="board" aria-label="Portal board">
        <div className="tile tile-name">
          <h1 tabIndex={-1} className="tile-name-heading">
            {portal.data.first_name}
          </h1>
        </div>
        <Tiles portal={portal.data} />
        <div className="tile tile-photos">
          <img src="/photos/hands-at-desk.jpg" alt="" />
          <img src="/photos/robot-arm-library.jpg" alt="" />
        </div>
      </section>
      {offers.length > 0 && (
        <section className="sheet" aria-label="Grant offers">
          <p className="note">Offers wait for an answer until the server's clock reaches their expiry.</p>
          <ul role="list" className="rows">
            {offers.map((grant) => (
              <li key={grant.id} className="row-item">
                <Link href={`/grants/${grant.id}`}>{grant.id}</Link>
                <span>{grant.state === "expired" ? "Expired" : `Offered, lapses at ${displayInstant(grant.offer_expires_at ?? "")}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
