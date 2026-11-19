import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconAt, IconBack, IconForward, IconHome, IconNext } from "../lib/icons";
import { Link, reducedMotion } from "../lib/router";
import { drawDotField } from "./dotField";

const DEMO = ["Prepare the site", "Clear the lot", "Test the soil", "Plant the beds", "Tomatoes", "Herb spiral", "Find helpers", "Saturday crew"] as const;
const LEVEL = [0, 1, 1, 0, 1, 1, 0, 1] as const;
const HAS_CHILDREN = [true, false, false, true, false, false, true, false] as const;
const INDENT = 24;
const STAGGER_MS = 40;
const SLIDE_MS = 150;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";

function PaneWindow({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="pane" role={label === undefined ? undefined : "region"} aria-label={label}>
      <div className="pane-bar" aria-hidden="true">
        <IconBack width={16} height={16} /><IconForward width={16} height={16} /><IconHome width={16} height={16} />
      </div>
      <div className="pane-body">{children}</div>
    </div>
  );
}

function HeroDemo() {
  const reduce = reducedMotion();
  const [typed, setTyped] = useState<string[]>(reduce ? [...DEMO] : []);
  const [typing, setTyping] = useState(!reduce);
  const [nested, setNested] = useState<readonly boolean[]>(DEMO.map(() => false));
  const [parentsBold, setParentsBold] = useState(false);
  const [pressed, setPressed] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const started = useRef(false);

  useEffect(() => {
    const element = windowRef.current;
    if (reduce || element === null) return;
    const clear = () => { for (const timer of timers.current) clearTimeout(timer); timers.current = []; };
    const run = () => {
      if (started.current) return;
      started.current = true;
      let line = 0;
      let char = 0;
      const step = () => {
        const at = line;
        const text = DEMO[at] ?? "";
        char += 1;
        const shown = text.slice(0, char);
        setTyped((current) => [...current.slice(0, at), shown]);
        if (char < text.length) {
          timers.current.push(setTimeout(step, 30 + ((at * 7 + char * 13) % 3)));
        } else if (at < DEMO.length - 1) {
          line += 1;
          char = 0;
          timers.current.push(setTimeout(() => {
            setTyped((current) => [...current, ""]);
            timers.current.push(setTimeout(step, 30));
          }, 40));
        } else {
          timers.current.push(setTimeout(() => setTyping(false), 60));
        }
      };
      setTyped([""]);
      timers.current.push(setTimeout(step, 60));
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) run();
    }, { threshold: 0.2 });
    observer.observe(element);
    return () => { observer.disconnect(); clear(); started.current = false; };
  }, [reduce]);

  const ready = !typing && typed.length === DEMO.length;

  const slide = (index: number, from: number, to: number) => {
    const row = rows.current[index];
    if (row === undefined || row === null || reduce) return;
    row.animate(
      [{ transform: `translateX(${from}px)`, opacity: from < 0 ? 0 : 0.5 }, { transform: `translateX(${to}px)`, opacity: 1 }],
      { duration: SLIDE_MS, easing: EASE },
    );
  };

  const previous = useRef<readonly boolean[]>(nested);
  useLayoutEffect(() => {
    nested.forEach((value, index) => {
      if (value !== previous.current[index]) slide(index, value ? -INDENT : INDENT, 0);
    });
    previous.current = nested;
  });

  const toggle = () => {
    if (!ready) return;
    const next = !pressed;
    setPressed(next);
    setParentsBold(next);
    const children = LEVEL.flatMap((level, index) => (level === 1 ? [index] : []));
    children.forEach((index, order) => {
      const apply = () => {
        setNested((current) => current.map((value, at) => (at === index ? next : value)));
      };
      if (reduce || order === 0) apply();
      else timers.current.push(setTimeout(apply, order * STAGGER_MS));
    });
  };

  return (
    <div ref={windowRef}>
      <PaneWindow>
        <div className="demo" role="region" aria-label="Outline demo">
          <ul className="demo-list">
            {typed.map((text, index) => (
              <li
                key={index}
                ref={(element) => { rows.current[index] = element; }}
                className={`demo-row${nested[index] === true ? " is-nested" : ""}${parentsBold && HAS_CHILDREN[index] ? " is-parent" : ""}`}
              >
                <span className="demo-text">{text}</span>
                {typing && index === typed.length - 1 && <span className="demo-caret" aria-hidden="true" />}
              </li>
            ))}
          </ul>
          <div className="demo-add" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" /></svg></div>
          <div className="demo-foot">
            <button
              type="button" className="pill pill-outline" aria-pressed={pressed} aria-disabled={!ready} onClick={toggle}
            >
              Nest it
            </button>
          </div>
        </div>
      </PaneWindow>
    </div>
  );
}

const VIEWS = ["List", "Board", "Tasks", "Plain text"] as const;
type View = (typeof VIEWS)[number];

const GROUPS = [
  { title: "Prepare the site", items: ["Clear the lot", "Test the soil"] },
  { title: "Plant the beds", items: ["Tomatoes", "Herb spiral"] },
  { title: "Find helpers", items: ["Saturday crew"] },
] as const;

function DemoView({ view }: { view: View }) {
  if (view === "Board") {
    return (
      <div className="demo-board">
        {GROUPS.map((group) => (
          <div className="demo-column" key={group.title}>
            <p className="demo-column-title">{group.title}</p>
            {group.items.map((item) => <p className="demo-card" key={item}>{item}</p>)}
          </div>
        ))}
      </div>
    );
  }
  if (view === "Plain text") {
    return (
      <pre className="demo-plain">
        {GROUPS.map((group) => `- ${group.title}\n${group.items.map((item) => `  - ${item}`).join("\n")}`).join("\n")}
      </pre>
    );
  }
  return (
    <ul className="demo-list demo-list-static">
      {GROUPS.map((group) => (
        <li key={group.title} className="demo-row is-parent">
          <span className="demo-text">{group.title}</span>
          <ul>
            {group.items.map((item) => (
              <li className="demo-row is-nested-static" key={item}>
                {view === "Tasks" && <span className="demo-check" aria-hidden="true" />}
                <span className="demo-text">{item}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function ViewSwitcher() {
  const [view, setView] = useState<View>("List");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState({ left: 0, width: 0 });
  const at = VIEWS.indexOf(view);

  useLayoutEffect(() => {
    const measure = () => {
      const tab = tabs.current[at];
      if (tab !== null && tab !== undefined) setPill({ left: tab.offsetLeft, width: tab.offsetWidth });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [at]);

  return (
    <div className="switcher">
      <div className="switcher-controls">
        <button type="button" className="switcher-next" aria-label="Next view" onClick={() => setView(VIEWS[(at + 1) % VIEWS.length] ?? "List")}>
          <IconNext />
        </button>
        <div className="segments" role="tablist" aria-label="Demo views">
          <span className="segment-pill" aria-hidden="true" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />
          {VIEWS.map((name, index) => (
            <button
              key={name} type="button" role="tab" id={`tab-${index}`} aria-selected={name === view} aria-controls="demo-panel"
              tabIndex={name === view ? 0 : -1} className={`segment${name === view ? " is-active" : ""}`}
              ref={(element) => { tabs.current[index] = element; }} onClick={() => setView(name)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <PaneWindow>
        <div role="tabpanel" id="demo-panel" aria-labelledby={`tab-${at}`} className="demo-panel" key={view}>
          <DemoView view={view} />
        </div>
      </PaneWindow>
    </div>
  );
}

const KEYS: readonly [string[], string][] = [
  [["Enter"], "New bullet"],
  [["Tab"], "Indent"],
  [["Shift", "Tab"], "Outdent"],
  [["Ctrl", "↑"], "Move up"],
  [["Alt", "→"], "Zoom in"],
  [["Alt", "←"], "Zoom out"],
  [["Ctrl", "Enter"], "Complete"],
  [["Ctrl", "Shift", "M"], "Mirror"],
  [["Ctrl", "Z"], "Undo"],
];

const QUOTES = [
  ["I keep the whole allotment plan in one list and zoom into this week's jobs.", "Ines Varga, allotment secretary"],
  ["Chapters, scenes and beats, nested the way I actually think.", "Tomasz Lind, novelist"],
  ["I shared one branch with my lab partner and nothing else.", "Priya Nandakumar, student"],
] as const;

const FOOTER: readonly [string, readonly [string, string][]][] = [
  ["Twigline", [["Start your outline", "/signup"], ["Sign in", "/signin"], ["Top of page", "#top"]]],
  ["Outlining", [["Branch zoom", "#views"], ["Keyboard keys", "#keys"], ["Four views", "#views"]]],
  ["Sharing", [["Owners", "#roles"], ["Collaborators", "#roles"], ["One branch only", "#roles"]]],
  ["Downloads", [["Plain text", "#downloads"], ["Markdown", "#downloads"], ["OPML", "#downloads"]]],
  ["Pellwick & Ash", [["About the studio", "#top"], ["Twigline notes", "#views"], ["Contact", "#top"]]],
];

function Pills() {
  return (
    <div className="hero-pills">
      <Link to="/signup" className="pill pill-sky">Start your outline</Link>
      <Link to="/signin" className="pill pill-quiet"><IconAt /> Sign in with email</Link>
    </div>
  );
}

export function Marketing() {
  const field = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = field.current;
    if (canvas === null) return;
    const paint = () => drawDotField(canvas);
    paint();
    window.addEventListener("resize", paint);
    return () => window.removeEventListener("resize", paint);
  }, []);

  return (
    <div id="top" className="marketing">
      <section className="hero">
        <canvas ref={field} className="dot-field" aria-hidden="true" />
        <div className="hero-inner">
          <h1><span>Think in branches.</span> <span>Zoom into the one that matters.</span></h1>
          <p className="lead">One outline for plans, drafts and lists. Fold it, mirror it, and share a single branch.</p>
          <Pills />
          <div className="hero-window"><HeroDemo /></div>
        </div>
      </section>

      <section className="strip band" id="keys" aria-labelledby="keys-title">
        <div className="wrap">
          <p className="strip-label" id="keys-title">Every move has a key</p>
          <ul className="strip-keys">
            {KEYS.map(([keys, action]) => (
              <li key={action}>
                <span className="strip-glyphs">{keys.map((key) => <kbd key={key}>{key}</kbd>)}</span>
                <span className="strip-action">{action}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="feature" id="views" aria-labelledby="views-title">
        <div className="wrap">
          <h2 id="views-title">One list, four ways to see it</h2>
          <ViewSwitcher />
        </div>
      </section>

      <section className="quotes band" aria-label="What people say">
        <div className="wrap quote-grid">
          {QUOTES.map(([quote, who]) => (
            <figure className="quote-card" key={who}>
              <blockquote><p>“{quote}”</p></blockquote>
              <figcaption>— {who}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="roles" id="roles" aria-label="Owners and collaborators">
        <div className="wrap">
          <div className="role-grid">
            <article className="role-card">
              <h2>Outline owner</h2>
              <ul><li>Write, zoom, mirror and share any branch</li><li>Undo from every tab</li><li>Download as plain text, Markdown or OPML</li></ul>
              <Link to="/signup" className="pill pill-sky pill-block">Start your outline</Link>
            </article>
            <article className="role-card">
              <h2>Collaborator</h2>
              <ul><li>Edit only the branch you were invited to</li><li>See the owner's edits live</li><li>Download that branch</li></ul>
              <Link to="/signup" className="pill pill-sky pill-block">Start your outline</Link>
            </article>
          </div>
          <div className="callout">
            <span>Press Alt and an arrow key to zoom into or out of any bullet.</span>
            <a className="inline-link" href="#keys">See every key →</a>
          </div>
        </div>
      </section>

      <section className="downloads band" id="downloads" aria-labelledby="downloads-title">
        <div className="wrap">
          <h2 id="downloads-title">Take your outline with you</h2>
          <ul className="tiles">
            {["Plain text", "Markdown", "OPML"].map((name, index) => (
              <li key={name}>
                <Link to="/signup" className="tile">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                    {index === 0 && <path d="M6 4h9l3 3v13H6zM9 11h6M9 15h6" />}
                    {index === 1 && <path d="M4 7h16v10H4zM7 14v-4l2.5 2.5L12 10v4M16 10v4m0 0-1.5-1.5M16 14l1.5-1.5" />}
                    {index === 2 && <path d="M8 8 4 12l4 4M16 8l4 4-4 4M13.5 6l-3 12" />}
                  </svg>
                  <span>{name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="closing" aria-labelledby="closing-title">
        <div className="wrap closing-inner">
          <h2 id="closing-title">Your next plan already has branches.</h2>
          <p className="lead">Start with one thought and let it grow.</p>
          <Pills />
        </div>
      </section>

      <footer className="footer">
        <div className="footer-grid">
          {FOOTER.map(([title, links]) => (
            <div key={title}>
              <h3>{title}</h3>
              <ul>
                {links.map(([label, to]) => (
                  <li key={label}>{to.startsWith("/") ? <Link to={to} className="textlink">{label}</Link> : <a className="textlink" href={to}>{label}</a>}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </footer>
    </div>
  );
}
