import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { QuoteSheet, type SheetFigures, type SheetState } from "../components/QuoteSheet";
import { STUDIO_EMAIL } from "../components/Chrome";
import { api, RequestError } from "../lib/api";
import { prefersReducedMotion } from "../lib/motion";
import { navigate } from "../lib/router";
import { COPY, copyFor } from "../../shared/copy";
import type { EntrySummary, Order, PlanId, Quote, Tier } from "../../shared/domain";
import { money, type Currency } from "../../shared/money";
import { useDeck } from "./deck";
import { lift, playLift, returning } from "./lift";
import { FoldMotif } from "./FoldMotif";

type Choice = "launch-page" | "studio-site" | "care";

interface Listing {
  currency: Currency;
  plans: { plan: PlanId; name: string; amount: string; interval: "month" | null }[];
}

const listings: Partial<Record<Currency, Listing>> = {};

function resolve(choice: Choice, tier: Tier): PlanId {
  return choice === "care" ? (tier === "lite" ? "care-lite" : "care-plus") : choice;
}

function Deck() {
  const { entries, failed } = useDeck();
  const list = useRef<HTMLUListElement>(null);

  useLayoutEffect(() => {
    const slug = returning.slug;
    if (!slug || !entries) return;
    if (window.location.hash) {
      returning.slug = null;
      return;
    }
    const link = list.current?.querySelector<HTMLAnchorElement>(`a[data-slug="${CSS.escape(slug)}"]`);
    if (!link) return;
    returning.slug = null;
    const card = link.closest<HTMLElement>(".card")!;
    card.scrollIntoView({ block: "center" });
    link.focus({ preventScroll: true });
    if (!prefersReducedMotion()) playLift(card, "close");
  }, [entries]);

  const open = (event: MouseEvent<HTMLAnchorElement>, entry: EntrySummary) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>(".card")!;
    lift.slug = entry.slug;
    lift.rect = prefersReducedMotion() ? null : card.getBoundingClientRect();
    lift.entry = entry;
    navigate(`/work/${entry.slug}`, { state: { fromHome: true } });
    window.scrollTo(0, 0);
  };

  if (failed && !entries) return <p className="notice notice--seam">{COPY.cmsOutage}</p>;
  if (!entries) {
    return (
      <ul className="deck" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <li key={i} className="card card--skeleton" />
        ))}
      </ul>
    );
  }
  if (!entries.length) {
    return (
      <div className="empty">
        <FoldMotif />
        <p>New case studies are on the way.</p>
      </div>
    );
  }
  return (
    <ul className="deck" aria-label="Case studies" ref={list}>
      {entries.map((entry) => (
        <li key={entry.slug} className="card">
          <p className="card__meta">
            {entry.client} · <span className="mono">{entry.year}</span>
          </p>
          <h3 className="card__title">
            <a href={`/work/${entry.slug}`} data-slug={entry.slug} className="card__link" onClick={(event) => open(event, entry)}>
              {entry.title}
            </a>
          </h3>
          <p className="card__summary">{entry.summary}</p>
          <span className="card__cue" aria-hidden="true">
            Read the case study <ArrowRight size={16} />
          </span>
        </li>
      ))}
    </ul>
  );
}

const STEPS = [
  { name: "Quote", text: "Pick a plan and a currency. The server works out the total, the 40% deposit and the launch balance to the centavo." },
  { name: "Deposit", text: "Accept the quote and pay the deposit. The price locks the moment you accept, whatever the price list does next." },
  { name: "Build", text: "Your project folder opens. Share brand files, follow the build and download each deliverable as it lands." },
  { name: "Launch", text: "Pay the launch balance from the invoice and the site goes live. Care plans keep it healthy afterwards." },
];

const PLAN_COPY: Record<Choice, { title: string; blurb: string; points: string[] }> = {
  "launch-page": {
    title: "Launch Page",
    blurb: "One focused page that says what you do and takes the enquiry.",
    points: ["Single scrolling page", "Copy edit and layout", "Contact form and analytics", "Two rounds of changes"],
  },
  "studio-site": {
    title: "Studio Site",
    blurb: "A complete site of up to eight pages, built to be edited by you.",
    points: ["Up to eight pages", "CMS for news and work", "Bilingual-ready structure", "Launch support for a month"],
  },
  care: {
    title: "Care",
    blurb: "Monthly care for a site that is already live.",
    points: ["Updates and backups", "Monthly health check", "Lite: two small changes a month", "Plus: six changes and faster replies"],
  },
};

function Pricing() {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [choice, setChoice] = useState<Choice>("studio-site");
  const [tier, setTier] = useState<Tier>("lite");
  const [prices, setPrices] = useState<Partial<Record<Currency, Listing>>>(listings);
  const [sheet, setSheet] = useState<{ state: SheetState; figures: SheetFigures | null }>({ state: "quoting", figures: null });
  const [status, setStatus] = useState<string>(COPY.quoting);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const latest = useRef(0);

  const quote = useCallback((plan: PlanId, pickCurrency: Currency) => {
    const ticket = ++latest.current;
    setSheet((previous) => ({ state: "quoting", figures: previous.figures }));
    setStatus(COPY.quoting);
    api<Quote>("/api/quotes", { body: { plan, currency: pickCurrency } })
      .then((q) => {
        if (ticket !== latest.current) return;
        setSheet({ state: "ready", figures: { currency: q.currency, first: q.dueNow, second: q.dueAtLaunch, total: q.total, share: q.dueNowShare } });
        setStatus(copyFor.quoteReady(money(q.dueNow, q.currency), money(q.dueAtLaunch, q.currency), money(q.total, q.currency)));
      })
      .catch(() => {
        if (ticket !== latest.current) return;
        setSheet((previous) => ({ state: "outage", figures: previous.figures }));
        setStatus(COPY.quoteOutage);
      });
  }, []);

  const loadListing = useCallback((pickCurrency: Currency) => {
    api<Listing>(`/api/plans?currency=${pickCurrency}`)
      .then((body) => {
        listings[pickCurrency] = body;
        setPrices((current) => ({ ...current, [pickCurrency]: body }));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    quote("studio-site", "USD");
    loadListing("USD");
  }, [quote, loadListing]);

  const pick = (next: { currency?: Currency; choice?: Choice; tier?: Tier }) => {
    const nextCurrency = next.currency ?? currency;
    const nextChoice = next.choice ?? choice;
    const nextTier = next.tier ?? tier;
    if (next.currency && next.currency !== currency) {
      setCurrency(next.currency);
      loadListing(next.currency);
    }
    if (next.choice) setChoice(next.choice);
    if (next.tier) setTier(next.tier);
    quote(resolve(nextChoice, nextTier), nextCurrency);
  };

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key.toLowerCase() !== "c" || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type !== "radio" && target.type !== "checkbox") return;
    event.preventDefault();
    pick({ currency: currency === "USD" ? "ARS" : "USD" });
  };

  const start = async () => {
    setStarting(true);
    setStartError("");
    try {
      const order = await api<Order>("/api/orders", { body: { plan: resolve(choice, tier), currency } });
      navigate(`/checkout/${order.id}`);
      window.scrollTo(0, 0);
    } catch (error) {
      setStartError(error instanceof RequestError && error.status === 403 ? "Sign out of the studio or contractor account to start a new order." : "We couldn't start your checkout. Try again in a moment.");
      setStarting(false);
    }
  };

  const listing = prices[currency];
  const amount = (plan: PlanId) => {
    const found = listing?.plans.find((p) => p.plan === plan);
    return found ? money(found.amount, currency) : "—";
  };
  const figures = useMemo(() => sheet.figures, [sheet.figures]);

  return (
    <section id="pricing" data-section="pricing" aria-label="Pricing" className="section section--pricing" onKeyDown={onKey}>
      <div className="section__intro">
        <p className="eyebrow">Pricing</p>
        <h2 id="pricing-title">Three plans, quoted to the centavo.</h2>
        <p className="lede">Dollars or pesos. Peso prices change with inflation, so yours is locked the moment you accept. Press C to switch currency.</p>
      </div>
      <div role="radiogroup" aria-label="Currency" className="segmented segmented--currency">
        {(["USD", "ARS"] as const).map((code) => (
          <label key={code} className="segmented__option">
            <input type="radio" name="currency" value={code} checked={currency === code} onChange={() => pick({ currency: code })} />
            <span>{code}</span>
          </label>
        ))}
      </div>
      <div className="plans">
        {(["launch-page", "studio-site", "care"] as const).map((key) => {
          const copy = PLAN_COPY[key];
          const chosen = choice === key;
          const careId = resolve("care", tier);
          return (
            <article key={key} aria-labelledby={`plan-${key}`} className={`plan${chosen ? " plan--chosen" : ""}`}>
              <h3 id={`plan-${key}`} className="plan__name">{copy.title}</h3>
              <p className="plan__price mono">{key === "care" ? `${amount(careId)} / month` : amount(key)}</p>
              <p className="plan__blurb">{copy.blurb}</p>
              <ul className="plan__points">
                {copy.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {key === "care" ? (
                <div role="radiogroup" aria-label="Care tier" className="segmented segmented--small">
                  {(["lite", "plus"] as const).map((option) => (
                    <label key={option} className="segmented__option">
                      <input type="radio" name="care-tier" value={option} checked={tier === option} onChange={() => pick({ tier: option, choice: "care" })} />
                      <span>{option === "lite" ? "Lite" : "Plus"}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <button type="button" aria-pressed={chosen} className={`button ${chosen ? "button--primary" : "button--secondary"} plan__choose`} onClick={() => pick({ choice: key })}>
                Choose {copy.title}
              </button>
            </article>
          );
        })}
      </div>
      <div className="pricing__sheet">
        <QuoteSheet state={sheet.state} figures={figures} labels={["Due now", "Due at launch"]} outageCopy={COPY.quoteOutage} />
        <p role="status" aria-label="Quote status" className="live">{status}</p>
        <button type="button" className="button button--primary button--large" onClick={start} disabled={starting}>
          Start checkout
          <ArrowRight aria-hidden="true" size={18} />
        </button>
        {startError ? <p className="field-error">{startError}</p> : null}
      </div>
    </section>
  );
}

export function Home() {
  return (
    <>
      <section data-section="hero" aria-labelledby="hero-title" className="section section--hero">
        <p className="eyebrow">Pampero Build Co. · Buenos Aires</p>
        <h1 id="hero-title" className="hero-line">Websites, built and paid for in plain sight.</h1>
        <p className="lede">A one-person design-and-build studio. See the work, compare three plans in dollars or pesos, and buy one without a sales call.</p>
      </section>
      <section id="work" data-section="work" aria-label="Work" className="section section--work">
        <div className="section__intro">
          <p className="eyebrow">Work</p>
          <h2 id="work-title">Sites for people who make things.</h2>
        </div>
        <Deck />
      </section>
      <section id="process" data-section="process" aria-labelledby="process-title" className="section section--process">
        <div className="section__intro">
          <p className="eyebrow">Process</p>
          <h2 id="process-title">Four steps, one ledger.</h2>
        </div>
        <ol className="steps">
          {STEPS.map((step, index) => (
            <li key={step.name} className="step">
              <span className="step__number mono" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="step__name">{step.name}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <Pricing />
      <section id="contact" data-section="contact" aria-labelledby="contact-title" className="section section--contact">
        <p className="eyebrow">Contact</p>
        <h2 id="contact-title">Write before you start, or don't.</h2>
        <p className="lede">Questions about scope or a quote are welcome. Replies within one working day, Buenos Aires time.</p>
        <p className="contact-mail">
          <a href={`mailto:${STUDIO_EMAIL}`}>{STUDIO_EMAIL}</a>
        </p>
      </section>
    </>
  );
}
