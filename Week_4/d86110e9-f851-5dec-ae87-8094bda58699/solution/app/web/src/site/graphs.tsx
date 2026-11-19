import type { ReactNode } from 'react';

type Glyph = 'bolt' | 'mail' | 'gear' | 'table' | 'clock' | 'loop' | 'form' | 'hook' | 'branch';

const GLYPHS: Record<Glyph, ReactNode> = {
  bolt: <path d="M15 3 7 16h7l-2 9 10-14h-7z" />,
  mail: (
    <>
      <rect x="3" y="7" width="22" height="15" rx="3" />
      <path d="m4 9 10 7 10-7" />
    </>
  ),
  gear: (
    <>
      <circle cx="14" cy="14" r="4" />
      <circle cx="14" cy="14" r="9" strokeDasharray="4.2 3.4" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="5" width="22" height="18" rx="3" />
      <path d="M3 12h22M3 18h22M11 5v18" />
    </>
  ),
  clock: (
    <>
      <circle cx="14" cy="14" r="10" />
      <path d="M14 8v6l4 3" />
    </>
  ),
  loop: <path d="M5 14a9 9 0 0 1 16-5M22 4v6h-6M23 14a9 9 0 0 1-16 5M6 24v-6h6" />,
  form: (
    <>
      <rect x="4" y="3" width="20" height="22" rx="3" />
      <path d="M9 10h10M9 15h10M9 20h5" />
    </>
  ),
  hook: <path d="M10 22a5 5 0 1 1 3-9l4-7M17 6a3 3 0 1 1 5 3M19 20h6" />,
  branch: <path d="M8 4v8c0 4 12 2 12 8M8 12v12M20 20v4" />,
};

function GlyphIcon({ glyph, x, y }: { glyph: Glyph; x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`} fill="none" stroke="#fafafa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {GLYPHS[glyph]}
    </g>
  );
}

function Caption({ x, y, title, detail }: { x: number; y: number; title: string; detail: string }) {
  return (
    <text className="graph-caption" x={x} y={y} textAnchor="middle">
      <tspan className="graph-title" x={x}>
        {title}
      </tspan>
      <tspan className="graph-detail" x={x} dy="13">
        {detail}
      </tspan>
    </text>
  );
}

/** A square step node with round corners, 56 wide, with its port dots and two-line caption. */
function Node({ x, y, glyph, title, detail }: { x: number; y: number; glyph: Glyph; title: string; detail: string }) {
  return (
    <g>
      <rect x={x} y={y} width="56" height="56" rx="12" className="graph-node" />
      <GlyphIcon glyph={glyph} x={x + 14} y={y + 14} />
      <circle cx={x} cy={y + 28} r="3.5" className="graph-port" />
      <circle cx={x + 56} cy={y + 28} r="3.5" className="graph-port" />
      <Caption x={x + 28} y={y + 76} title={title} detail={detail} />
    </g>
  );
}

function Tool({ cx, cy, glyph, title, detail }: { cx: number; cy: number; glyph: Glyph; title: string; detail: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="24" className="graph-node" />
      <GlyphIcon glyph={glyph} x={cx - 14} y={cy - 14} />
      <Caption x={cx} y={cy + 42} title={title} detail={detail} />
    </g>
  );
}

function Wire({ d }: { d: string }) {
  return <path d={d} className="graph-edge" />;
}

function Plus({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="9" className="graph-plus" />
      <path d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} stroke="#161616" strokeWidth="1.8" strokeLinecap="round" />
    </g>
  );
}

function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg className="graph" viewBox="0 0 480 260" role="img" aria-label={label}>
      {children}
    </svg>
  );
}

function FormToRow() {
  return (
    <Frame label="A form trigger feeds a set values step and an add row step, with a mail tool and a table tool below">
      <Wire d="M76 88H212" />
      <Wire d="M268 88H404" />
      <Wire d="M240 116C240 150 160 140 160 170" />
      <Wire d="M432 116C432 150 330 140 330 170" />
      <Plus cx={144} cy={88} />
      <Plus cx={336} cy={88} />
      <Node x={20} y={60} glyph="form" title="Form trigger" detail="customer, item" />
      <Node x={212} y={60} glyph="gear" title="Set values" detail="greeting text" />
      <Node x={404} y={60} glyph="table" title="Add row" detail="Orders table" />
      <Tool cx={160} cy={194} glyph="mail" title="Send email" detail="to the team" />
      <Tool cx={330} cy={194} glyph="table" title="Followups" detail="rows land here" />
    </Frame>
  );
}

function ScheduleToEmail() {
  return (
    <Frame label="A schedule trigger runs a filter and then a send email step, with a gear tool and a mail tool below">
      <Wire d="M76 88H212" />
      <Wire d="M268 88C320 88 350 88 404 88" />
      <Wire d="M240 116C240 150 150 140 150 170" />
      <Wire d="M432 116C432 150 340 140 340 170" />
      <Plus cx={144} cy={88} />
      <Plus cx={336} cy={88} />
      <Node x={20} y={60} glyph="clock" title="Schedule trigger" detail="daily at 08:30" />
      <Node x={212} y={60} glyph="branch" title="Filter" detail="only if not empty" />
      <Node x={404} y={60} glyph="mail" title="Send email" detail="digest to owners" />
      <Tool cx={150} cy={194} glyph="gear" title="Template" detail="{{run.id}}" />
      <Tool cx={340} cy={194} glyph="bolt" title="Retry" detail="3 attempts" />
    </Frame>
  );
}

export function HookToLoop() {
  return (
    <Frame label="A webhook trigger starts a loop whose each part adds a row and whose done part sends an email">
      <Wire d="M76 88H212" />
      <Wire d="M268 80C330 80 340 60 404 60" />
      <Wire d="M268 96C330 96 340 130 404 130" />
      <Plus cx={144} cy={88} />
      <Plus cx={336} cy={96} />
      <Node x={20} y={60} glyph="hook" title="Webhook trigger" detail="one key, one run" />
      <Node x={212} y={60} glyph="loop" title="Loop" detail="each item, then done" />
      <Tool cx={432} cy={52} glyph="table" title="Add row" detail="each part" />
      <Tool cx={432} cy={150} glyph="mail" title="Send email" detail="done part" />
    </Frame>
  );
}

export const EXAMPLES: Array<{ name: string; view: () => ReactNode }> = [
  { name: 'Form to table row', view: () => <FormToRow /> },
  { name: 'Schedule to email', view: () => <ScheduleToEmail /> },
  { name: 'Webhook to loop', view: () => <HookToLoop /> },
];
