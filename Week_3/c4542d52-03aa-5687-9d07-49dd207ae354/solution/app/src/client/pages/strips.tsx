import type { Grant } from "../../shared/types.js";
import { countdown, displayInstant } from "../../shared/format.js";
import { useServerTime } from "../live.js";
import { useSession } from "../session.js";

/** The red notices at the top of the content: an offer in its warning period, a leaver's window after a warning time. */
export function WarningStrips({ grants }: { grants: Grant[] }) {
  const { person } = useSession();
  const now = Date.parse(useServerTime());
  const offered = grants.find((grant) => grant.state === "offered" && grant.offer_warning_at && Date.parse(grant.offer_warning_at) <= now);
  const departure = person.departure;
  const windowGrant = grants.find((grant) => grant.state === "accepted" && grant.exercise_window_ends_at);
  const passed = departure && Date.parse(departure.window_ends_at) > now ? departure.warnings_at.filter((at) => Date.parse(at) <= now).at(-1) : undefined;
  return (
    <>
      {offered && offered.offer_expires_at && (
        <section className="strip" aria-label="Offer warning">
          <p>
            The offer for grant {offered.id} lapses at {displayInstant(offered.offer_expires_at)}. Accept or decline before then.
          </p>
        </section>
      )}
      {departure && windowGrant && passed && (
        <section className="strip" aria-label="Window warning">
          <p>
            Your exercise window on grant {windowGrant.id} closes in {countdown((Date.parse(departure.window_ends_at) - Date.parse(passed)) / 1000)}.
          </p>
        </section>
      )}
    </>
  );
}
