// The public site: home, plans, the marker catalog, sign-up, sign-in and the not-found screen.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MarkersAnswer, MemberSelfAnswer, PlansAnswer, SessionView, SignedIn, StateCheck, StatesAnswer, type Cadence } from "../shared/api";
import { formatCents } from "../shared/format";
import { TIME_ZONES, cityOf } from "../shared/time";
import { getJson, sendJson } from "./api";
import { BandGlyph, ChevronGlyph, CloudField, MarkerGlyph, PacketGlyph, PlansGlyph, TubeGlyph } from "./glyphs";
import { MEDIUM, play, reducedMotion, SHORT } from "./motion";
import { clearForm, navigate, pushSearch, resumeAfterSignIn, setSession, useAddress, useSession } from "./stores";
import { ActionBar, Button, Figures, Link, onSubmit, PageHeading, Problems, RadioGroup, SelectField, TextField, useAction, useForm, useLoad } from "./ui";

// The roll used by plan prices and marker band numerals: old slides up and out, new slides up into place.
export function Rolling({ part, changeKey, children, className }: { part: string; changeKey: string; children: ReactNode; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const shownKey = useRef(changeKey);
  const shownMarkup = useRef("");

  useLayoutEffect(() => {
    const hostElement = host.current;
    const lineElement = line.current;
    if (!hostElement || !lineElement) return;
    if (shownKey.current !== changeKey && !reducedMotion()) {
      const leaving = document.createElement("span");
      leaving.className = "roll-line roll-leaving";
      leaving.setAttribute("aria-hidden", "true");
      leaving.innerHTML = shownMarkup.current;
      hostElement.append(leaving);
      play(leaving, [{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-100%)", opacity: 0 }], MEDIUM, () => leaving.remove());
      play(lineElement, [{ transform: "translateY(100%)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], MEDIUM);
    }
    shownKey.current = changeKey;
    shownMarkup.current = lineElement.innerHTML;
  }, [changeKey]);

  return (
    <div ref={host} data-part={part} className={`roll ${className ?? ""}`}>
      <span ref={line} className="roll-line">{children}</span>
    </div>
  );
}

// The public header: transparent at the top, solid from 24 px down, with the Explore mega menu.

const SOLID_FROM_PX = 24;
const MENU_REST_MS = 160;

const TILES = [
  { title: "Marker band", copy: "Your results on one clear track.", to: "/markers", glyph: <BandGlyph size={48} /> },
  { title: "At-home draws", copy: "A fasting draw at your door.", to: "/plans", glyph: <TubeGlyph size={48} /> },
  { title: "Supplement packets", copy: "Morning and evening packets.", to: "/plans", glyph: <PacketGlyph size={48} /> },
  { title: "Plans", copy: "Free and Plus, side by side.", to: "/plans", glyph: <PlansGlyph size={48} /> },
];

function ExploreMenu() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closing = !open;
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);

  const clearTimers = (): void => {
    if (restTimer.current) clearTimeout(restTimer.current);
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };

  const show = (): void => {
    if (!open) {
      setMounted(true);
      setOpen(true);
    }
  };

  const hide = (returnFocus: boolean): void => {
    clearTimers();
    pinned.current = false;
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    running.current?.cancel();
    if (open) {
      running.current = play(element, [{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "translateY(0)" }], SHORT);
    } else if (mounted) {
      running.current = play(element, [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-8px)" }], SHORT, () => setMounted(false));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide(true);
    };
    const onPointer = (event: PointerEvent): void => {
      if (event.target instanceof Node && !wrap.current?.contains(event.target)) hide(true);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  });

  return (
    <div
      ref={wrap}
      className="explore"
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !wrap.current?.contains(event.relatedTarget)) hide(false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse" || pinned.current) return;
        clearTimers();
        leaveTimer.current = setTimeout(() => hide(false), MENU_REST_MS);
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && leaveTimer.current) clearTimeout(leaveTimer.current);
      }}
    >
      <button
        ref={button}
        type="button"
        className="button button-quiet"
        aria-expanded={open}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse") return;
          clearTimers();
          restTimer.current = setTimeout(show, MENU_REST_MS);
        }}
        onClick={() => {
          clearTimers();
          if (!open) {
            pinned.current = true;
            show();
          } else if (!pinned.current) {
            pinned.current = true;
          } else {
            hide(true);
          }
        }}
      >
        Explore
      </button>
      {mounted ? (
        <nav ref={panel} aria-label="Explore" className="mega-menu" inert={closing || undefined}>
          {TILES.map((tile) => (
            <ExploreTile key={tile.title} {...tile} onFollow={() => hide(false)} />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

function ExploreTile({ title, copy, to, glyph, onFollow }: { title: string; copy: string; to: string; glyph: ReactNode; onFollow: () => void }) {
  return (
    <Link to={to} className="tile" ariaLabel={title} onFollow={onFollow}>
      <span className="tile-glyph">{glyph}</span>
      <span className="tile-text">
        <span className="tile-title">{title}</span>
        <span className="tile-copy">{copy}</span>
      </span>
    </Link>
  );
}

function PublicHeader() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const read = (): void => setSolid(window.scrollY >= SOLID_FROM_PX);
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return (
    <header role="banner" className="public-header" data-state={solid ? "solid" : "top"}>
      <Link to="/" className="brand">Ocotillo</Link>
      <nav aria-label="Main" className="main-nav">
        <ExploreMenu />
        <Link to="/plans" className="nav-link nav-wide">Plans</Link>
        <Link to="/markers" className="nav-link nav-wide">Marker catalog</Link>
        <Link to="/signin" className="nav-link">Sign in</Link>
      </nav>
    </header>
  );
}

function Hero({ short = false, children }: { short?: boolean; children: ReactNode }) {
  return (
    <section className={short ? "hero hero-short" : "hero"}>
      <CloudField />
      {children}
    </section>
  );
}

function PublicPage({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main className="page public-page">{children}</main>
      <footer className="site-foot">Ocotillo Longevity Club, 8820 E Desert Willow Way, Suite 140, Scottsdale, AZ 85258</footer>
    </>
  );
}

// Home.

const PARTNERS = ["Saguaro Diagnostics", "Mesa Clinical Labs", "Copperline Pathology", "Bluebird Assay Partners", "Red Rock Reference Lab", "Palo Verde Analytics"];

function PartnerStrip() {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <section
      aria-label="Lab partners"
      tabIndex={0}
      className={hovered || focused ? "partner-strip partner-strip-paused" : "partner-strip"}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHovered(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="partner-track">
        {PARTNERS.map((name) => <span key={name}>{name}</span>)}
        {PARTNERS.map((name) => <span key={`${name}-again`} aria-hidden="true">{name}</span>)}
      </div>
    </section>
  );
}

const FEATURES = [
  { title: "At-home draws", copy: "A visiting phlebotomist comes between 06:00 and 09:40 in your own wall time, on the day you chose.", glyph: <TubeGlyph size={40} /> },
  { title: "The marker band", copy: "Every result on one track: below, in range, optimal or above, against the table in force that day.", glyph: <BandGlyph size={40} /> },
  { title: "Supplement packets", copy: "Your specialist packs your blend into a morning and an evening packet, at most four capsules each.", glyph: <PacketGlyph size={40} /> },
];

export function HomeScreen() {
  return (
    <PublicPage>
      <Hero>
        <PageHeading>Ocotillo Longevity Club</PageHeading>
        <p className="lede">Fasting blood draws at your door, results you can read at a glance, and a written plan from a longevity specialist in Scottsdale, Arizona.</p>
        <ActionBar><Link to="/plans" className="button button-primary">See plans</Link></ActionBar>
      </Hero>
      <PartnerStrip />
      <section className="feature-grid" aria-label="What membership includes">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card feature">
            <span className="feature-glyph">{feature.glyph}</span>
            <h2>{feature.title}</h2>
            <p>{feature.copy}</p>
          </article>
        ))}
      </section>
    </PublicPage>
  );
}

// Plans.

const COMPARISON = [
  ["At-home blood draws", "None", "Two a year"],
  ["Results on the marker band", "No", "Yes"],
  ["Written longevity plan", "No", "Yes"],
  ["Custom supplement blend", "No", "Yes, member price"],
  ["Care messages", "No", "Yes"],
  ["Marker catalog", "Yes", "Yes"],
];

export const CADENCE_CHOICES = [
  { value: "sixMonths", label: "Every 6 months" },
  { value: "yearly", label: "Yearly" },
];

function isCadenceValue(value: string): value is Cadence {
  return value === "sixMonths" || value === "yearly";
}

function PlusPrice({ cadence, plans }: { cadence: Cadence; plans: PlansAnswer }) {
  const price = plans.plans.find((plan) => plan.id === "plus")?.prices.find((entry) => entry.cadence === cadence);
  if (!price) return null;
  const period = cadence === "yearly" ? "a year" : "every 6 months";
  const priceKey = `${price.amountCents}`;
  return (
    <>
      <Rolling part="price" changeKey={priceKey} className="price">
        <span className="price-amount"><Figures text={formatCents(price.amountCents)} /></span> <span className="price-period">{period}</span>
      </Rolling>
      <Rolling part="per-month" changeKey={priceKey} className="per-month">{formatCents(price.perMonthCents)} a month</Rolling>
    </>
  );
}

function StateCheckForm() {
  const states = useLoad(() => getJson("/api/states", StatesAnswer), "states", false);
  const form = useForm("state-check", { state: "" });
  const action = useAction();
  const [answer, setAnswer] = useState("");
  return (
    <section className="card">
      <h2>Do we serve your state?</h2>
      <form
        className="inline-form"
        onSubmit={onSubmit(() => {
          const state = form.value("state");
          if (!state) return;
          void action.run(async () => {
            const result = await getJson(`/api/states/${state}`, StateCheck);
            setAnswer(result.message);
            return result.message;
          });
        })}
      >
        <SelectField form={form} name="state" label="Your state" problem={null} prompt="Choose a state" choices={(states.data?.states ?? []).map((entry) => ({ value: entry.state, label: entry.name }))} />
        <Button type="submit" kind="secondary" action={action}>Check state</Button>
      </form>
      {answer ? <p className="state-answer">{answer}</p> : null}
    </section>
  );
}

export function PlansScreen() {
  const plans = useLoad(() => getJson("/api/plans", PlansAnswer), "plans", false);
  const form = useForm("plans", { cadence: "sixMonths" });
  const session = useSession();
  const chosen = form.value("cadence");
  const cadence: Cadence = isCadenceValue(chosen) ? chosen : "sixMonths";
  const signedInMember = session.kind === "live" && session.view.user.role === "member";
  return (
    <PublicPage>
      <Hero short>
        <PageHeading>Plans</PageHeading>
        <p className="lede">Start free with the marker catalog, or join Plus for at-home draws, results and a written plan.</p>
      </Hero>
      <div className="plan-cards">
        <article className="card plan-card">
          <h2>Free</h2>
          <p className="price"><span className="price-amount">$0</span></p>
          <p>Browse the marker catalog and keep an account ready for when you join.</p>
          <Link to="/join" className="button button-secondary">Create a free account</Link>
        </article>
        <article className="card plan-card plan-card-plus">
          <h2>Plus</h2>
          <RadioGroup form={form} name="cadence" label="Billing cadence" problem={null} choices={CADENCE_CHOICES} />
          {plans.data ? <PlusPrice cadence={cadence} plans={plans.data} /> : <div className="skeleton skeleton-line" />}
          <ActionBar><Button onClick={() => navigate(signedInMember ? "/me/membership" : "/join")}>Join Plus</Button></ActionBar>
        </article>
      </div>
      <section className="card">
        <table aria-label="Compare Free and Plus" className="compare">
          <thead><tr><th scope="col">What you get</th><th scope="col">Free</th><th scope="col">Plus</th></tr></thead>
          <tbody>
            {COMPARISON.map(([what, free, plus]) => (
              <tr key={what}><th scope="row">{what}</th><td>{free}</td><td>{plus}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <StateCheckForm />
      <section className="card link-card">
        <MarkerGlyph size={40} />
        <p>See every marker we read and how each one is grouped.</p>
        <Link to="/markers" className="button button-secondary">Browse the marker catalog</Link>
      </section>
    </PublicPage>
  );
}

// The marker catalog.

const CATEGORY_ORDER = [
  { id: "metabolic", name: "Metabolic" },
  { id: "heart", name: "Heart" },
  { id: "hormones", name: "Hormones" },
  { id: "kidneyLiver", name: "Kidney and liver" },
  { id: "nutrients", name: "Nutrients" },
  { id: "inflammationBlood", name: "Inflammation and blood" },
];

const SEARCH_PAUSE_MS = 300;

function Accordion({ name, open, onToggle, children }: { name: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const closing = !open;
  const panel = useRef<HTMLDivElement>(null);
  const running = useRef<Animation | null>(null);
  const wasOpen = useRef(open);
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    const element = panel.current;
    running.current?.cancel();
    if (!element) return;
    if (open) {
      const height = `${element.scrollHeight}px`;
      running.current = play(element, [{ height: "0px" }, { height }], MEDIUM);
    } else {
      running.current = play(element, [{ height: `${element.scrollHeight}px` }, { height: "0px" }], MEDIUM, () => setMounted(false));
    }
  }, [open]);

  const panelId = `category-${name.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="card accordion">
      <h2 className="accordion-head">
        <button type="button" id={`${panelId}-head`} className="accordion-button" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          {name}
          <span className="accordion-chevron"><ChevronGlyph size={24} /></span>
        </button>
      </h2>
      {mounted ? (
        <div ref={panel} id={panelId} role="region" aria-labelledby={`${panelId}-head`} className="accordion-panel" inert={closing || undefined}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function MarkersScreen() {
  const { search } = useAddress();
  const params = new URLSearchParams(search);
  const openIds = (params.get("open") ?? "").split(",").filter(Boolean);
  const settledQuery = params.get("q") ?? "";
  const [typedQuery, setTypedQuery] = useState(settledQuery);
  const [answer, setAnswer] = useState<MarkersAnswer | null>(null);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticket = useRef(0);

  useEffect(() => {
    setTypedQuery(settledQuery);
    ticket.current += 1;
    const mine = ticket.current;
    void getJson(`/api/markers${settledQuery ? `?q=${encodeURIComponent(settledQuery)}` : ""}`, MarkersAnswer).then((result) => {
      if (mine === ticket.current) setAnswer(result);
    });
  }, [settledQuery]);

  const addressWith = (open: readonly string[], query: string): string => {
    const parts = [];
    if (query) parts.push(`q=${encodeURIComponent(query)}`);
    if (open.length > 0) parts.push(`open=${open.join(",")}`);
    return parts.length > 0 ? `?${parts.join("&")}` : "";
  };

  return (
    <PublicPage>
      <Hero short>
        <PageHeading>Marker catalog</PageHeading>
        <p className="lede">The twenty markers we read, in the practice's own units.</p>
        <ActionBar><Link to="/plans" className="button button-primary">See plans</Link></ActionBar>
      </Hero>
      <div className="field catalog-search">
        <label htmlFor="marker-search">Search markers</label>
        <input
          id="marker-search"
          type="search"
          value={typedQuery}
          onChange={(event) => {
            const value = event.target.value;
            setTypedQuery(value);
            if (pause.current) clearTimeout(pause.current);
            pause.current = setTimeout(() => {
              const current = new URLSearchParams(window.location.search);
              pushSearch(addressWith((current.get("open") ?? "").split(",").filter(Boolean), value));
            }, SEARCH_PAUSE_MS);
          }}
        />
      </div>
      <div className="stack">
        {answer && answer.categories.length === 0 ? <p className="empty">No marker matches that search.</p> : null}
        {CATEGORY_ORDER.flatMap((category) => {
          const found = answer?.categories.find((entry) => entry.id === category.id);
          if (!found) return [];
          const open = openIds.includes(category.id);
          return [
            <Accordion
              key={category.id}
              name={category.name}
              open={open}
              onToggle={() => {
                const next = open ? openIds.filter((id) => id !== category.id) : [...openIds, category.id];
                pushSearch(addressWith(next, settledQuery));
              }}
            >
              <ul className="marker-list">
                {found.markers.map((marker) => (
                  <li key={marker.id}><span>{marker.name}</span> <span className="muted">{marker.unit}</span></li>
                ))}
              </ul>
            </Accordion>,
          ];
        })}
      </div>
    </PublicPage>
  );
}

// Sign-up and sign-in.

export const ZONE_CHOICES = TIME_ZONES.map((zone) => ({ value: zone, label: `${cityOf(zone)} time` }));
export const SEX_CHOICES = [{ value: "female", label: "Female" }, { value: "male", label: "Male" }];

export function JoinScreen() {
  const states = useLoad(() => getJson("/api/states", StatesAnswer), "states", false);
  const form = useForm("join", { name: "", email: "", password: "", dateOfBirth: "", sex: "", state: "", timeZone: "" });
  const action = useAction();
  const submit = (): void => {
    void action.run(async () => {
      await sendJson("POST", "/api/accounts", {
        name: form.value("name"),
        email: form.value("email"),
        password: form.value("password"),
        dateOfBirth: form.value("dateOfBirth"),
        sex: form.value("sex"),
        state: form.value("state"),
        timeZone: form.value("timeZone"),
      }, MemberSelfAnswer);
      setSession({ kind: "live", view: await getJson("/api/session", SessionView) });
      clearForm("join");
      navigate("/me");
      return "Your free account is ready.";
    });
  };
  return (
    <PublicPage>
      <Hero short><PageHeading>Create your free account</PageHeading></Hero>
      <form className="card form-card stack" noValidate onSubmit={onSubmit(submit)}>
        <Problems form="join" action={action} />
        <TextField form={form} name="name" label="Full name" problem={action.problem} autoComplete="name" />
        <TextField form={form} name="email" label="Email" type="email" problem={action.problem} autoComplete="email" />
        <TextField form={form} name="password" label="Password" type="password" problem={action.problem} autoComplete="new-password" />
        <TextField form={form} name="dateOfBirth" label="Date of birth" problem={action.problem} hint="As YYYY-MM-DD" autoComplete="bday" />
        <RadioGroup form={form} name="sex" label="Sex" problem={action.problem} choices={SEX_CHOICES} />
        <SelectField form={form} name="state" label="Home state" problem={action.problem} prompt="Choose a state" choices={(states.data?.states ?? []).map((entry) => ({ value: entry.state, label: entry.name }))} />
        <SelectField form={form} name="timeZone" label="Local time" problem={action.problem} prompt="Choose your local time" choices={ZONE_CHOICES} />
        <ActionBar><Button type="submit" action={action}>Create account</Button></ActionBar>
      </form>
    </PublicPage>
  );
}

export function SignInScreen() {
  const form = useForm("sign-in", { email: "", password: "" });
  const action = useAction();
  const submit = (): void => {
    void action.run(async () => {
      const signedIn = await sendJson("POST", "/api/session", { email: form.value("email"), password: form.value("password") }, SignedIn);
      setSession({ kind: "live", view: await getJson("/api/session", SessionView) });
      clearForm("sign-in");
      if (!resumeAfterSignIn()) navigate(signedIn.home);
      return null;
    });
  };
  return (
    <PublicPage>
      <Hero short><PageHeading>Sign in</PageHeading></Hero>
      <form className="card form-card stack" noValidate onSubmit={onSubmit(submit)}>
        <Problems form="sign-in" action={action} />
        <TextField form={form} name="email" label="Email" type="email" problem={action.problem} autoComplete="username" />
        <TextField form={form} name="password" label="Password" type="password" problem={action.problem} autoComplete="current-password" />
        <ActionBar><Button type="submit" action={action}>Sign in</Button></ActionBar>
      </form>
    </PublicPage>
  );
}

export function NotFoundScreen({ title = "We can't find that page." }: { title?: string }) {
  return (
    <PublicPage>
      <Hero short>
        <PageHeading>{title}</PageHeading>
        <ActionBar><Link to="/" className="button button-primary">Go to the home page</Link></ActionBar>
      </Hero>
    </PublicPage>
  );
}

