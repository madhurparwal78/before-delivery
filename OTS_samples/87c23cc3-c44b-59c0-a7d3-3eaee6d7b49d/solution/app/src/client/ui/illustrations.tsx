import type { ReactNode } from 'react'

/* Original drawings for the landing page. Everything here is hidden from assistive technology and carries no diagram data attributes. */

type Hue = 'slate' | 'blue' | 'violet' | 'green' | 'amber' | 'red'

interface Row {
  name: string
  type: string
  key?: boolean
  hot?: boolean
}

interface Node {
  x: number
  y: number
  title: string
  hue: Hue
  rows: Row[]
}

const NODE_WIDTH = 132
const HEAD = 22
const ROW = 20

function rowY(node: Node, index: number): number {
  return node.y + HEAD + ROW * index + ROW / 2
}

function TableNode({ node }: { node: Node }) {
  const height = HEAD + ROW * node.rows.length
  return (
    <g transform={`translate(${node.x} ${node.y})`}>
      <rect width={NODE_WIDTH} height={height} rx="4" className="fw-node" />
      <path d={`M0 4a4 4 0 0 1 4-4h${NODE_WIDTH - 8}a4 4 0 0 1 4 4v${HEAD - 4}H0z`} className={`fw-head fw-${node.hue}`} />
      <text x="10" y="15" className={node.hue === 'amber' ? 'fw-title fw-title-dark' : 'fw-title'}>
        {node.title}
      </text>
      {node.rows.map((row, i) => (
        <g key={row.name}>
          {row.hot && <rect x="1" y={HEAD + ROW * i} width={NODE_WIDTH - 2} height={ROW} className="fw-hot" />}
          {row.key && <circle cx="10" cy={HEAD + ROW * i + ROW / 2} r="3" className="fw-key" />}
          <text x="20" y={HEAD + ROW * i + 14} className="fw-col">
            {row.name}
          </text>
          <text x={NODE_WIDTH - 8} y={HEAD + ROW * i + 14} textAnchor="end" className="fw-type">
            {row.type}
          </text>
        </g>
      ))}
    </g>
  )
}

/** An orthogonal connector between two rows with a small many marker at the start and a bar at the end. */
function Connector({ from, fromRow, to, toRow, dashed = false }: { from: Node; fromRow: number; to: Node; toRow: number; dashed?: boolean }) {
  const sy = rowY(from, fromRow)
  const ty = rowY(to, toRow)
  const leftward = to.x + NODE_WIDTH < from.x
  const sx = leftward ? from.x : from.x + NODE_WIDTH
  const tx = leftward ? to.x + NODE_WIDTH : to.x
  const mid = (sx + tx) / 2
  const dir = leftward ? -1 : 1
  return (
    <g className={dashed ? 'fw-link fw-link-preview' : 'fw-link'}>
      <path d={`M${sx} ${sy}H${mid}V${ty}H${tx}`} fill="none" />
      <path d={`M${sx} ${sy - 4}l${dir * 8} 4l${-dir * 8} 4`} fill="none" />
      <path d={`M${tx - dir * 6} ${ty - 5}v10`} fill="none" />
    </g>
  )
}

function Chips({ names, pill }: { names: string[]; pill?: string }) {
  return (
    <div className="fw-bar">
      {names.map((name) => (
        <span key={name} className="fw-chip">
          {name}
        </span>
      ))}
      {pill && <span className="fw-pill">{pill}</span>}
    </div>
  )
}

const KEYWORD = /^(entity|choice|link|group|index|CREATE|TABLE|COMMIT)\b/
function CodeLine({ text, active }: { text: string; active?: boolean }) {
  const match = KEYWORD.exec(text.trimStart())
  const indent = text.length - text.trimStart().length
  return (
    <span className={active ? 'fw-line fw-line-active' : 'fw-line'}>
      {' '.repeat(indent)}
      {match ? (
        <>
          <span className="fw-kw">{match[0]}</span>
          {text.trimStart().slice(match[0].length)}
        </>
      ) : (
        text.trimStart() || ' '
      )}
    </span>
  )
}

function Window({ chips, pill, code, activeLine, children }: { chips: string[]; pill?: string; code: string[]; activeLine?: number; children: ReactNode }) {
  return (
    <div className="fw" aria-hidden="true">
      <Chips names={chips} pill={pill} />
      <div className="fw-body">
        <pre className="fw-code">
          {code.map((line, i) => (
            <CodeLine key={`${i}-${line}`} text={line} active={i === activeLine} />
          ))}
        </pre>
        <svg className="fw-canvas" viewBox="0 0 330 230" role="presentation">
          {children}
        </svg>
      </div>
    </div>
  )
}

const BEDS: Node = {
  x: 14,
  y: 28,
  title: 'beds',
  hue: 'green',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'code', type: 'varchar(8)' },
    { name: 'light', type: 'light_level' },
  ],
}
const SOWINGS: Node = {
  x: 184,
  y: 92,
  title: 'sowings',
  hue: 'blue',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'bed_id', type: 'int' },
    { name: 'crop', type: 'varchar(60)' },
  ],
}

function EditorWindow() {
  return (
    <Window
      chips={['Share', 'Versions', 'Export']}
      pill="Templates"
      code={['entity beds {', '  id int [key]', '  code varchar(8)', '  light light_level', '}', '', 'entity sowings {', '  id int [key]', '  bed_id int', '}', 'link sowings.bed_id >- beds.id']}
    >
      <TableNode node={BEDS} />
      <TableNode node={SOWINGS} />
      <Connector from={SOWINGS} fromRow={1} to={BEDS} toRow={0} />
    </Window>
  )
}

const RECIPES: Node = {
  x: 14,
  y: 20,
  title: 'recipes',
  hue: 'amber',
  rows: [
    { name: 'id', type: 'int', key: true, hot: true },
    { name: 'title', type: 'varchar(120)' },
  ],
}
const STEPS: Node = {
  x: 184,
  y: 110,
  title: 'steps',
  hue: 'violet',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'recipe_id', type: 'int', hot: true },
    { name: 'body', type: 'text' },
  ],
}

function LinksWindow() {
  return (
    <Window
      chips={['Share', 'Versions']}
      pill="Templates"
      activeLine={8}
      code={['entity recipes {', '  id int [key]', '  title varchar(120)', '}', '', 'entity steps {', '  id int [key]', '  recipe_id int', 'link steps.recipe_id >- recipes.id', '}']}
    >
      <TableNode node={RECIPES} />
      <TableNode node={STEPS} />
      <Connector from={STEPS} fromRow={1} to={RECIPES} toRow={0} dashed />
      <circle cx={STEPS.x} cy={rowY(STEPS, 1)} r="5" className="fw-handle" />
    </Window>
  )
}

const MEMBERS: Node = {
  x: 14,
  y: 112,
  title: 'members',
  hue: 'slate',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'name', type: 'text' },
  ],
}

function ImportWindow() {
  return (
    <Window chips={['Import', 'Export']} pill="Templates" code={['CREATE TABLE members (', '  id integer PRIMARY KEY,', '  name text NOT NULL', ');', 'COMMIT;']}>
      <g className="fw-report">
        <circle cx="16" cy="22" r="4" className="fw-ok" />
        <text x="28" y="26" className="fw-col">
          Line 1: table members added
        </text>
        <circle cx="16" cy="48" r="4" className="fw-skip" />
        <text x="28" y="52" className="fw-col">
          Line 5: COMMIT skipped
        </text>
      </g>
      <TableNode node={MEMBERS} />
    </Window>
  )
}

const SHELVES: Node = {
  x: 14,
  y: 44,
  title: 'shelves',
  hue: 'red',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'label', type: 'varchar(40)' },
  ],
}
const BOOKS: Node = {
  x: 184,
  y: 116,
  title: 'books',
  hue: 'blue',
  rows: [
    { name: 'id', type: 'int', key: true },
    { name: 'shelf_id', type: 'int' },
    { name: 'title', type: 'text' },
  ],
}

function SharingWindow() {
  return (
    <Window
      chips={['Share', 'Versions', 'View only']}
      code={['entity shelves {', '  id int [key]', '  label varchar(40)', '}', '', 'entity books {', '  id int [key]', '  shelf_id int', '  title text', '}']}
      activeLine={8}
    >
      <TableNode node={SHELVES} />
      <TableNode node={BOOKS} />
      <Connector from={BOOKS} fromRow={1} to={SHELVES} toRow={0} />
      <g transform="translate(10 8)" className="fw-people">
        <circle cx="0" cy="8" r="9" className="fw-person fw-green" />
        <text x="0" y="12" textAnchor="middle" className="fw-initial">
          A
        </text>
        <circle cx="22" cy="8" r="9" className="fw-person fw-violet" />
        <text x="22" y="12" textAnchor="middle" className="fw-initial">
          B
        </text>
      </g>
      <g transform="translate(236 70)" className="fw-cursor">
        <path d="M0 0l0 16l4.5-4l3.5 8l3-1.4l-3.5-7.6l6 0z" />
        <rect x="14" y="14" width="34" height="18" rx="9" className="fw-violet" />
        <text x="31" y="27" textAnchor="middle" className="fw-initial">
          Bea
        </text>
      </g>
    </Window>
  )
}

export function FeatureWindow({ kind }: { kind: 'editor' | 'links' | 'import' | 'sharing' }) {
  if (kind === 'editor') return <EditorWindow />
  if (kind === 'links') return <LinksWindow />
  if (kind === 'import') return <ImportWindow />
  return <SharingWindow />
}

/* The six card icons: 48px, 1.5px strokes. */

const ICON = { viewBox: '0 0 48 48', width: 48, height: 48, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const

export type CardIconName = 'entities' | 'choices' | 'links' | 'groups' | 'exports' | 'versions'

export function CardIcon({ name }: { name: CardIconName }) {
  switch (name) {
    case 'entities':
      return (
        <svg {...ICON}>
          <rect x="7" y="9" width="34" height="30" rx="3" />
          <path d="M7 18h34M7 26h34M7 33h34M20 18v21" />
        </svg>
      )
    case 'choices':
      return (
        <svg {...ICON}>
          <rect x="7" y="9" width="34" height="30" rx="3" />
          <path d="M13 18l2.5 2.5L20 16M26 18h9M13 25l2.5 2.5L20 23M26 25h9M13 32h7M26 32h9" />
        </svg>
      )
    case 'links':
      return (
        <svg {...ICON}>
          <rect x="5" y="7" width="15" height="12" rx="2" />
          <rect x="28" y="29" width="15" height="12" rx="2" />
          <path d="M20 13h8a4 4 0 0 1 4 4v12" />
          <path d="M28 25l4 4l4-4M20 9v8" />
        </svg>
      )
    case 'groups':
      return (
        <svg {...ICON}>
          <rect x="5" y="8" width="38" height="32" rx="5" strokeDasharray="3 3" />
          <rect x="11" y="16" width="12" height="9" rx="2" />
          <rect x="26" y="25" width="12" height="9" rx="2" />
          <path d="M23 20h4v9" />
        </svg>
      )
    case 'exports':
      return (
        <svg {...ICON}>
          <path d="M12 6h16l8 8v8M12 6v36h12" />
          <path d="M28 6v8h8M17 20h12M17 27h8" />
          <path d="M28 37h14M37 32l5 5l-5 5" />
        </svg>
      )
    case 'versions':
      return (
        <svg {...ICON}>
          <rect x="14" y="5" width="28" height="22" rx="3" />
          <rect x="10" y="12" width="28" height="22" rx="3" />
          <rect x="6" y="19" width="28" height="22" rx="3" />
          <path d="M13 28h14M13 34h8" />
        </svg>
      )
  }
}
