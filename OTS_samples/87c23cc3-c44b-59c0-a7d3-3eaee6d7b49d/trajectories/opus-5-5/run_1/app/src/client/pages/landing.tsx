import { useEffect, useState } from "preact/hooks";
import { emptyLayout } from "../../shared/layout.js";
import { HERO_SAMPLE } from "../../shared/templates.js";
import { api } from "../api.js";
import { Footer, Shell, useMe } from "../shell.js";
import { ShortcutTable } from "../workspace/dialogs.js";
import { Workspace } from "../workspace/workspace.js";

const DIALECTS = [
  "PostgreSQL",
  "MySQL",
  "Mortise text",
  "Plain-text diffs",
  "Byte-exact exports",
  "Original DDL kept",
  "Numbered versions",
  "Revocable links",
];

const FEATURES = [
  {
    id: "editor",
    heading: "Text first, diagram in step",
    emoji: "🔁",
    body: "Every entity, column and link lives in plain text you can diff and review. The diagram redraws a moment after you stop typing, and your caret never moves.",
    link: "Try text-first editing",
    window: ["entity books {", "  id int [key]", "  title text", "}"],
  },
  {
    id: "links",
    heading: "Draw a link, get a line of text",
    emoji: "✏️",
    body: "Drag from one column to another and Joinery types exactly one link line into your text. Comments, blank lines and everything else stay where you left them.",
    link: "Try drawing a link",
    window: ["}", "link loans.book_id >- books.id"],
  },
  {
    id: "import",
    heading: "Bring the DDL you already have",
    emoji: "📥",
    body: "Paste PostgreSQL or MySQL CREATE TABLE statements. The report shows which statements were added, merged or skipped, and the original file is kept byte for byte.",
    link: "Try importing DDL",
    window: ["CREATE TABLE books (", "  id integer PRIMARY KEY", ");"],
  },
  {
    id: "sharing",
    heading: "Share a link, take it back",
    emoji: "🔗",
    body: "Hand out view or edit links, invite people by email, and turn a link off whenever you like. Numbered versions let you compare and restore any earlier moment.",
    link: "Try sharing a link",
    window: ["View link · Invitation sent", "Edit link · Ben Ito, editor"],
  },
];

const CARDS = [
  ["Entities and columns", "Write an entity block, one typed column per line, with key, auto, required, unique and default settings."],
  ["Choices for fixed values", "Declare a choice once and use it as a column type; defaults are checked against its values."],
  ["Four kinds of link", "Many-to-one, one-to-many, one-to-one and many-to-many, each drawn with its own cardinality."],
  ["Groups and colours", "Group related entities into a tinted region and colour them; colours never touch your text."],
  ["Exports you can diff", "PostgreSQL and MySQL DDL that comes out byte for byte the same every time, with notes for anything lowered."],
  ["Versions you can restore", "Save named versions with gapless numbers, compare two of them, and bring any one back."],
];

export function LandingPage() {
  const { me, loaded } = useMe();
  const [stats, setStats] = useState<{ projects: number; exports: number } | null>(null);
  useEffect(() => {
    void api<{ projects: number; exports: number }>("GET", "/api/stats").then((r) => r.ok && setStats(r.data));
  }, []);
  const studio = loaded && me ? "/projects" : "/signin";
  return (
    <Shell>
      <section class="hero">
        <p class="credit muted">A studio by Pinewick Labs</p>
        <h1 class="hero-title">
          Write the tables, join them, and watch the diagram keep up <span aria-hidden="true">🪚</span>
        </h1>
        <p class="hero-subtitle muted">
          <span>Joinery reads a small schema language as you type and draws the diagram beside it.</span>
          <span>Draw a link on the diagram and the line appears in your text, ready for PostgreSQL or MySQL.</span>
        </p>
        <div role="region" aria-label="Project tally" class="tally">
          <p>
            {stats ? stats.projects : 0} schemas drafted and {stats ? stats.exports : 0} DDL files exported in this studio
          </p>
          <a class="pill-link" href="#sample">
            See the sample <span aria-hidden="true">👇</span>
          </a>
        </div>
        <a class="button button-primary button-hero" href={studio}>
          Open the studio
        </a>
      </section>
      <section role="region" aria-label="Sample editor" id="sample" class="sample-window app-window">
        <Workspace
          kind="sample"
          projectId={null}
          shareToken={null}
          name="Sample"
          role="owner"
          revision={0}
          text={HERO_SAMPLE}
          layout={emptyLayout()}
        />
      </section>
      <section role="region" aria-label="Supported dialects" class="dialects">
        <h2 class="dialects-heading muted">Ships to the dialects you deploy</h2>
        <ul aria-label="Supported dialects and formats" class="dialect-strip">
          {DIALECTS.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      </section>
      {FEATURES.map((f, i) => (
        <section id={f.id} class={`feature-row ${i % 2 ? "feature-row-flip" : ""}`} key={f.id}>
          <div class="feature-text">
            <h2>
              {f.heading} <span aria-hidden="true">{f.emoji}</span>
            </h2>
            <p class="muted">{f.body}</p>
            <a class="text-link" href={studio}>
              {f.link}
            </a>
          </div>
          <div class="feature-window app-window" aria-hidden="true">
            <div class="window-bar">
              <span />
              <span />
              <span />
            </div>
            <pre class="window-code">{f.window.join("\n")}</pre>
          </div>
        </section>
      ))}
      <section role="region" aria-label="Mortise at a glance" id="language" class="glance">
        <h2>
          Mortise at a glance <span aria-hidden="true">🧩</span>
        </h2>
        <div class="card-grid">
          {CARDS.map(([title, body]) => (
            <article class="card feature-card" key={title}>
              <h3>{title}</h3>
              <p class="muted">{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section role="region" aria-label="Import DDL banner" class="import-banner">
        <div>
          <p class="eyebrow">Import · PostgreSQL or MySQL</p>
          <h2>Already have CREATE TABLE statements? Bring them in.</h2>
          <p class="muted">
            Paste a dump or pick a file. Joinery reports every statement, merges tables by name and keeps your original bytes.
          </p>
        </div>
        <a class="button button-primary" href={studio}>
          Import DDL
        </a>
      </section>
      <section role="region" aria-label="Keyboard guide" id="keyboard" class="keyboard-guide">
        <h2>Keyboard guide</h2>
        <ShortcutTable />
      </section>
      <Footer />
    </Shell>
  );
}
