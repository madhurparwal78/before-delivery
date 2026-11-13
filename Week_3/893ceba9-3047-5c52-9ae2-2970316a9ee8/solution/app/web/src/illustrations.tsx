import type { ComponentChildren, ComponentType } from "preact";
import { Database, GitBranch, GitPullRequest, Sparkles } from "lucide-preact";

export type Glyph = ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;

/** The coral-to-violet stroke every gradient icon tile's glyph is drawn with, defined once per page. */
export function GradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <linearGradient id="tile-stroke" gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
          <stop offset="0" stop-color="#F19A8E" /><stop offset="1" stop-color="#B58AE6" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/** An icon tile with a coral-to-violet border and glyph. */
export function GradientTile({ icon: Icon, size = 70, glyph = 30 }: { icon: Glyph; size?: number; glyph?: number }) {
  return (
    <span className="icon-tile gradient" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
      <Icon size={glyph} strokeWidth={1.5} color="url(#tile-stroke)" />
    </span>
  );
}

/** A card drawn like a locale file: key line, source line, skeleton bars for the target, a language badge. */
function LocaleCard({ x, y, rotate, lang, keyWidth }: { x: number; y: number; rotate: number; lang: string; keyWidth: number }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate})`}>
      <rect width="250" height="168" rx="14" fill="#fff" stroke="#D6D6D6" />
      <rect x="18" y="22" width={keyWidth} height="9" rx="4.5" fill="#131E29" opacity=".85" />
      <rect x="18" y="44" width="150" height="8" rx="4" fill="#9AA3AD" />
      <rect x="18" y="72" width="204" height="8" rx="4" fill="#E7E7E9" />
      <rect x="18" y="88" width="176" height="8" rx="4" fill="#E7E7E9" />
      <rect x="18" y="104" width="120" height="8" rx="4" fill="#E7E7E9" />
      <rect x="186" y="14" width="46" height="26" rx="6" fill="#fff" stroke="#737373" />
      <text x="209" y="31.5" text-anchor="middle" font-family="Inter Variable, system-ui, sans-serif" font-size="13" font-weight="600" fill="#131E29">{lang}</text>
    </g>
  );
}

export function HeroCollage() {
  return (
    <svg viewBox="0 0 600 500" width="100%" role="img" aria-label="Three locale files with MQM, match and conflict figures" className="hero-svg">
      <LocaleCard x={52} y={44} rotate={-4} lang="DE" keyWidth={96} />
      <LocaleCard x={246} y={150} rotate={3} lang="FR" keyWidth={118} />
      <LocaleCard x={96} y={286} rotate={-2} lang="JA" keyWidth={80} />
    </svg>
  );
}

function Tile({ children, label }: { children?: ComponentChildren; label: string }) {
  return <span className="hub-tile" aria-hidden="true">{children ?? label}</span>;
}

function Avatar({ tone }: { tone: "desk" | "queue" }) {
  const hair = tone === "desk" ? "#131E29" : "#7C5CC4";
  const shirt = tone === "desk" ? "#F19A8E" : "#B58AE6";
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true" className="hub-avatar">
      <rect width="96" height="96" rx="12" fill="#fff" />
      <rect x="0" y="62" width="96" height="34" fill={shirt} opacity=".35" />
      <circle cx="48" cy="40" r="17" fill="#F4D7C8" />
      <path d="M31 40c0-12 8-20 18-20s17 7 17 18c-6-3-10-9-12-12-6 6-14 10-23 14z" fill={hair} />
      <path d="M20 96c1-17 12-27 28-27s27 10 28 27z" fill={shirt} />
    </svg>
  );
}

/** App tile, connector, a tray of nine tiles, connector, an illustrated avatar. */
export function HubDiagram({ tone }: { tone: "desk" | "queue" }) {
  const tiles = tone === "desk"
    ? ["en", "de", "fr", "ja", "es", "pt", "TM", "AI", "git"]
    : ["de", "fr", "ja", "J", "K", "A", "C", "MQM", "ok"];
  return (
    <div className="panel hub-panel" aria-hidden="true">
      <div className="hub-row">
        <span className="hub-app">
          <svg viewBox="0 0 48 48" width="48" height="48"><rect x="6" y="6" width="36" height="36" rx="9" fill="#fff" /><path d="M14 18h20M14 24h20M14 30h12" stroke="#131E29" stroke-width="3" stroke-linecap="round" /></svg>
        </span>
        <span className="hub-line" />
        <span className="hub-tray">{tiles.map((t) => <Tile key={t} label={t} />)}</span>
        <span className="hub-line" />
        <Avatar tone={tone} />
      </div>
    </div>
  );
}

interface RailHubProps { branch: string; repository: string; tmEntries: number; routes: [string, string][] }

/** The branch rail's mini hub: the branch in the centre, connected to the repository, the TM and the AI route. */
export function RailHub({ branch, repository, tmEntries, routes }: RailHubProps) {
  return (
    <div className="panel rail-hub" role="img" aria-label={`How ${branch} connects to the repository, translation memory and AI route`}>
      <svg className="rail-links-art" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M50 50 L25 17 M50 50 L75 17 M50 50 L50 83" fill="none" stroke="#131E29" stroke-opacity=".35" stroke-width="1" vector-effect="non-scaling-stroke" />
      </svg>
      <span className="rail-tile rail-repo"><GradientTile icon={GitPullRequest} size={40} glyph={20} /><span><small>Repository</small><span>{repository.split("/").map((part, i) => <span key={i} className="nowrap">{i === 0 ? part : `/${part}`}</span>)}</span></span></span>
      <span className="rail-tile rail-tm"><GradientTile icon={Database} size={40} glyph={20} /><span><small>Translation memory</small>TM {tmEntries}</span></span>
      <span className="rail-node"><GitBranch size={18} strokeWidth={1.5} aria-hidden="true" /><span>{branch}</span></span>
      <span className="rail-tile rail-ai">
        <GradientTile icon={Sparkles} size={40} glyph={20} />
        <span>
          <small>AI route</small>
          {routes.map(([lang, engine]) => <span key={lang} className="rail-route">{lang} → {engine}</span>)}
        </span>
      </span>
    </div>
  );
}

/** Flat colour blocks behind the analytics card: large rounded shapes in the panel tints that bleed off the band. */
export function StatsBand() {
  return (
    <svg viewBox="0 0 1240 400" preserveAspectRatio="xMidYMid slice" className="band-art" aria-hidden="true">
      <rect width="1240" height="400" fill="#FBE3DC" />
      <rect x="560" y="-40" width="720" height="480" fill="#F3E1F0" />
      <rect x="-80" y="-60" width="460" height="250" rx="48" fill="#F5CFC5" />
      <rect x="260" y="250" width="560" height="220" rx="48" fill="#E9CDEA" />
      <rect x="780" y="-70" width="520" height="220" rx="48" fill="#D6CCF3" />
      <rect x="1000" y="230" width="320" height="240" rx="48" fill="#E6E0FA" />
    </svg>
  );
}
