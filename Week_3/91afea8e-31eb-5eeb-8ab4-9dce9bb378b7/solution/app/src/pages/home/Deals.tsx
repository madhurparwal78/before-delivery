import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { usePhone, useReducedMotion } from "../../lib/hooks";
import type { Hit } from "../../lib/types";
import { promiseText, rupees } from "../../../shared/format";
import { useScrollSync } from "./scrollSync";
import type { DealsState } from "./useDeals";

const TONES = ["yellow", "pink", "black"] as const;
const FACES = 8;

type Mode = "pinned" | "swipe" | "list";

/** The `today only` label wrapped around a slowly turning CSS cylinder; flat under reduced motion. */
function TodayOnly({ flat }: { flat: boolean }): ReactNode {
  if (flat) return <span className="today today--flat">today only</span>;
  return (
    <span className="today" role="img" aria-label="today only">
      <span className="today__drum" aria-hidden="true">
        {Array.from({ length: FACES }, (_, face) => (
          <span key={face} className="today__face" style={{ transform: `rotateY(${(360 / FACES) * face}deg) translateZ(var(--drum-radius))` }}>
            today only
          </span>
        ))}
      </span>
    </span>
  );
}

function Deal({ hit, tone, flat }: { hit: Hit; tone: (typeof TONES)[number]; flat: boolean }): ReactNode {
  return (
    <li className={`deal deal--${tone}`}>
      <Link className="deal__link" to={`/p/${hit.product_id}`}>
        <span className="deal__copy">
          <TodayOnly flat={flat} />
          <span className="deal__title">{hit.title}</span>
          <span className="deal__price">{rupees(hit.price_paise)}</span>
          {hit.promise_date && <span className="deal__promise">arrives by {promiseText(hit.promise_date)}</span>}
        </span>
        <img className="deal__art" src={hit.image_url} alt="" width={400} height={400} />
      </Link>
    </li>
  );
}

/**
 * Pins the rail while vertical scroll becomes sideways travel: the section is as tall as the travel plus one screen,
 * the inner is sticky, and the track's position is a pure function of how far the section has scrolled.
 */
function usePinnedRail(active: boolean, section: RefObject<HTMLElement | null>, pin: RefObject<HTMLDivElement | null>, track: RefObject<HTMLUListElement | null>): void {
  const travel = useRef(0);
  const place = useCallback((): void => {
    const outer = section.current;
    const strip = track.current;
    if (!outer || !strip) return;
    const progress = travel.current === 0 ? 0 : Math.min(1, Math.max(0, -outer.getBoundingClientRect().top / travel.current));
    strip.style.transform = `translate3d(${-progress * travel.current}px, 0, 0)`;
  }, [section, track]);
  useScrollSync(active, place);

  useEffect(() => {
    const outer = section.current;
    const inner = pin.current;
    const strip = track.current;
    if (!active || !outer || !inner || !strip) return undefined;
    const measure = (): void => {
      travel.current = Math.max(0, strip.scrollWidth - inner.clientWidth);
      outer.style.height = `${travel.current + inner.clientHeight}px`;
      place();
    };
    const reveal = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || travel.current === 0) return;
      const left = target.closest("li")?.offsetLeft ?? 0;
      const pad = Number.parseFloat(getComputedStyle(strip).paddingLeft);
      const progress = Math.min(1, Math.max(0, (left - pad) / travel.current));
      window.scrollTo({ top: window.scrollY + outer.getBoundingClientRect().top + progress * travel.current, behavior: "instant" });
    };
    measure();
    strip.addEventListener("focusin", reveal);
    const watcher = new ResizeObserver(measure);
    watcher.observe(strip);
    watcher.observe(inner);
    return () => {
      strip.removeEventListener("focusin", reveal);
      watcher.disconnect();
      outer.style.height = "";
      strip.style.transform = "";
      travel.current = 0;
    };
  }, [active, section, pin, track, place]);
}

/** Today's Deals: pinned horizontal rail on tablet and desktop, swipeable scroll-snap on phones, a plain list in page flow under reduced motion. */
export function Deals({ state }: { state: DealsState }): ReactNode {
  const reduced = useReducedMotion();
  const phone = usePhone();
  const mode: Mode = reduced ? "list" : phone ? "swipe" : "pinned";
  const section = useRef<HTMLElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLUListElement>(null);
  usePinnedRail(mode === "pinned" && (state.deals?.length ?? 0) > 0, section, pin, track);

  return (
    <section className={`deals deals--${mode}`} ref={section} aria-labelledby="deals-title">
      <div className="deals__pin" ref={pin}>
        <h2 id="deals-title" className="deals__heading">
          Today's Deals
        </h2>
        {state.deals === null && <div className="skeleton deals__loading" aria-busy="true" />}
        {state.failure && state.deals?.length === 0 && <p className="deals__failure">{state.failure}</p>}
        {state.deals !== null && state.deals.length > 0 && (
          <ul className="deals__track" ref={track}>
            {state.deals.map((hit, index) => (
              <Deal key={hit.listing_id} hit={hit} tone={TONES[index % TONES.length] as (typeof TONES)[number]} flat={reduced} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
