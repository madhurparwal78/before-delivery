// The ruled-ledger look: paper ground, ink text, hairline rules, tabular
// numerals, one ultramarine trace accent, burnt orange for staleness.

export const css = `
@font-face {
  font-family: Archivo;
  src: url("/static/Archivo.ttf") format("truetype");
  font-weight: 400 700;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Sans";
  src: url("/static/IBMPlexSans.ttf") format("truetype");
  font-weight: 100 700;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/static/IBMPlexMono-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/static/IBMPlexMono-Medium.ttf") format("truetype");
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/static/IBMPlexMono-SemiBold.ttf") format("truetype");
  font-weight: 600;
  font-display: swap;
}

:root {
  --paper: #f6f2e6;
  --ink: #1d2229;
  --rule: #d8d2c2;
  --stone: #6b6455;
  --accent: #1f3fd4;
  --stale: #b4501e;
  --focus: #14181d;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "IBM Plex Sans", sans-serif;
  font-size: 15px;
  line-height: 1.45;
}

a { color: inherit; }

button, input, select, textarea {
  font: inherit;
  color: inherit;
}

button {
  min-height: 44px;
  min-width: 44px;
  padding: 6px 14px;
  background: transparent;
  border: 1px solid var(--ink);
  cursor: pointer;
}

button:hover { background: rgba(29, 34, 41, 0.06); }

button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}

input, select, textarea {
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid var(--rule);
  background: #fffdf7;
}

input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--ink); }

.num {
  font-family: "IBM Plex Mono", monospace;
  font-variant-numeric: tabular-nums;
  text-align: right;
  font-feature-settings: "tnum" 1;
}

.wordmark {
  font-family: Archivo, sans-serif;
  font-weight: 700;
  letter-spacing: 0.02em;
}

h1, h2, h3 {
  font-family: Archivo, sans-serif;
  font-weight: 700;
  margin: 0;
}

h1 { font-size: 1.8em; }
h2 { font-size: 1.35em; }
h3 { font-size: 1.05em; }

.site-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 18px 24px 12px;
  border-bottom: 1px solid var(--rule);
}

.site-header .ident { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.site-header .holder { font-family: Archivo, sans-serif; font-weight: 700; font-size: 1.2em; }
.site-header .wordmark { font-size: 1.2em; }
.site-header .ticker { color: var(--stone); font-family: "IBM Plex Mono", monospace; font-size: 0.9em; }
.site-header a { text-decoration: none; border-bottom: 1px solid var(--rule); }
.site-header a:hover { border-bottom-color: var(--ink); }

.page { padding: 0 24px 32px; }

.notices { padding: 10px 24px; }
.notices p { margin: 0; }

.board-layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 28px;
  align-items: start;
}

.clock-rail {
  position: sticky;
  top: 16px;
  display: grid;
  gap: 14px;
}

.clock-item { border-top: 1px solid var(--rule); padding-top: 10px; }
.clock-item .clock-name { font-family: Archivo, sans-serif; font-weight: 700; font-size: 0.85em; letter-spacing: 0.04em; text-transform: uppercase; color: var(--stone); }
.clock-item .clock-line { margin-top: 4px; }
.clock-item.stale .clock-line, .clock-item.stale .clock-short { color: var(--stale); }

.clock-details-btn {
  display: none;
  margin-top: 6px;
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--rule);
  font-size: 0.85em;
  text-align: left;
  background: transparent;
}

.figures-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 22px;
  margin-top: 18px;
}

.tile {
  text-align: left;
  background: transparent;
  border: none;
  padding: 14px 4px 12px;
  border-bottom: 1px solid var(--rule);
  position: relative;
  width: 100%;
  display: block;
}

.tile .label {
  font-family: Archivo, sans-serif;
  font-weight: 700;
  font-size: 0.85em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--stone);
  display: block;
  text-align: left;
}

.tile .numeral {
  font-family: "IBM Plex Mono", monospace;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  font-size: 1.9em;
  display: block;
  margin: 10px 0 8px;
  letter-spacing: -0.01em;
}

.tile .badge {
  display: inline-block;
  border: 1px solid var(--ink);
  padding: 1px 8px;
  font-size: 0.72em;
  font-family: Archivo, sans-serif;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.tile .asof, .tile .citation { display: block; margin-top: 5px; font-size: 0.85em; color: var(--stone); text-align: left; }
.tile .rule { border-top: 1px solid var(--rule); margin-top: 8px; transition: border-top-color 0.1s ease; }
.tile:hover .rule, .tile:focus-visible .rule { border-top-color: var(--ink); }

.history {
  margin-top: 34px;
}

.history h2 { margin-bottom: 10px; }

table.ledger {
  width: 100%;
  border-collapse: collapse;
}

table.ledger th {
  font-family: Archivo, sans-serif;
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--stone);
  text-align: left;
  border-bottom: 1px solid var(--ink);
  padding: 8px 10px;
  font-weight: 700;
}

table.ledger td {
  border-bottom: 1px solid var(--rule);
  padding: 9px 10px;
  vertical-align: top;
}

table.ledger td.num, table.ledger th.num { text-align: right; font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }

table.ledger a { color: var(--ink); }

.restated-cell { color: var(--stone); }
.restated-line { font-size: 0.85em; }

.status-chip {
  display: inline-block;
  border: 1px solid var(--rule);
  padding: 1px 8px;
  font-size: 0.78em;
}

.board-footer {
  margin-top: 28px;
  padding: 14px 0 0;
  border-top: 1px solid var(--rule);
  color: var(--stone);
  font-size: 0.9em;
}

/* Trace panel */
.trace-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(440px, 36vw);
  background: var(--paper);
  border-left: 1px solid var(--ink);
  padding: 20px 22px 28px;
  overflow-y: auto;
  z-index: 40;
}

.trace-panel.slide-in { animation: panel-in 0.25s ease-out; }
.trace-panel.slide-out { animation: panel-out 0.25s ease-in forwards; }

@keyframes panel-in {
  from { transform: translateX(40px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes panel-out {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(40px); opacity: 0; }
}

.trace-sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-height: 85vh;
  background: var(--paper);
  border-top: 2px solid var(--ink);
  padding: 18px 18px 28px;
  overflow-y: auto;
  z-index: 40;
}

.trace-sheet.sheet-in { animation: sheet-in 0.25s ease-out; }
.trace-sheet.sheet-out { animation: sheet-out 0.25s ease-in forwards; }

@keyframes sheet-in {
  from { transform: translateY(30px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@keyframes sheet-out {
  from { transform: translateY(0); opacity: 1; }
  to { transform: translateY(30px); opacity: 0; }
}

.trace-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
.trace-head h2 { font-size: 1.1em; }

.input-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 8px; }

.input-button {
  width: 100%;
  display: block;
  text-align: left;
  border: 1px solid var(--rule);
  padding: 9px 12px;
  min-height: 44px;
  background: transparent;
  cursor: pointer;
}

.input-button .input-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.input-button .input-label { font-weight: 600; }
.input-button .input-value { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.input-button .input-meta { font-size: 0.82em; color: var(--stone); margin-top: 3px; display: flex; gap: 10px; flex-wrap: wrap; }
.input-button[aria-pressed="true"] { border: 2px solid var(--accent); }
.input-button[aria-pressed="true"].sets-as-of { border: 2px solid var(--stale); }
.input-button.sets-as-of { border: 1px solid var(--stale); }

.trace-provenance { margin-top: 16px; font-size: 0.9em; word-break: break-all; }
.trace-provenance code { font-family: "IBM Plex Mono", monospace; }

.exhibit-table { margin-top: 14px; }
.exhibit-table td:first-child { color: var(--stone); }

.trace-actions { margin-top: 18px; display: flex; gap: 12px; flex-wrap: wrap; }

.chips {
  margin-top: 18px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
}

.chip {
  font-family: "IBM Plex Mono", monospace;
  font-variant-numeric: tabular-nums;
  border: 1px solid var(--rule);
  background: var(--paper);
  padding: 8px 12px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-direction: column;
}

.chip .op { color: var(--stone); font-family: Archivo, sans-serif; font-weight: 700; }
.chip.sets-as-of { border: 1px solid var(--stale); }

.threads-layer { position: fixed; inset: 0; pointer-events: none; z-index: 30; }
.threads-layer path { stroke: var(--accent); fill: none; stroke-width: 2; }

.formula-line { width: 100%; text-align: center; font-size: 0.85em; color: var(--stone); margin-bottom: 8px; font-style: italic; }

.status-line { font-size: 0.9em; color: var(--stone); min-height: 1.3em; }

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Staff */
.staff-form { max-width: 420px; margin: 40px auto; display: grid; gap: 14px; }
.staff-form label { font-weight: 600; font-family: Archivo, sans-serif; font-size: 0.9em; }

.staff-page { max-width: 1060px; margin: 0 auto; }

.toolbar { display: flex; gap: 14px; margin: 18px 0 22px; flex-wrap: wrap; }

.editor-grid { display: grid; gap: 18px; }
.rows-form { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.field { display: grid; gap: 5px; }
.field label { font-weight: 600; font-family: Archivo, sans-serif; font-size: 0.85em; }

.events-list { display: grid; gap: 10px; }
.event-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.audit-scroll { overflow-x: auto; }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(29, 34, 41, 0.32);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal-card {
  background: var(--paper);
  border: 1px solid var(--ink);
  padding: 22px 24px;
  min-width: min(460px, 92vw);
  max-height: 88vh;
  overflow-y: auto;
}

.modal-card h2 { margin-bottom: 10px; }
.modal-card .meta { font-size: 0.9em; color: var(--stone); margin-bottom: 12px; }
.modal-card .meta div { margin-bottom: 3px; }

.modal-actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
.modal-actions .spacer { flex: 1; }

.fade-in { animation: fade-in 0.16s ease-out; }
.fade-out { animation: fade-out 0.16s ease-in forwards; }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }

.alert-box {
  border: 1px solid var(--stale);
  padding: 12px 14px;
  margin: 14px 0;
}
.alert-box ul { margin: 6px 0 0; padding-left: 18px; }

.exhibit-area { border: 1px solid var(--rule); padding: 14px; }
.exhibit-state { font-weight: 600; }
.exhibit-hint { font-size: 0.85em; color: var(--stone); margin-top: 4px; }
.file-control { margin-top: 10px; }

.check-list { display: grid; gap: 10px; }
.check-list label { display: flex; gap: 10px; align-items: baseline; min-height: 24px; }
.check-list input { min-height: 0; }

/* Operator */
.operator-page { max-width: 720px; margin: 0 auto; }
.console-line { font-family: "IBM Plex Mono", monospace; font-size: 1.05em; margin: 8px 0; }
.clock-field { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; align-items: center; }

/* Citation page */
.citation-page { max-width: 640px; margin: 0 auto; }
.citation-head { margin: 18px 0 6px; }
.marker { display: inline-block; font-size: 0.8em; border: 1px solid var(--stale); color: var(--stale); padding: 1px 8px; font-family: Archivo, sans-serif; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
.marker.provisional { border-color: var(--stone); color: var(--stone); }

@media (max-width: 1279.98px) {
  .board-layout { grid-template-columns: 1fr; }
  .clock-rail {
    position: static;
    grid-template-columns: repeat(3, 1fr);
    gap: 14px;
    margin-top: 16px;
  }
  .figures-grid { grid-template-columns: repeat(2, 1fr); margin-top: 12px; }
  .trace-panel { width: min(520px, 50vw); }
}

@media (max-width: 767.98px) {
  .site-header { padding: 14px 16px 10px; }
  .page { padding: 0 16px 24px; }
  .notices { padding: 8px 16px; }
  .board-layout { display: block; }
  .clock-rail { grid-template-columns: 1fr; margin-top: 8px; }
  .figures-grid { grid-template-columns: 1fr; }
  .clock-item { padding-top: 8px; }
  .clock-item .clock-line { margin-top: 6px; }
  .clock-details-btn { display: block; }
  .history .ledger-desktop { display: none; }
  .history-cards { display: grid; gap: 12px; }
  .history-card { border: 1px solid var(--rule); padding: 12px 14px; }
  .history-card .pair { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; }
  .history-card .pair span:first-child { color: var(--stone); }
  .history-card .pair span:last-child { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
  .rows-form { grid-template-columns: 1fr; }
  table.ledger th, table.ledger td { padding: 8px 6px; }
}

@media (min-width: 768px) {
  .history-cards { display: none; }
  .clock-short { display: none; }
  .clock-details-btn { display: none; }
}

/* With reduced motion, panels and dialogs appear and disappear at once. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;
