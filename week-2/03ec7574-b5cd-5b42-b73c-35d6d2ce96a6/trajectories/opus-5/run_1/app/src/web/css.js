export const STYLESHEET = `
:root {
  --paper: #ffffff;
  --mist: #f4f6fa;
  --haze: #ecedf7;
  --ink: #0d1117;
  --graphite: #353c47;
  --slate: #656f81;
  --line: #e5e6f0;
  --border: #6c7483;
  --violet: #5b3df5;
  --violet-tint: #e9e4ff;
  --success-bg: #d8f2e5;
  --success-ink: #0a5336;
  --danger: #be0f28;
  --danger-bg: #fde7ea;
  --info-bg: #dbe7ff;
  --info-ink: #10367a;
  --muted-bg: #ebedf1;
  --muted-ink: #434e5b;
  --shadow: 0 18px 40px rgba(13, 17, 23, 0.08);
  --radius-card: 18px;
  --radius-input: 10px;
  --display: "Helvetica Neue", Arial, system-ui, sans-serif;
  --body: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  max-width: 100%;
  overflow-x: hidden;
}

body {
  background: var(--paper);
  color: var(--graphite);
  font-family: var(--body);
  font-size: 16px;
  font-weight: 400;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 { color: var(--ink); font-weight: 600; line-height: 1.2; margin: 0 0 0.5em; }

.display { font-family: var(--display); font-weight: 400; letter-spacing: -0.02em; }
.display .phrase { color: var(--slate); }

h1.display { font-size: clamp(2.2rem, 5vw, 4rem); }
h2.display { font-size: clamp(1.6rem, 3.2vw, 2.5rem); }
h3 { font-size: 1.25rem; }

p { margin: 0 0 1rem; }
a { color: var(--ink); }
a:hover { text-decoration: underline; }

.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--ink);
  color: #fff;
  padding: 0.75rem 1rem;
  z-index: 100;
}
.skip-link:focus { left: 0; }

:focus-visible {
  outline: 3px solid var(--violet);
  outline-offset: 2px;
  border-radius: 4px;
}

.shell { width: min(1180px, 100% - 3rem); margin: 0 auto; }

/* Header */
.site-header {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--line);
}
.site-header .bar { display: flex; align-items: center; gap: 1.25rem; padding: 0.85rem 0; }
.wordmark { display: inline-flex; align-items: center; gap: 0.5rem; font-family: var(--display); font-size: 1.3rem; color: var(--ink); text-decoration: none; font-weight: 500; }
.wordmark .icon { width: 20px; height: 20px; color: var(--violet); }
.menu-row { display: flex; align-items: center; gap: 0.35rem; margin-left: 0.5rem; }
.header-actions { margin-left: auto; display: flex; align-items: center; gap: 0.6rem; }

.menu-button {
  display: inline-flex; align-items: center; gap: 0.3rem;
  background: none; border: 0; border-radius: 999px;
  font: inherit; color: var(--graphite); padding: 0.5rem 0.7rem; cursor: pointer;
  min-height: 44px;
}
.menu-button:hover { color: var(--violet); }
.menu-button .icon { width: 16px; height: 16px; transition: transform 0.16s ease; }
.menu-button[aria-expanded="true"] .icon { transform: rotate(180deg); }

.menu-panel {
  position: absolute;
  margin-top: 0.4rem;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-input);
  box-shadow: var(--shadow);
  padding: 0.75rem;
  display: grid;
  gap: 0.25rem;
  min-width: 280px;
  z-index: 50;
}
.menu-panel[hidden] { display: none; }
.menu-panel a { display: block; padding: 0.5rem 0.6rem; border-radius: 8px; text-decoration: none; }
.menu-panel a:hover { background: var(--haze); }
.menu-panel .caption { display: block; color: var(--slate); font-size: 0.85rem; font-weight: 300; }

.capsule {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.45rem;
  border-radius: 999px; padding: 0.7rem 1.25rem; min-height: 44px;
  font: inherit; font-weight: 500; text-decoration: none; cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
.capsule .icon { width: 16px; height: 16px; }
.capsule-dark { background: var(--ink); color: #fff; border: 1px solid var(--ink); }
.capsule-dark:hover { background: var(--violet); border-color: var(--violet); color: #fff; text-decoration: none; }
.capsule-light { background: var(--paper); color: var(--ink); border: 1px solid var(--border); }
.capsule-light:hover { border-color: var(--violet); color: var(--violet); text-decoration: none; }
.capsule[disabled] { opacity: 0.7; cursor: progress; }

/* Sections */
main { display: block; }
section.band { background: var(--mist); }
section { padding: clamp(3rem, 7vw, 6rem) 0; }
.section-head { max-width: 46rem; margin-bottom: 2.5rem; }

.card-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(4, 1fr); }
.card-grid.two { grid-template-columns: repeat(2, 1fr); }
.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow);
  padding: 1.5rem;
}
.card h3 { font-size: 1.25rem; margin-bottom: 0.35rem; }
.card p { color: var(--graphite); margin: 0; }
.card .tile {
  width: 42px; height: 42px; border-radius: 12px; background: var(--mist);
  display: inline-flex; align-items: center; justify-content: center; color: var(--violet); margin-bottom: 1rem;
}
.card-link { display: block; text-decoration: none; transition: transform 0.2s ease, border-color 0.2s ease; }
.card-link:hover, .card-link:focus-visible { transform: translateY(-4px); border-color: var(--violet); text-decoration: none; }

.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
.stat .value { font-family: var(--display); font-size: clamp(1.8rem, 3vw, 2.6rem); color: var(--ink); }
.stat .label { color: var(--slate); font-weight: 300; }

.case-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
.case-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-card); box-shadow: var(--shadow); overflow: hidden; }
.case-art { background: var(--mist); color: var(--ink); font-family: var(--display); font-size: 1.5rem; padding: 2rem 1.25rem; }
.case-card p { padding: 1.25rem; margin: 0; }

/* Hero */
.hero { padding-top: clamp(2.5rem, 6vw, 5rem); }
.hero-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 3rem; align-items: center; }
.hero .lead { font-size: 1.15rem; color: var(--graphite); max-width: 34rem; }
.hero-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-top: 1.5rem; }
.preview {
  background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-card);
  box-shadow: var(--shadow); padding: 1.5rem;
}
.preview .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.preview .amount { font-family: var(--display); font-size: 2rem; color: var(--ink); }
.progress { background: var(--haze); border-radius: 999px; height: 10px; overflow: hidden; }
.progress .fill { background: var(--violet-tint); height: 100%; width: 50%; border-radius: 999px; transition: width 0.42s cubic-bezier(0.22, 1.2, 0.36, 1); }
.dots { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
.dot { width: 22px; height: 22px; border-radius: 999px; background: var(--violet-tint); color: var(--ink); font-size: 0.7rem; display: inline-flex; align-items: center; justify-content: center; }

/* Badges */
.badge {
  display: inline-flex; align-items: center; gap: 0.35rem; border-radius: 999px;
  padding: 0.2rem 0.7rem; font-size: 0.82rem; font-weight: 500; white-space: nowrap;
}
.badge-executed, .badge-active { background: var(--success-bg); color: var(--success-ink); }
.badge-pending_approval { background: var(--info-bg); color: var(--info-ink); }
.badge-rejected { background: var(--danger); color: #fff; }
.badge-cancelled, .badge-expired, .badge-frozen { background: var(--muted-bg); color: var(--muted-ink); }

/* Footer */
.site-footer { background: var(--mist); border-top: 1px solid var(--line); padding: 3rem 0 2rem; }
.footer-grid { display: grid; grid-template-columns: 1.4fr repeat(4, 1fr); gap: 2rem; }
.footer-grid h4 { font-size: 0.95rem; }
.footer-grid ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.4rem; }
.footer-grid a { color: var(--graphite); text-decoration: none; }
.footer-grid a:hover { color: var(--violet); text-decoration: underline; }
.footer-note { color: var(--slate); margin-top: 2rem; }

/* Forms */
form { margin: 0; }
.field { display: grid; gap: 0.35rem; margin-bottom: 1rem; }
label { color: var(--ink); font-weight: 500; }
input, select, textarea {
  font: inherit; color: var(--ink); background: var(--paper);
  border: 1px solid var(--border); border-radius: var(--radius-input);
  padding: 0.65rem 0.75rem; min-height: 44px; width: 100%;
}
textarea { min-height: 120px; }
.help { color: var(--slate); font-size: 0.88rem; font-weight: 300; }
.field-error { color: var(--danger); font-size: 0.9rem; font-weight: 500; }
[aria-invalid="true"] { border-color: var(--danger); }
.form-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-card); box-shadow: var(--shadow); padding: 1.5rem; }
fieldset { border: 0; margin: 0 0 1rem; padding: 0; }

.alert { background: var(--danger-bg); color: var(--danger); border-radius: var(--radius-input); padding: 0.75rem 1rem; font-weight: 500; }
.alert:empty { display: none; }

/* Toasts */
.toast-region { position: fixed; right: 1rem; bottom: 1rem; z-index: 80; display: grid; gap: 0.5rem; }
.toast {
  background: var(--ink); color: #fff; border-radius: 12px; padding: 0.75rem 1rem;
  box-shadow: var(--shadow); animation: toast-in 0.25s ease;
}
@keyframes toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

/* Tables */
table { border-collapse: collapse; width: 100%; }
caption { text-align: left; font-weight: 600; color: var(--ink); padding-bottom: 0.5rem; }
th, td { text-align: left; padding: 0.6rem 0.7rem; border-bottom: 1px solid var(--line); font-size: 0.92rem; }
thead th { background: var(--mist); color: var(--ink); font-weight: 600; }
td.num, th.num { font-variant-numeric: tabular-nums; }

/* Console */
.console { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.rail { background: var(--mist); border-right: 1px solid var(--line); padding: 1rem; position: sticky; top: 0; align-self: start; height: 100vh; }
.rail nav ul { list-style: none; margin: 1rem 0 0; padding: 0; display: grid; gap: 0.25rem; }
.rail a { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.7rem; border-radius: 10px; text-decoration: none; color: var(--graphite); min-height: 44px; }
.rail a:hover { color: var(--violet); background: var(--paper); text-decoration: none; }
.rail a[aria-current="page"] { background: var(--violet-tint); color: var(--ink); font-weight: 500; }
.rail .count { margin-left: auto; background: var(--violet); color: #fff; border-radius: 999px; padding: 0 0.5rem; font-size: 0.8rem; }
.workspace { padding: 1.5rem 2rem 4rem; max-width: 100%; }
.topbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }
.topbar .who { margin-left: auto; text-align: right; color: var(--slate); font-size: 0.9rem; }
.console h1 { font-size: 1.6rem; }
.console td, .console th { font-variant-numeric: tabular-nums; }
.console .card, .panel { background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-card); box-shadow: var(--shadow); padding: 1.25rem; }
.panel + .panel { margin-top: 1.25rem; }
.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
.stat-cards .card { padding: 1.1rem; }
.stat-cards .value { font-family: var(--display); font-size: 1.9rem; color: var(--ink); }
.wallet-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; align-items: start; }
.facts { display: grid; gap: 0.5rem; }
.facts div { display: flex; gap: 0.75rem; }
.facts dt { color: var(--slate); min-width: 9rem; }
.facts dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; }
.inline-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.result-line { margin-top: 0.75rem; font-weight: 500; color: var(--ink); }
.intent-row-details { background: var(--mist); }
.inbox-card { border: 1px solid var(--line); border-radius: var(--radius-card); padding: 1rem; box-shadow: var(--shadow); margin-bottom: 1rem; }
.inbox-card .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; }
.inbox-card .label { color: var(--slate); font-size: 0.85rem; display: block; }
.inbox-actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
.frozen-banner { background: var(--muted-bg); color: var(--muted-ink); border-radius: var(--radius-card); padding: 1rem; font-weight: 500; }
dialog { border: 1px solid var(--line); border-radius: var(--radius-card); box-shadow: var(--shadow); padding: 1.5rem; max-width: 30rem; }
dialog::backdrop { background: rgba(13, 17, 23, 0.4); }
.dialog-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
.tabs { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
.tab { border: 1px solid var(--border); background: var(--paper); border-radius: 999px; padding: 0.5rem 1rem; font: inherit; cursor: pointer; min-height: 44px; }
.tab[aria-selected="true"] { background: var(--violet-tint); border-color: var(--violet); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; }
.spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.5); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; }
.capsule-light .spinner { border: 2px solid var(--haze); border-top-color: var(--violet); }
@keyframes spin { to { transform: rotate(360deg); } }
.working-word { font-weight: 500; }
.batch-line { display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: 0.5rem; align-items: end; margin-bottom: 0.75rem; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
.menu-sheet { display: none; }
.rail-mobile { display: none; }
.menu-holder { position: relative; }
.mobile-only { display: none; }

/* Motion */
.reveal { opacity: 0; transform: translateY(24px); }
.reveal.shown { animation: spring-rise 0.62s cubic-bezier(0.22, 1.2, 0.36, 1) forwards; }
@keyframes spring-rise {
  0% { opacity: 0; transform: translateY(24px); }
  60% { opacity: 1; transform: translateY(-5px); }
  100% { opacity: 1; transform: none; }
}
.blur-word { display: inline-block; filter: blur(8px); opacity: 0; animation: blur-in 0.45s ease forwards; }
@keyframes blur-in { to { filter: blur(0); opacity: 1; } }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
  .reveal { opacity: 1; transform: none; }
  .blur-word { filter: none; opacity: 1; }
  .card-link:hover, .card-link:focus-visible { transform: none; }
}

/* Tablet */
@media (max-width: 1100px) {
  .console { grid-template-columns: 76px 1fr; }
  .rail .label { position: absolute; left: -9999px; }
  .rail a:hover .label, .rail a:focus-visible .label { position: static; left: auto; }
  .stat-cards { grid-template-columns: repeat(2, 1fr); }
  .card-grid, .case-row, .stats, .footer-grid { grid-template-columns: repeat(2, 1fr); }
  .wallet-layout { grid-template-columns: 1fr; }
  .hero-grid { grid-template-columns: 1fr; }
  .workspace { padding: 1.25rem; }
}

/* Phone */
@media (max-width: 760px) {
  .shell { width: min(100% - 2rem, 640px); }
  .mobile-only { display: inline-flex; }
  .menu-row, .header-actions .desktop-only { display: none; }
  .menu-sheet { display: none; }
  .menu-sheet[data-open="true"] {
    display: block; position: fixed; inset: 0; background: var(--paper); z-index: 60; padding: 1.5rem; overflow-y: auto;
  }
  .menu-sheet nav { display: grid; gap: 0.75rem; }
  .card-grid, .card-grid.two, .footer-grid, .wallet-layout { grid-template-columns: 1fr; }
  .stats { grid-template-columns: repeat(2, 1fr); }
  .case-row {
    grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 78%;
    overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 0.5rem;
  }
  .case-card { scroll-snap-align: start; }
  .console { grid-template-columns: 1fr; }
  .rail { display: none; position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .rail[data-open="true"] { display: block; }
  .rail-mobile { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--mist); border-bottom: 1px solid var(--line); }
  .stat-cards { grid-template-columns: repeat(2, 1fr); }
  .workspace { padding: 1rem; }
  table.stacked thead { display: none; }
  table.stacked tr { display: block; border: 1px solid var(--line); border-radius: var(--radius-card); margin-bottom: 0.75rem; padding: 0.5rem; }
  table.stacked td { display: flex; justify-content: space-between; gap: 1rem; border: 0; padding: 0.35rem 0.5rem; }
  table.stacked td::before { content: attr(data-label); color: var(--slate); font-weight: 500; }
  .inbox-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; width: 100%; }
  .inbox-actions .capsule { width: 100%; }
  .batch-line { grid-template-columns: 1fr; }
}
`;
