import { useState, type ReactElement } from "react";
import { todayOf, calendarKey } from "../../shared/time";
import { Link, navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { Plate } from "../ui/Plate";
import { SearchForm, type SearchValues } from "../ui/SearchForm";

export function HomePage(): ReactElement {
  const session = useSession();
  const today = todayOf(session.serverNow);
  const [values, setValues] = useState<SearchValues>({ from: "", to: "", date: today, seats: 1 });

  const submit = (): void => {
    const params = new URLSearchParams();
    if (values.from) params.set("from", values.from);
    if (values.to) params.set("to", values.to);
    params.set("date", calendarKey(values.date));
    params.set("seats", String(values.seats));
    navigate(`/search?${params}`);
  };

  return (
    <div className="home">
      <section className="hero" aria-label="Longseat">
        <h1 className="hero-title">
          <span className="hero-line one">Empty seats,</span> <span className="hero-line two">long roads.</span>
        </h1>
        <Link href="/search" className="split-button hero-cta">
          <span className="split-label">Find a seat</span>
          <span className="split-arrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22">
              <path d="M5 12h13m-5-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
            </svg>
          </span>
        </Link>
        <Plate
          seed="hesketh-mere-coast-road"
          scene="coast-road"
          ratio={1.6}
          className="hero-small"
          caption="Kestrevel to Hesketh Mere, the wet coast road outside Hesketh Mere"
        />
        <p className="hero-sentence muted">Share the drive between eight towns, at the price the distance sets.</p>
        <Plate
          seed="kestrevel-ferry-ramp"
          scene="rear-seat"
          ratio={0.8}
          className="hero-tall"
          caption="Vardholm to Kestrevel, a folded coat on the rear seat at the Kestrevel ferry ramp"
        />
      </section>

      <section className="home-search" aria-label="Plan a trip">
        <SearchForm values={values} today={today} onChange={setValues} onSubmit={submit} />
      </section>

      <section className="routes" aria-label="About the network">
        <article className="route route-one">
          <Plate
            seed="brisanne-tollemarch-straight"
            scene="long-road"
            ratio={1.5}
            caption="Brisanne to Tollemarch, the long straight past Oakhythe"
          />
          <div className="passage">
            <h2>Eight towns, one price per kilometre</h2>
            <p>
              A driver already making the two- or three-hour trip publishes it with its stopovers. A rider joining at a
              stopover pays for the distance they travel, not for the whole road.
            </p>
          </div>
        </article>
        <article className="route route-two">
          <Plate
            seed="kestrevel-oakhythe-fields"
            scene="fields"
            ratio={2.4}
            caption="Kestrevel to Oakhythe, the fields before the first climb"
          />
          <div className="passage">
            <h2>One seat, one decision</h2>
            <p>
              The server decides every hold, every refund and every deadline once. What you see on the page is what it
              decided, with the cancellation rule shown before you confirm.
            </p>
          </div>
        </article>
        <article className="route route-three">
          <Plate
            seed="tollemarch-corrandy-ramp"
            scene="ramp"
            ratio={0.8}
            caption="Tollemarch to Corrandy, the ferry ramp at the end of the line"
          />
          <div className="passage">
            <h2>Ratings nobody can answer back to</h2>
            <p>
              Driver and passenger rate each other after the trip. Neither sees the other&apos;s rating until both are in,
              so no one reviews second to retaliate.
            </p>
          </div>
        </article>
      </section>
    </div>
  );
}
