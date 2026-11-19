import { useRef, useState } from "preact/hooks";
import { useMount } from "../hooks";
import { Icon, LogoMark } from "../icons";
import { navigate } from "../router";
import { reducedMotion } from "../motion";

/* ------------------------------------------------------------------ header */

const MENUS: Array<{ id: string; label: string; columns: Array<{ title: string; links: Array<[string, string]> }> }> = [
  { id: "work", label: "Work", columns: [
    { title: "Plan the week", links: [["Lists that repeat", "/account"], ["Boards that move", "/account"], ["Timelines with blockers", "/account"]] },
    { title: "Run the rules", links: [["Rule recipes", "/account"], ["Every run on record", "/account"]] },
    { title: "Balance the load", links: [["Daily workload", "/account"], ["Capacity per person", "/account"]] },
  ] },
  { id: "teams", label: "Teams", columns: [
    { title: "Operations", links: [["Office ops", "/account"], ["Facilities", "/account"]] },
    { title: "Creative", links: [["Content", "/account"], ["Studio", "/account"]] },
    { title: "Services", links: [["Client work", "/account"], ["Finance close", "/account"]] },
  ] },
  { id: "learn", label: "Learn", columns: [
    { title: "Try it", links: [["The sample request form", "/f/supply-request"], ["Create an account", "/account"]] },
    { title: "Join in", links: [["Join with a team code", "/account"], ["Sign in", "/account"]] },
  ] },
];

/** Below 1100px the workspace menus fold into one disclosure so the bar never wraps. */
const COMPACT = "(max-width: 1099px)";

export function PublicHeader() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(() => scrollY > 0);
  const [phone, setPhone] = useState(() => matchMedia(COMPACT).matches);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuButton = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);

  useMount(() => {
    const onScroll = () => setScrolled(scrollY > 0);
    const query = matchMedia(COMPACT);
    const onChange = () => setPhone(query.matches);
    const onPointer = (e: PointerEvent) => {
      if (bar.current && !bar.current.contains(e.target as Node)) {
        setOpen(null);
        setMobile(false);
      }
    };
    addEventListener("scroll", onScroll, { passive: true });
    query.addEventListener("change", onChange);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      removeEventListener("scroll", onScroll);
      query.removeEventListener("change", onChange);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (open) {
      const button = buttons.current[open];
      setOpen(null);
      button?.focus();
    } else if (mobile) {
      setMobile(false);
      menuButton.current?.focus();
    }
  };
  const menu = MENUS.find((m) => m.id === open);
  return (
    <header ref={bar} class={`topbar public-bar${scrolled ? " is-scrolled" : ""}`} onKeyDown={keydown}>
      <a class="brand" href="/" aria-label="Everyweek home"><LogoMark /><span class="wordmark">Everyweek</span></a>
      {!phone && (
        <nav class="mega-nav" aria-label="Workspace">
          {MENUS.map((m) => (
            <button key={m.id} type="button" class="mega-button" ref={(el) => { buttons.current[m.id] = el; }} aria-expanded={open === m.id} aria-controls={`mega-${m.id}`}
              onClick={() => setOpen(open === m.id ? null : m.id)}>
              {m.label}<Icon name="chevron-down" size={16} />
            </button>
          ))}
        </nav>
      )}
      <div class="bar-actions">
        {!phone && <a class="bar-link" href="/account">Log in</a>}
        {!phone && <a class="pill pill-outline pill-small" href="/f/supply-request">Try the sample form</a>}
        <a class="pill pill-ink pill-small" href="/account">Get started</a>
        {phone && (
          <button ref={menuButton} type="button" class="menu-toggle icon-only" aria-label="Menu" aria-expanded={mobile} aria-controls="mobile-menu" onClick={() => setMobile(!mobile)}>
            <Icon name="menu" size={22} />
          </button>
        )}
      </div>
      {menu && !phone && (
        <div id={`mega-${menu.id}`} class="mega-panel" role="group" aria-label={`${menu.label} menu`}>
          {menu.columns.map((column) => (
            <div key={column.title} class="mega-column">
              <p class="mega-title">{column.title}</p>
              <ul class="plain-list">{column.links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul>
            </div>
          ))}
        </div>
      )}
      {phone && mobile && (
        <div id="mobile-menu" class="mega-panel mobile-panel">
          {MENUS.map((m) => m.columns.map((column) => (
            <div key={`${m.id}-${column.title}`} class="mega-column">
              <p class="mega-title">{`${m.label}: ${column.title}`}</p>
              <ul class="plain-list">{column.links.map(([label, href]) => <li key={label}><a href={href}>{label}</a></li>)}</ul>
            </div>
          )))}
          <ul class="plain-list mobile-links"><li><a href="/account">Log in</a></li><li><a href="/f/supply-request">Try the sample form</a></li></ul>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ team kinds */

interface Kind {
  name: string; heading: string; copy: string;
  task: string; repeat: string; intake: string; approval: string; people: string[];
}

const KINDS: Kind[] = [
  { name: "Office ops", heading: "Month-end close that starts itself", copy: "Checklists repeat on the right day and every sign-off is recorded.",
    task: "Reconcile the petty cash tin", repeat: "Every month on day 28", intake: "REQ-0114 Replace the label printer", approval: "Approved by Tomas Okonkwo", people: ["NH", "IM", "TO"] },
  { name: "Content", heading: "Every issue moves on its own schedule", copy: "Briefs, drafts and reviews repeat each cycle and rules hand them on.",
    task: "Draft the Friday newsletter", repeat: "Every week on Wednesday", intake: "REQ-0231 Recipe card for the spring box", approval: "Changes requested by Ilse Marchetti", people: ["IM", "NH", "LB"] },
  { name: "Client work", heading: "Requests become tracked jobs", copy: "A public form turns each request into a task with a named approver.",
    task: "Quote the Harlow Street catering order", repeat: "Request form, due in 5 days", intake: "REQ-0310 Catering for 40 on the 14th", approval: "Awaiting Tomas Okonkwo", people: ["TO", "NH", "RB"] },
  { name: "Facilities", heading: "Upkeep that never lapses", copy: "Machine and building checks come back every week or month.",
    task: "Oil the slicer", repeat: "Every week on Monday", intake: "REQ-0075 Walk-in cooler door seal", approval: "Approved by Noor Halvorsen", people: ["NH", "OK", "TO"] },
  { name: "Finance close", heading: "Approvals with a clear paper trail", copy: "Each decision is saved with who agreed and when.",
    task: "Approve the supplier invoices", repeat: "Every month on day 3", intake: "REQ-0402 Refund for order 8812", approval: "Rejected by Tomas Okonkwo, comment saved", people: ["TO", "NH", "IM"] },
  { name: "Studio", heading: "A balanced week for every person", copy: "Daily workload shows who is over capacity before a deadline slips.",
    task: "Photograph the autumn menu", repeat: "5.8 of 4 h on Friday, over capacity", intake: "REQ-0188 Props for the Thursday shoot", approval: "Reassigned to Ilse Marchetti", people: ["IM", "NH", "KS"] },
];

function Collage({ kind }: { kind: Kind }) {
  return (
    <div class="collage" aria-hidden="false">
      <svg class="collage-trail" viewBox="0 0 520 480" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="trail" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC7F2" /><stop offset="1" stop-color="#F95A4E" /></linearGradient>
        </defs>
        <path d="M80 40 C 80 120, 400 100, 400 180 S 120 260, 120 340 S 380 380, 380 450" fill="none" stroke="#D9D9D9" stroke-width="2" />
        <path class="trail-path" d="M80 40 C 80 120, 400 100, 400 180 S 120 260, 120 340 S 380 380, 380 450" fill="none" stroke="url(#trail)" stroke-width="3" stroke-linecap="round" pathLength={1} />
        {[[80, 40], [400, 180], [120, 340], [380, 450]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="6" fill="#0D0D0D" />)}
      </svg>
      <div class="collage-card c1 card"><span class="tiny-label">Task</span><strong>{kind.task}</strong><span class="muted">{kind.repeat}</span></div>
      <div class="collage-card c2 card"><span class="tiny-label">Intake</span><strong>{kind.intake}</strong><span class="muted">Needed by Friday</span></div>
      <div class="collage-card c3 card"><span class="status-chip chip-approved">{kind.approval}</span></div>
      <div class="collage-card c4 card avatars">{kind.people.map((p, i) => <span key={p + i} class={`avatar a${i}`}>{p}</span>)}<span class="muted">On this week</span></div>
    </div>
  );
}

function Hero() {
  const [selected, setSelected] = useState(0);
  const [email, setEmail] = useState("");
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const kind = KINDS[selected];
  const key = (event: KeyboardEvent) => {
    const next = event.key === "ArrowRight" ? (selected + 1) % KINDS.length : event.key === "ArrowLeft" ? (selected + KINDS.length - 1) % KINDS.length
      : event.key === "Home" ? 0 : event.key === "End" ? KINDS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setSelected(next);
    tabs.current[next]?.focus();
  };
  const signUp = (event: Event) => {
    event.preventDefault();
    navigate(`/account${email ? `?email=${encodeURIComponent(email)}` : ""}`);
  };
  return (
    <>
      <section class="hero reveal">
        <h1>Recurring work that runs itself</h1>
        <p class="hero-sub">Everyweek keeps the jobs your crew repeats on schedule, with rules, approvals and a workload view that stay in step.</p>
        <div class="chips-scroll">
          <div role="tablist" aria-label="Team kinds" class="kind-tabs">
            {KINDS.map((k, i) => (
              <button key={k.name} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`kind-${i}`} aria-selected={selected === i} aria-controls="kind-panel"
                tabIndex={selected === i ? 0 : -1} class={`chip chip-large${selected === i ? " is-active" : ""}`} onKeyDown={key} onClick={() => setSelected(i)}>
                {k.name}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section class="two-col reveal" id="kind-panel" role="tabpanel" aria-labelledby={`kind-${selected}`}>
        <div class="two-col-copy">
          <h2 class="display-section" key={kind.name}>{kind.heading}</h2>
          <p class="lede">{kind.copy}</p>
          <div class="signup-block">
            <div class="signup-pills">
              <a class="pill pill-outline pill-wide" href="/account">Join with a team code</a>
              <a class="pill pill-outline pill-wide" href="/f/supply-request">Open a sample request form</a>
            </div>
            <div class="or-divider" aria-hidden="true"><span>or</span></div>
            <form class="signup-row" onSubmit={signUp} noValidate>
              <label class="sr-only" for="work-email">Work email</label>
              <input id="work-email" type="text" inputMode="email" autocomplete="email" placeholder="Work email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
              <button type="submit" class="pill pill-ink">Sign up</button>
            </form>
            <p class="legal">Everyweek is a Corran &amp; Bly workspace. Every person and business shown here is invented.</p>
          </div>
        </div>
        <div class="two-col-art" key={`art-${kind.name}`}><Collage kind={kind} /></div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ showcase */

const SHOWCASE: Array<{ tab: string; title: string; text: string; mock: () => preact.JSX.Element }> = [
  { tab: "List", title: "A list you can drive by keyboard", text: "Add tasks in a row, select with Shift and arrows, indent a task under another and set tags on all of them at once.",
    mock: () => <div class="mock-rows">{["Order dry goods", "Pack orders", "Count freezer", "Weigh stock"].map((n, i) => <div key={n} class={`mock-row${i === 1 ? " is-sub" : ""}`}><span class="dot" />{n}<em>{["12 h", "10 h", "5 h", "2.5 h"][i]}</em></div>)}</div> },
  { tab: "Board", title: "A board that moves by hand or by key", text: "Pick a card up with Space, move it with the arrows and hear every step announced. Drag works too, on a phone as well.",
    mock: () => <div class="mock-board">{["To do", "Doing", "Done"].map((c, i) => <div key={c} class="mock-col"><b>{c}</b>{Array.from({ length: 3 - i }, (_, j) => <span key={j} class="mock-card" />)}</div>)}</div> },
  { tab: "Timeline", title: "A timeline with blockers", text: "Shift a bar by one day, link a blocker to a waiting task and see a warning when a start comes before its blocker is due.",
    mock: () => <div class="mock-lanes">{[[0, 40], [30, 50], [70, 25], [20, 45]].map(([l, w], i) => <div key={i} class="mock-lane"><span style={{ marginLeft: `${l}%`, width: `${w}%` }} /></div>)}</div> },
  { tab: "Workload", title: "A workload grid by the day", text: "Effort spreads over working days, and anyone over capacity is hatched and labelled before the week begins.",
    mock: () => <div class="mock-grid">{Array.from({ length: 15 }, (_, i) => <span key={i} class={i === 8 ? "over" : ""}>{["4", "4", "7.3", "3.3", "5.8"][i % 5]}</span>)}</div> },
  { tab: "Rules", title: "Rules that run once and say so", text: "Build a rule from a trigger, a condition and an action. Every run is recorded, indented by how deep the chain went.",
    mock: () => <div class="mock-steps">{["When Stage changes to Ready", "If Priority is High", "Then move to Review"].map((s, i) => <div key={s} class={i === 0 ? "open" : ""}>{s}</div>)}</div> },
];

function Showcase() {
  const [active, setActive] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(SHOWCASE.length - 1, index));
    setActive(next);
    const card = track.current?.children[next] as HTMLElement | undefined;
    if (card && track.current) {
      const left = card.offsetLeft - (track.current.clientWidth - card.clientWidth) / 2;
      track.current.scrollTo({ left, behavior: reducedMotion() ? "auto" : "smooth" });
    }
  };
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let best = 0;
    [...el.children].forEach((child, i) => {
      const c = child as HTMLElement;
      if (Math.abs(c.offsetLeft + c.clientWidth / 2 - center) < Math.abs((el.children[best] as HTMLElement).offsetLeft + (el.children[best] as HTMLElement).clientWidth / 2 - center)) best = i;
    });
    setActive(best);
  };
  return (
    <section class="showcase reveal" aria-labelledby="showcase-title">
      <h2 id="showcase-title" class="display-section on-dark">One week, five views</h2>
      <div role="tablist" aria-label="Showcase views" class="showcase-tabs">
        {SHOWCASE.map((s, i) => (
          <button key={s.tab} type="button" role="tab" aria-selected={active === i} class={`chip chip-dark${active === i ? " is-active" : ""}`} tabIndex={active === i ? 0 : -1}
            onClick={() => goTo(i)}>{s.tab}</button>
        ))}
      </div>
      <div class="showcase-track" ref={track} onScroll={onScroll} role="region" aria-label="Showcase cards" tabIndex={0}>
        {SHOWCASE.map((s, i) => (
          <article key={s.tab} class={`showcase-card${active === i ? " is-active" : ""}`}>
            <div class="icon-tile" aria-hidden="true"><Icon name={["menu", "user", "arrow-right", "download", "check"][i] as "menu"} size={30} /></div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            <div class="mockup" aria-hidden="true">{s.mock()}</div>
          </article>
        ))}
      </div>
      <div class="showcase-controls">
        <button type="button" class="round-button on-dark" aria-label="Previous view" disabled={active === 0} onClick={() => goTo(active - 1)}><Icon name="arrow-right" size={20} /></button>
        <div class="dots">{SHOWCASE.map((s, i) => <button key={s.tab} type="button" class={`dot-button${active === i ? " is-active" : ""}`} aria-label={`Show ${s.tab}`} onClick={() => goTo(i)}><span /></button>)}</div>
        <button type="button" class="round-button on-dark" aria-label="Next view" disabled={active === SHOWCASE.length - 1} onClick={() => goTo(active + 1)}><Icon name="arrow-right" size={20} /></button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ story, band, footer */

const FOOTER = [
  { title: "Work", links: ["Lists", "Boards", "Timelines", "Workload"] },
  { title: "Rules", links: ["Triggers", "Conditions", "Actions", "Run history"] },
  { title: "Teams", links: ["Office ops", "Content", "Client work", "Facilities"] },
  { title: "Learn", links: ["Sample form", "Repeat rules", "Formulas", "Goals"] },
  { title: "Corran & Bly", links: ["About", "Contact", "Privacy note", "Terms note"] },
];

function Footer() {
  return (
    <footer class="site-footer">
      <div class="footer-top">
        <a class="brand on-dark" href="/" aria-label="Everyweek home"><LogoMark /><span class="wordmark">Everyweek</span></a>
        <div class="footer-columns">
          {FOOTER.map((c) => (
            <div key={c.title} class="footer-column">
              <h2 class="footer-title">{c.title}</h2>
              <ul class="plain-list">{c.links.map((l) => <li key={l}><a href="/account">{l}</a></li>)}</ul>
            </div>
          ))}
        </div>
      </div>
      <div class="footer-bottom">
        <p class="fine">© 2026 Corran &amp; Bly. Every person, team and business in Everyweek is invented.</p>
        <button type="button" class="round-button on-dark" aria-label="Back to top" onClick={() => scrollTo({ top: 0 })}><Icon name="arrow-up" size={20} /></button>
      </div>
    </footer>
  );
}

function useReveal(): void {
  useMount(() => {
    if (reducedMotion() || typeof IntersectionObserver === "undefined") return undefined;
    const targets = [...document.querySelectorAll<HTMLElement>(".reveal")];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    targets.forEach((t) => { t.classList.add("will-reveal"); observer.observe(t); });
    const settle = setTimeout(() => targets.forEach((t) => t.classList.add("is-visible")), 2500);
    return () => { observer.disconnect(); clearTimeout(settle); };
  }, []);
}

export function Welcome() {
  useReveal();
  return (
    <div class="welcome">
      <Hero />
      <Showcase />
      <section class="story reveal" aria-labelledby="story-title">
        <div class="story-art" aria-hidden="true" />
        <figure class="story-quote">
          <h2 id="story-title" class="sr-only">From a team lead</h2>
          <blockquote>We used to rebuild the week by hand every Monday. Now the repeats arrive on their own, the approvals are on record, and I only look at who is over capacity.</blockquote>
          <figcaption><strong>Mirela Anders</strong><span class="muted">Kitchen operations lead, Larder Street Kitchen</span></figcaption>
        </figure>
      </section>
      <section class="start-band reveal" aria-labelledby="start-title">
        <h2 id="start-title">Start your workspace</h2>
        <a class="pill pill-light" href="/account">Get started</a>
        <hr />
        <p class="fine on-dark">Free to try with the sample team. Corran &amp; Bly invented every person and business you will see.</p>
      </section>
      <Footer />
    </div>
  );
}
