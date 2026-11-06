// The public site: home, pricing, start trial, sign-in and the invitation form.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { dollars } from "../../shared/format.js";
import { PLAN_CATALOG } from "../../shared/plans.js";
import { Link, Mark } from "../ui.js";

export function PublicLayout({ children }: { children: ComponentChildren }) {
  return (
    <div class="public">
      <header class="masthead">
        <Link class="brand" href="/"><Mark />Orrery Studio</Link>
        <nav aria-label="Main" class="mainnav">
          <Link href="/">Product</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/signup" class="cta">Start free trial</Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer class="footer">Orrery Labs · Orrery Studio. Scenes, versions and embeds you can trace to every edit.</footer>
    </div>
  );
}

function Section({ n, id, title, children, figure, wide = false }: { n: string; id: string; title: string; children: ComponentChildren; figure?: ComponentChildren; wide?: boolean }) {
  return (
    <section class="section" aria-labelledby={id}>
      <span class="rail" aria-hidden="true">{n}</span>
      <h2 id={id}>{title}</h2>
      <div class={`copy${wide ? " wide" : ""}`}>{children}</div>
      {figure ? <div class="figure">{figure}</div> : null}
    </section>
  );
}

/** Drafted diagram: an operation log ruler with a playhead pulled back to an earlier tick. */
function RewindDrawing() {
  const ticks = [40, 80, 120, 160, 200, 240, 280, 320, 360, 400];
  return (
    <svg viewBox="0 0 440 200" role="img" aria-label="An operation log ruler with ticks, a playhead pulled back to operation 6 and later ticks faded">
      <rect x="20" y="20" width="400" height="110" fill="none" stroke="var(--putty)" />
      <g stroke="var(--ink)" fill="none" stroke-width="1.4">
        <ellipse cx="150" cy="78" rx="34" ry="26" stroke-dasharray="4 3" stroke="var(--ink-muted)" />
        <ellipse cx="220" cy="78" rx="34" ry="26" />
        <path d="M150 52c10-26 60-26 70 0" />
      </g>
      <rect x="182" y="48" width="76" height="60" fill="none" stroke="var(--cobalt)" stroke-width="2" />
      <line x1="20" y1="170" x2="420" y2="170" stroke="var(--ink)" />
      {ticks.map((x, i) => (i % 3 === 2
        ? <rect key={x} x={x - 4} y={158} width="8" height="8" fill="var(--cobalt)" opacity={i > 5 ? 0.35 : 1} />
        : <circle key={x} cx={x} cy={162} r="4" fill="var(--cobalt)" opacity={i > 5 ? 0.35 : 1} />))}
      <line x1="260" y1="140" x2="260" y2="176" stroke="var(--ink)" stroke-width="2" />
      <path d="M254 140h12l-6 8z" fill="var(--ink)" />
      <text x="20" y="194" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-muted)">Operation 6 of 10 · transform.set on Left cup</text>
    </svg>
  );
}

/** Drafted diagram: a person and an agent token claiming the same object; one lock holder. */
function AgentsDrawing() {
  return (
    <svg viewBox="0 0 440 200" role="img" aria-label="A person and an agent token reach for one object; only one holds its lock">
      <rect x="170" y="60" width="100" height="80" fill="none" stroke="var(--ink)" stroke-width="1.4" />
      <path d="M205 60v-14a15 15 0 0 1 30 0v14" fill="none" stroke="var(--cobalt)" stroke-width="2" />
      <circle cx="70" cy="100" r="22" fill="none" stroke="var(--ink)" stroke-width="1.4" />
      <rect x="348" y="78" width="44" height="44" fill="none" stroke="var(--ink)" stroke-width="1.4" />
      <line x1="92" y1="100" x2="170" y2="100" stroke="var(--cobalt)" stroke-width="2" />
      <line x1="348" y1="100" x2="270" y2="100" stroke="var(--vermilion)" stroke-width="2" stroke-dasharray="5 4" />
      <text x="40" y="150" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-muted)">person · holder</text>
      <text x="318" y="150" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-muted)">agent · locked</text>
    </svg>
  );
}

/** Drafted diagram: an agent token's tag feeding square ticks onto the log, and the publish action it can never take. */
function TokenDrawing() {
  return (
    <svg viewBox="0 0 440 200" role="img" aria-label="An edit-scope agent token adds square ticks to the operation log; publishing is crossed out">
      <rect x="20" y="40" width="130" height="72" fill="none" stroke="var(--ink)" stroke-width="1.4" />
      <circle cx="36" cy="56" r="4" fill="none" stroke="var(--ink)" />
      <text x="34" y="80" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink)">Catalogue poser</text>
      <text x="34" y="98" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--ink-muted)">scope edit · expires</text>
      <path d="M150 76h60" stroke="var(--cobalt)" stroke-width="2" />
      <line x1="210" y1="150" x2="420" y2="150" stroke="var(--ink)" />
      {[230, 270, 310, 350, 390].map((x, i) => (i % 2 === 0
        ? <circle key={x} cx={x} cy={142} r="4" fill="var(--cobalt)" />
        : <rect key={x} x={x - 4} y={138} width="8" height="8" fill="var(--cobalt)" />))}
      <path d="M210 76h40v62" fill="none" stroke="var(--cobalt)" stroke-width="1.4" stroke-dasharray="4 3" />
      <rect x="290" y="44" width="110" height="40" fill="none" stroke="var(--putty)" />
      <text x="312" y="69" font-family="IBM Plex Mono, monospace" font-size="12" fill="var(--ink-muted)">publish</text>
      <path d="M292 46l106 36M398 46L292 82" stroke="var(--vermilion)" stroke-width="2" />
    </svg>
  );
}

export function Home() {
  return (
    <PublicLayout>
      <div class="sheet-page">
        <div class="hero">
          <h1>3D scenes your whole team can trace</h1>
          <p class="lede">Orrery Studio is a shared browser workspace for interactive product scenes: build states and transitions together, review them, and publish an embed that traces back to the exact version behind it.</p>
          <div class="actions">
            <Link class="button primary" href="/signup">Start free trial</Link>
            <Link class="button" href="/pricing">Compare plans</Link>
          </div>
        </div>
        <Section n="01" id="what" title="What Orrery Studio is" figure={<AgentsDrawing />}>
          <p>One governed workspace where brand and product-marketing teams build the 3D scene behind a launch page: a product that turns on hover, a camera that glides in on scroll, a colourway that changes on click.</p>
          <p>Owners decide who may publish. Editors work side by side with object locks instead of silent overwrites. Every published embed points to a saved, approved version.</p>
        </Section>
        <Section n="02" id="rewind" title="How the operation-log rewind works" figure={<RewindDrawing />}>
          <p>Every change is an operation with its author, its server time and its stored inverse. Drag the timeline back and the viewport redraws the scene as it was, outlines what changed and counts the numbers back.</p>
          <p>Settle on any tick and restore it as new operations: the scene returns to that point while the history stays intact.</p>
        </Section>
        <Section n="03" id="agents" title="Agents under the same rules as people" figure={<TokenDrawing />}>
          <p>Catalogue bots and framing checks get their own tokens with a name, a scope and an expiry. They read the graph, apply batches and set camera views under the same permissions, locks and undo as a person.</p>
          <p>An edit-scope token can never publish, change billing or issue tokens, however the request is shaped. Its work shows on the timeline as square ticks.</p>
        </Section>
        <Section n="04" id="plans" title="Plans" wide>
          <p>Two plans, billed monthly or annually. Extra seats are available on both.</p>
          <div class="plan-cards">
            {Object.values(PLAN_CATALOG).map((plan) => (
              <div class="panel plan-card" key={plan.name}>
                <h3>{plan.name}</h3>
                <p class="price num">{dollars(plan.prices.monthly.base)} / month</p>
                <p>{plan.includedSeats} seats included, up to {plan.tokenLimit} agent tokens.</p>
              </div>
            ))}
          </div>
          <p><Link class="button" href="/pricing">See the full comparison</Link></p>
        </Section>
        <Section n="05" id="start" title="Start a trial">
          <p>Fourteen days on the Team plan with 8 seats, no card needed. Bring your team and an agent token or two.</p>
          <p><Link class="button primary" href="/signup">Start free trial</Link></p>
        </Section>
      </div>
    </PublicLayout>
  );
}

const SUFFIX = { monthly: "/ month", annual: "/ year" } as const;

export function Pricing() {
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const suffix = SUFFIX[period];
  const team = PLAN_CATALOG.team, business = PLAN_CATALOG.business;
  const row = (label: string, team: ComponentChildren, business: ComponentChildren) => (
    <tr role="row"><th scope="row" role="rowheader">{label}</th><td role="cell" data-plan="Team">{team}</td><td role="cell" data-plan="Business">{business}</td></tr>
  );
  return (
    <PublicLayout>
      <div class="sheet-page">
        <div class="pricing-head">
          <h1>Plans for teams that publish in 3D</h1>
          <div role="radiogroup" aria-label="Billing period" class="choices">
            {(["monthly", "annual"] as const).map((value) => (
              <label class="choice" key={value}>
                <input type="radio" name="period" value={value} checked={period === value} onChange={() => setPeriod(value)} />
                {value === "monthly" ? "Monthly" : "Annual"}
              </label>
            ))}
          </div>
        </div>
        <table class="compare" aria-label="Compare plans" role="table">
          <thead><tr role="row"><th role="columnheader"><span class="visually-hidden">Feature</span></th><th role="columnheader" scope="col">Team</th><th role="columnheader" scope="col">Business</th></tr></thead>
          <tbody>
            {row("Price", <span class="price num">{dollars(team.prices[period].base)} {suffix}</span>, <span class="price num">{dollars(business.prices[period].base)} {suffix}</span>)}
            {row("Included seats", <span class="num">{team.includedSeats}</span>, <span class="num">{business.includedSeats}</span>)}
            {row("Extra seat", <span class="num">{dollars(team.prices[period].seat)} {suffix}</span>, <span class="num">{dollars(business.prices[period].seat)} {suffix}</span>)}
            {row("Agent tokens", `Up to ${team.tokenLimit}`, `Up to ${business.tokenLimit}`)}
            {row("Scheduled publishing", "Included", "Included")}
            {row("Review links", "Included", "Included")}
          </tbody>
        </table>
        <div class="cta-row">
          <Link class="button primary" href="/signup">Start free trial</Link>
          <span class="muted">14 days on Team with 8 seats. No card needed.</span>
        </div>
      </div>
    </PublicLayout>
  );
}

