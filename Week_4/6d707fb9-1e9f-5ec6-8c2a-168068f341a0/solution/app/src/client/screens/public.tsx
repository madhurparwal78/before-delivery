import type { ComponentChildren, JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { COUNTRIES, GARMENTS, LABEL_STRIP, STAGES, STAGE_NAMES, type MeasureId } from "../../shared/catalog";
import type { Assessor, EstimateAnswer } from "../../shared/api";
import { NOT_FOUND_HEADING } from "../../shared/copy";
import {
  announce,
  api,
  navigate,
  place,
  post,
  pushAddress,
  replaceAddress,
  sessionEnded,
  useMedia,
  usePause,
  useTitle,
} from "../lib";
import { Button, Field, Modal, Problems, RollingFigure, useDialog, useForm, usePresence } from "../ui";

const TILES = [
  { name: "The five stages", href: "/method#stages", note: "Materials through end of life" },
  { name: "Six measures", href: "/method#measures", note: "Climate to microfibres" },
  { name: "Questions", href: "/questions", note: "What the desk does and does not do" },
  { name: "Try one garment", href: "/#try", note: "A figure for one shirt, now" },
  { name: "Sign in", href: "/sign-in", note: "Back to your desk" },
  { name: "Start a desk", href: "/sign-up", note: "Open a new desk" },
];

const Underline = (): JSX.Element => (
  <svg class="underline" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
    <path d="M1 5 C 18 2, 30 7, 48 4 S 82 2, 99 5" pathLength={1} />
  </svg>
);

function ExploreTiles(): JSX.Element {
  return (
    <ul class="tiles">
      {TILES.map((tile) => (
        <li key={tile.name}>
          <a class="tile" href={tile.href} aria-label={tile.name}>
            <span class="tile-name">{tile.name}</span>
            <span class="tile-note" aria-hidden="true">
              {tile.note}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function PublicHeader(): JSX.Element {
  const wide = useMedia("(min-width: 768px)");
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const area = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const sheet = useDialog();
  const menu = usePresence(open && wide, nav);

  useLayoutEffect(() => {
    const onScroll = (): void => setSolid(scrollY >= 24);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) opener.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") closeMenu(true);
    };
    const onPress = (event: Event): void => {
      if (!area.current?.contains(event.target as Node)) closeMenu(false);
    };
    const onFocus = (event: FocusEvent): void => {
      if (!area.current?.contains(event.target as Node)) closeMenu(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  const pressExplore = (event: Event): void => {
    if (!wide) {
      if (sheet.open) sheet.hide();
      else sheet.show(event);
      return;
    }
    setOpen(!open);
  };

  const expanded = wide ? open : sheet.open;

  return (
    <header ref={area} class={`public-header${solid ? " is-solid" : ""}`} role="banner">
      <a class="brand" href="/">
        Fio Contado Desk
      </a>
      <div class="header-links">
        <button ref={opener} type="button" class="nav-button" aria-expanded={expanded ? "true" : "false"} onClick={pressExplore}>
          Explore
          <span class="caret" aria-hidden="true" />
          <Underline />
        </button>
        {wide && menu.mounted ? (
          <nav ref={nav} class={`mega${menu.closing ? " is-closing" : ""}`} aria-label="Explore" inert={menu.closing} onClick={() => closeMenu(false)}>
            <ExploreTiles />
          </nav>
        ) : null}
        <a class="nav-link nav-wide" href="/method">
          Method
          <Underline />
        </a>
        <a class="nav-link nav-wide" href="/questions">
          Questions
          <Underline />
        </a>
        <a class="nav-link nav-wide" href="/sign-in">
          Sign in
          <Underline />
        </a>
      </div>
      <Modal name="Explore" control={sheet} kind="top-sheet" dismissOutside>
        <div onClick={sheet.hide}>
          <ExploreTiles />
        </div>
      </Modal>
    </header>
  );
}

function PublicFooter(): JSX.Element {
  return (
    <footer class="public-footer">
      <p>Fio Contado Desk. These figures are published sums, not legal claims.</p>
    </footer>
  );
}

export function Heading({ children }: { children: ComponentChildren }): JSX.Element {
  return <h1 tabIndex={-1}>{children}</h1>;
}

// ---- generated glyphs and pictures

function Glyph({ name }: { name: "fibre" | "factory" | "leg" }): JSX.Element {
  const paths = {
    fibre: "M4 28 C 10 8, 22 8, 28 28 M10 28 C 14 14, 18 14, 22 28 M16 28 V6",
    factory: "M4 28 V14 l8 5 V14 l8 5 V8 h8 V28 Z M9 24 h3 M16 24 h3 M23 24 h2",
    leg: "M3 22 H20 V10 H3 Z M20 14 h6 l3 4 v4 h-9 M8 26 a2.5 2.5 0 1 0 .01 0 M24 26 a2.5 2.5 0 1 0 .01 0",
  };
  return (
    <svg class="glyph" viewBox="0 0 32 32" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

const FRAGMENT_MEASURES: { id: MeasureId; name: string; statement: string; shares: number[]; hot: number; total: string }[] = [
  { id: "climate", name: "Climate", statement: "Climate sits in the materials for this tee.", shares: [45.7, 20.9, 3.8, 29.1, 0.6], hot: 0, total: "2.20 kg CO₂e" },
  { id: "fossilEnergy", name: "Fossil energy", statement: "Fossil energy moves to the washes at home.", shares: [35.6, 23.4, 4.6, 36.3, 0.2], hot: 3, total: "25.7 MJ" },
  { id: "microfibres", name: "Microfibres", statement: "Microfibres follow the wash and little else.", shares: [10.2, 0, 0, 89.5, 0.3], hot: 3, total: "127 mg" },
];

function StrataFragment({ measure }: { measure: (typeof FRAGMENT_MEASURES)[number] }): JSX.Element {
  return (
    <div class="fragment fragment-strata" data-ui aria-hidden="true">
      <p class="fragment-title">
        Harbour Tee · <span>{measure.name}</span>
      </p>
      <p class="fragment-total">{measure.total}</p>
      <div class="fragment-band">
        {STAGES.map((stage, index) => (
          <div key={stage} class={`fragment-stratum weave-${stage}`} style={{ width: `${measure.shares[index]}%` }} />
        ))}
      </div>
      <ul class="fragment-stages">
        {STAGES.map((stage, index) => (
          <li key={stage}>
            <span class={`swatch weave-${stage}`} />
            {STAGE_NAMES[stage]} <b>{measure.shares[index]}%</b>
            {index === measure.hot ? " · hotspot" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MaterialLineFragment(): JSX.Element {
  return (
    <div class="fragment fragment-line" data-ui aria-hidden="true">
      <div class="fragment-row">
        <Glyph name="fibre" />
        <p>
          <b>Organic cotton</b>
          <br />
          215 g/m² × 1.15 m²
        </p>
        <p class="fragment-figure">247.3 g</p>
      </div>
      <div class="fragment-row">
        <Glyph name="factory" />
        <p>
          Tier 1 · Yıldız İplik
          <br />
          Izmir, Turkey
        </p>
      </div>
      <div class="fragment-row">
        <Glyph name="leg" />
        <p>
          Road · 3,200 km
          <br />
          0.8 tonne-km
        </p>
      </div>
    </div>
  );
}

function RowMenuFragment(): JSX.Element {
  return (
    <div class="fragment fragment-menu" data-ui aria-hidden="true">
      <div class="fragment-table">
        <p>
          <b>Quay Shirt</b> <span>Maré Alta</span> <span>2.12 kg CO₂e</span>
        </p>
        <p>
          <b>Estuary Coat</b> <span>Atelier Noroeste</span> <span>23.7 kg CO₂e</span>
        </p>
      </div>
      <div class="fragment-popup">
        <p>Open</p>
        <p>Duplicate</p>
        <p>Archive</p>
      </div>
    </div>
  );
}

function PhoneFragment(): JSX.Element {
  return (
    <div class="fragment fragment-phone" data-ui aria-hidden="true">
      <p class="fragment-title">Visit to Yıldız İplik</p>
      <p>Meter 2</p>
      <p class="fragment-reading">14,350 kWh</p>
      <p class="fragment-waiting">Offline — 3 readings waiting on this device.</p>
    </div>
  );
}

// ---- Try one garment

const FIBRES = [
  { id: "organic-cotton", name: "Organic cotton" },
  { id: "cotton", name: "Cotton" },
  { id: "polyester", name: "Polyester" },
  { id: "wool", name: "Wool" },
];
const ESTIMATE_COUNTRIES = COUNTRIES.filter((country) => ["PT", "TR", "VN", "EG"].includes(country.id));

function TryOneGarment(): JSX.Element {
  const here = place.use();
  const query = new URLSearchParams(here.search);
  const garment = query.get("garment") ?? "tshirt";
  const fibre = query.get("fibre") ?? "organic-cotton";
  const country = query.get("country") ?? "PT";
  const [shown, setShown] = useState<string>("");
  const asked = useRef(0);
  const pause = usePause();
  const first = useRef(true);

  const ask = (nextGarment: string, nextFibre: string, nextCountry: string, say: boolean): void => {
    const mine = (asked.current += 1);
    api<EstimateAnswer>(`/api/estimate?garment=${nextGarment}&fibre=${nextFibre}&country=${nextCountry}`)
      .then((answer) => {
        if (mine !== asked.current) return;
        setShown(answer.shown);
        if (say) announce(answer.shown);
      })
      .catch(() => undefined);
  };

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      ask(garment, fibre, country, false);
      return;
    }
    pause(() => ask(garment, fibre, country, true));
  }, [garment, fibre, country]);

  const choose = (next: { garment?: string; fibre?: string; country?: string }): void => {
    const params = new URLSearchParams({ garment, fibre, country, ...next });
    replaceAddress(`?${params.toString()}`);
  };

  return (
    <section class="try-panel" id="try" role="region" aria-label="Try one garment" data-ui>
      <h2>Try one garment</h2>
      <fieldset class="chips" role="radiogroup" aria-label="Garment">
        {GARMENTS.map((entry) => (
          <label key={entry.id} class="chip">
            <input type="radio" name="garment" value={entry.id} checked={garment === entry.id} onChange={() => choose({ garment: entry.id })} />
            <span>{entry.name}</span>
          </label>
        ))}
      </fieldset>
      <div class="try-selects">
        <div class="field">
          <label for="try-fibre">Main fibre</label>
          <select id="try-fibre" value={fibre} onChange={(event) => choose({ fibre: event.currentTarget.value })}>
            {FIBRES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="try-country">Making country</label>
          <select id="try-country" value={country} onChange={(event) => choose({ country: event.currentTarget.value })}>
            {ESTIMATE_COUNTRIES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p class="estimate">
        <RollingFigure text={shown || " "} part="estimate-figure" />
      </p>
      <div class="try-weave weave-materials" aria-hidden="true" />
    </section>
  );
}

// ---- pages

const STATEMENTS = [
  { first: "Every line keeps", second: "its exact mass.", picture: <MaterialLineFragment />, wide: false },
  { first: "Every style sits one", second: "press from its actions.", picture: <RowMenuFragment />, wide: true },
  { first: "Readings wait on the phone", second: "until the signal is back.", picture: <PhoneFragment />, wide: false },
];

function PinnedStrata(): JSX.Element {
  const [step, setStep] = useState(0);
  const marks = useRef<(HTMLParagraphElement | null)[]>([]);

  useLayoutEffect(() => {
    const onScroll = (): void => {
      let reached = 0;
      marks.current.forEach((mark, index) => {
        if (mark && mark.getBoundingClientRect().top < innerHeight * 0.6) reached = index;
      });
      setStep(reached);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  return (
    <section class="pinned" aria-label="One band, six measures">
      <div class="pinned-statements">
        {FRAGMENT_MEASURES.map((measure, index) => (
          <p key={measure.id} ref={(element) => { marks.current[index] = element; }} class="statement">
            {measure.statement}
          </p>
        ))}
      </div>
      <div class="pinned-fragment">
        <StrataFragment measure={FRAGMENT_MEASURES[step] as (typeof FRAGMENT_MEASURES)[number]} />
      </div>
    </section>
  );
}

/** The strip's focus ring fades as it lets go, rather than snapping off under a moving line of names. */
function ringFades(event: FocusEvent): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  (event.currentTarget as HTMLElement).animate({ outlineColor: ["#2a1d17", "transparent"] }, { duration: 320, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
}

function LabelStrip(): JSX.Element {
  const looping = useMedia("(min-width: 768px) and (prefers-reduced-motion: no-preference)");
  return (
    <section class="label-strip" role="region" aria-label="Labels on the desk" data-part="label-strip" tabIndex={looping ? 0 : undefined} onBlur={ringFades}>
      <div class="label-track">
        <ul>
          {LABEL_STRIP.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
        <ul class="label-repeat" aria-hidden="true">
          {LABEL_STRIP.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Home(): JSX.Element {
  useTitle("Count every thread of a garment's footprint.");
  return (
    <>
      <PublicHeader />
      <main class="home">
        <section class="hero">
          <div class="hero-copy">
            <Heading>
              Count every thread of a <br class="hero-break" />
              garment's footprint.
            </Heading>
            <p class="hero-lead">One desk for an independent assessor: supplier facts in, exact figures out, and a passport a shopper can read.</p>
            <div class="action-bar">
              <a class="button button-green" href="/method">
                See the method
              </a>
            </div>
          </div>
          <div class="stage">
            <div class="stage-glyphs" data-ui aria-hidden="true">
              <Glyph name="fibre" />
              <Glyph name="factory" />
              <Glyph name="leg" />
            </div>
            <TryOneGarment />
          </div>
        </section>
        <div class="rows">
          {STATEMENTS.map((row) => (
            <section key={row.first} class={`row${row.wide ? " row-wide" : ""}`} aria-label={`${row.first} ${row.second}`}>
              <p class="statement">
                {row.first}
                <br />
                {row.second}
              </p>
              {row.picture}
            </section>
          ))}
          <PinnedStrata />
        </div>
        <LabelStrip />
      </main>
      <PublicFooter />
    </>
  );
}

const STAGE_TEXT: { id: string; name: string; text: string; sum: string }[] = [
  { id: "materials", name: "Materials", text: "Each material line weighs what its fabric weighs, in exact decimals, multiplied by the library's row for that material.", sum: "mass × material factor" },
  { id: "making", name: "Making", text: "The energy to make one kilogram, from the supplier when answered and the library otherwise, times the grid of the tier 1 country.", sum: "mass × MJ per kg × grid factor" },
  { id: "transport", name: "Transport", text: "Each transport leg counts the whole garment's mass over its distance, by the mode that carried it.", sum: "tonne-km × mode factor" },
  { id: "use", name: "Use", text: "The washes a style is expected to see, at the library's row for one wash.", sum: "washes × wash factor" },
  { id: "endOfLife", name: "End of life", text: "The garment's whole mass at the library's disposal row.", sum: "mass × disposal factor" },
];

const MEASURE_TEXT: [string, string, string][] = [
  ["Climate", "kg CO₂e", "Greenhouse gases over the garment's life."],
  ["Water", "L", "Water drawn, replaced in making by a supplier's answer when given."],
  ["Fossil energy", "MJ", "Energy from fossil sources."],
  ["Land use", "points", "Pressure on land, in points."],
  ["Freshwater toxicity", "CTUe", "Harm to freshwater life."],
  ["Microfibres", "mg", "Fibres shed, mostly in the wash."],
];

export function Method(): JSX.Element {
  useTitle("How a footprint is worked out");
  return (
    <>
      <PublicHeader />
      <main class="public-page">
        <Heading>How a footprint is worked out</Heading>
        <p class="lead">Five stages, six measures, one rule for showing a figure: three significant figures, half up on the exact value.</p>
        <div class="stages-grid" id="stages" tabIndex={-1}>
          {STAGE_TEXT.map((stage) => (
            <section key={stage.id} class="stage-card">
              <span class={`stage-weave weave-${stage.id}`} aria-hidden="true" />
              <h2>{stage.name}</h2>
              <p>{stage.text}</p>
              <p class="sum">{stage.sum}</p>
            </section>
          ))}
        </div>
        <section class="measures-section" id="measures" tabIndex={-1}>
          <h2>The six measures</h2>
          <ul class="measures-list">
            {MEASURE_TEXT.map(([name, unit, text]) => (
              <li key={name}>
                <b>{name}</b> <span class="unit">{unit}</span>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <PublicFooter />
    </>
  );
}

const QUESTIONS: { slug: string; question: string; answer: string }[] = [
  { slug: "who-is-it-for", question: "Who is the desk for?", answer: "One independent life-cycle assessor working for a handful of fashion labels. There are no staff, roles or teams." },
  { slug: "legal-claim", question: "Does the desk make a legal claim?", answer: "No. The desk stores, converts units, works out published sums and shows what the providers answered. It gives no compliance advice." },
  { slug: "factors", question: "Where do the factors come from?", answer: "From a third-party factor library. Each result keeps the rows it read, so an earlier result stays readable exactly as it was." },
  { slug: "supplier-accounts", question: "Do suppliers need an account?", answer: "No. A supplier answers on a private page sent by mail, in their own language, with no sign-in." },
  { slug: "poor-signal", question: "What happens with poor signal?", answer: "Readings wait on the phone with a live count and arrive in the order taken when the network returns." },
  { slug: "shopper", question: "What does a shopper see?", answer: "A public passport with the six measures, the score, the factor edition and data quality, in any of four languages." },
];

function Accordion({ item, open, onToggle }: { item: (typeof QUESTIONS)[number]; open: boolean; onToggle: () => void }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const motion = useRef<Animation | null>(null);
  const [rendered, setRendered] = useState(open);
  const first = useRef(true);
  if (open && !rendered) setRendered(true);

  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const element = panel.current;
    if (!element) return;
    motion.current?.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (!open) setRendered(false);
      return;
    }
    const height = element.scrollHeight;
    element.style.overflow = "hidden";
    const animation = element.animate(open ? { height: ["0px", `${height}px`] } : { height: [`${height}px`, "0px"] }, {
      duration: 320,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
    motion.current = animation;
    animation.onfinish = () => {
      element.style.overflow = "";
      motion.current = null;
      if (!open) setRendered(false);
    };
  }, [open]);

  return (
    <div class="question">
      <h2>
        <button type="button" class="question-button" aria-expanded={open ? "true" : "false"} onClick={onToggle}>
          {item.question}
          <span class="caret" aria-hidden="true" />
        </button>
      </h2>
      <div ref={panel} class="answer" hidden={!rendered} inert={!open}>
        <p>{item.answer}</p>
      </div>
    </div>
  );
}

export function Questions(): JSX.Element {
  useTitle("Questions");
  const here = place.use();
  const openSlug = new URLSearchParams(here.search).get("q");
  return (
    <>
      <PublicHeader />
      <main class="public-page questions">
        <Heading>Questions</Heading>
        {QUESTIONS.map((item) => (
          <Accordion
            key={item.slug}
            item={item}
            open={openSlug === item.slug}
            onToggle={() => pushAddress(openSlug === item.slug ? "" : `?q=${item.slug}`)}
          />
        ))}
      </main>
      <PublicFooter />
    </>
  );
}

export function NotFound(): JSX.Element {
  useTitle(NOT_FOUND_HEADING);
  return (
    <>
      <PublicHeader />
      <main class="public-page">
        <Heading>{NOT_FOUND_HEADING}</Heading>
        <p class="lead">
          <a class="text-link" href="/">
            Back to the first page
          </a>
        </p>
      </main>
      <PublicFooter />
    </>
  );
}

// ---- sign in and start a desk

function afterSignIn(): void {
  const next = new URLSearchParams(location.search).get("next");
  sessionEnded.set(false);
  navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/styles");
}

export function SignIn(): JSX.Element {
  useTitle("Sign in");
  const form = useForm(null, { email: "", password: "" });
  const send = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post<{ assessor: Assessor }>("/api/sign-in", { email: form.values.email, password: form.values.password }, { noSessionWatch: true });
      afterSignIn();
    });
  };
  return (
    <>
      <PublicHeader />
      <main class="public-page form-page">
        <Heading>Sign in</Heading>
        <form onSubmit={send} noValidate>
          <Problems form={form} />
          <Field form={form} name="email" label="Email" type="email" autoComplete="email" value={form.values.email} onValue={(value) => form.set("email", value)} />
          <Field form={form} name="password" label="Password" type="password" autoComplete="current-password" value={form.values.password} onValue={(value) => form.set("password", value)} />
          <div class="action-bar">
            <Button type="submit" green busy={form.busy}>
              Sign in
            </Button>
          </div>
        </form>
        <p class="lead">
          No desk yet?{" "}
          <a class="text-link" href="/sign-up">
            Start a desk
          </a>
        </p>
      </main>
      <PublicFooter />
    </>
  );
}

export function SignUp(): JSX.Element {
  useTitle("Start a desk");
  const form = useForm(null, { name: "", email: "", password: "" });
  const send = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      await post<{ assessor: Assessor }>("/api/sign-up", form.values, { noSessionWatch: true });
      sessionEnded.set(false);
      navigate("/styles");
    });
  };
  return (
    <>
      <PublicHeader />
      <main class="public-page form-page">
        <Heading>Start a desk</Heading>
        <form onSubmit={send} noValidate>
          <Problems form={form} />
          <Field form={form} name="name" label="Name" autoComplete="name" value={form.values.name} onValue={(value) => form.set("name", value)} />
          <Field form={form} name="email" label="Email" type="email" autoComplete="email" value={form.values.email} onValue={(value) => form.set("email", value)} />
          <Field form={form} name="password" label="Password" type="password" autoComplete="new-password" value={form.values.password} onValue={(value) => form.set("password", value)} />
          <div class="action-bar">
            <Button type="submit" green busy={form.busy}>
              Start a desk
            </Button>
          </div>
        </form>
        <p class="lead">
          Already have one?{" "}
          <a class="text-link" href="/sign-in">
            Sign in
          </a>
        </p>
      </main>
      <PublicFooter />
    </>
  );
}
