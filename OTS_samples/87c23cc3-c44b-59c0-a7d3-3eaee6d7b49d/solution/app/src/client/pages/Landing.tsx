import { ChevronRight, Network } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api.ts'
import { ShortcutTable } from '../dialogs/ShortcutTable.tsx'
import { SampleWorkspace } from '../project/SampleWorkspace.tsx'
import { Link } from '../router.tsx'
import { useSession } from '../session.tsx'
import { CardIcon, FeatureWindow, type CardIconName } from '../ui/illustrations.tsx'

const DIALECTS = ['PostgreSQL', 'MySQL', 'Mortise text', 'Plain-text diffs', 'Byte-exact exports', 'Original DDL kept', 'Numbered versions', 'Revocable links']

interface Feature {
  id: 'editor' | 'links' | 'import' | 'sharing'
  title: string
  emoji: string
  body: string
  link: string
}

const FEATURES: Feature[] = [
  {
    id: 'editor',
    title: 'Text first, diagram in step',
    emoji: '🔁',
    body: 'Type an entity and its closing brace, and a table grows on the diagram beside it. Errors point at the exact line and column, and the last good diagram stays put while you fix them.',
    link: 'Try text-first editing',
  },
  {
    id: 'links',
    title: 'Draw a link, get a line of text',
    emoji: '✏️',
    body: 'Drag from one column to another and exactly one canonical line lands in your text. Every comment, blank line and bit of spacing you wrote stays exactly as it was.',
    link: 'Try drawing a link',
  },
  {
    id: 'import',
    title: 'Bring the DDL you already have',
    emoji: '📥',
    body: 'Paste a PostgreSQL or MySQL dump and read back how every statement was handled: added, merged or skipped. An unsupported statement stops the import and changes nothing.',
    link: 'Try importing DDL',
  },
  {
    id: 'sharing',
    title: 'Share a link, take it back',
    emoji: '🔗',
    body: 'Hand out a view link or an emailed edit link, edit live together, and turn a link off whenever you like. Anyone still looking is told straight away.',
    link: 'Try sharing a link',
  },
]

interface Card {
  icon: CardIconName
  title: string
  body: string
}

const CARDS: Card[] = [
  { icon: 'entities', title: 'Entities and columns', body: 'Write an entity block with typed columns, keys, defaults and unique settings. The diagram shows exactly what the text says.' },
  { icon: 'choices', title: 'Choices for fixed values', body: 'Name a set of values once and use it as a column type. Defaults are checked against the list.' },
  { icon: 'links', title: 'Four kinds of link', body: 'Many-to-one, one-to-many, one-to-one and many-to-many, written as a line or inline on a column.' },
  { icon: 'groups', title: 'Groups and colours', body: 'Gather entities under a named group and colour them. Layout choices never touch your text.' },
  { icon: 'exports', title: 'Exports you can diff', body: 'PostgreSQL or MySQL DDL that is identical byte for byte, with every lossy lowering listed as a note in the file.' },
  { icon: 'versions', title: 'Versions you can restore', body: 'Save numbered versions, compare two of them and bring an earlier one back as a new version.' },
]

function StudioLink({ className, children }: { className?: string; children: ReactNode }) {
  const { user } = useSession()
  return (
    <Link href={user ? '/projects' : '/signin'} className={className}>
      {children}
    </Link>
  )
}

function Tally() {
  const [stats, setStats] = useState<{ projects: number; exports: number } | null>(null)
  useEffect(() => {
    api<{ projects: number; exports: number }>('GET', '/api/stats').then(setStats, () => undefined)
  }, [])
  return (
    <section aria-label="Project tally" className="tally">
      <p className="tally-line">
        {stats ? (
          <span>
            <b>{stats.projects}</b> schemas drafted and <b>{stats.exports}</b> DDL files exported in this studio
          </span>
        ) : (
          <span>
            <span className="sr-only">Counting the studio...</span>
            <span aria-hidden="true" className="tally-hold">
              <b>000</b> schemas drafted and <b>000</b> DDL files exported in this studio
            </span>
          </span>
        )}
      </p>
      <a href="#sample" className="tally-pill">
        See the sample<span aria-hidden="true"> 👇</span>
      </a>
    </section>
  )
}

function DialectStrip() {
  const scroller = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
  }, [])
  return (
    <section aria-label="Supported dialects" className="dialects">
      <h2>Ships to the dialects you deploy</h2>
      <ul role="list" aria-label="Supported dialects and formats" className="dialect-strip" tabIndex={0} ref={scroller}>
        {DIALECTS.map((name, i) => (
          <li key={name} className={`wordmark wordmark-${i % 4}`}>
            {name}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Landing() {
  useEffect(() => {
    const hash = window.location.hash.slice(1)
    if (hash) document.getElementById(hash)?.scrollIntoView()
  }, [])
  return (
    <div className="landing">
      <section className="hero container">
        <p className="credit">A studio by Pinewick Labs</p>
        <h1>
          Write the tables, join them, and watch the diagram keep up<span aria-hidden="true"> 🪚</span>
        </h1>
        <p className="subtitle">
          <span>Joinery reads a small schema language as you type and draws the diagram beside it.</span>
          <span>Draw a link on the diagram and the line appears in your text, ready for PostgreSQL or MySQL.</span>
        </p>
        <Tally />
        <StudioLink className="btn btn-primary btn-hero">
          <Network size={18} aria-hidden="true" />
          Open the studio
        </StudioLink>
      </section>

      <div className="sample-wrap">
        <SampleWorkspace />
      </div>

      <DialectStrip />

      <div className="container showcase-rows">
        {FEATURES.map((feature) => (
          <section key={feature.id} id={feature.id} className="showcase-row" aria-labelledby={`${feature.id}-title`}>
            <div className="showcase-text">
              <h3 id={`${feature.id}-title`}>
                {feature.title}
                <span aria-hidden="true">{`\u00a0${feature.emoji}`}</span>
              </h3>
              <p>{feature.body}</p>
              <StudioLink className="link-chevron">
                {feature.link}
                <ChevronRight size={14} aria-hidden="true" />
              </StudioLink>
            </div>
            <div className="showcase-window">
              <FeatureWindow kind={feature.id} />
            </div>
          </section>
        ))}
      </div>

      <section id="language" aria-label="Mortise at a glance" className="container glance">
        <h2>
          Mortise at a glance<span aria-hidden="true"> 🧩</span>
        </h2>
        <ul role="list" className="card-grid">
          {CARDS.map((card) => (
            <li key={card.title} className="showcase-card">
              <CardIcon name={card.icon} />
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="container">
        <section aria-label="Import DDL banner" className="tinted import-banner">
          <div className="banner-copy">
            <p className="eyebrow">Import · PostgreSQL or MySQL</p>
            <h2>Already have CREATE TABLE statements? Bring them in.</h2>
            <p>Paste a dump and Joinery reads it into Mortise, merging tables by name and listing every statement it added, merged or skipped.</p>
          </div>
          <StudioLink className="btn btn-primary btn-banner">Import DDL</StudioLink>
        </section>
      </div>

      <section id="keyboard" aria-label="Keyboard guide" className="container keyboard-guide">
        <h2>Keyboard guide</h2>
        <p className="hint">Everything in the studio works from the keyboard. These are the shortcuts.</p>
        <ShortcutTable label="Keyboard shortcuts" />
      </section>

      <footer className="landing-footer">
        <div className="container">Joinery is made by Pinewick Labs. Every name in the samples is invented.</div>
      </footer>
    </div>
  )
}
