import { Link } from "../lib/router";
import { landPath, useCoastline } from "../coastline";
import { landingPath } from "../shell";
import type { Me } from "../types";

const SUPPORTING_SENTENCE = "Every shop in your group, every tin on its shelves, every collection hour in its own local time.";

// The same flat projection the estate map uses: 31 pixels of longitude and 40 of latitude per degree.
const LON_PX = 31;
const LAT_PX = 40;

interface Pane {
  west: number;
  east: number;
  north: number;
  south: number;
  top: number;
  height: number;
}

const WIDTH = 640;
const HEIGHT = 800;
const PADDING = 24;
const PANES: Pane[] = [
  { west: -31.8, east: -24.6, north: 40.2, south: 36.6, top: PADDING, height: 330 },
  { west: -12.6, east: -4.4, north: 42.4, south: 36.6, top: PADDING + 330 + PADDING, height: HEIGHT - 3 * PADDING - 330 },
];

/** Both ends of the estate drawn big enough to fill the column: the Azores above, the mainland below. */
function Miniature() {
  const coastline = useCoastline();
  const land = coastline ? landPath(coastline) : "";
  return (
    <svg className="miniature" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Map of mainland Portugal and the Azores">
      <defs>
        {PANES.map((pane, index) => (
          <clipPath key={pane.top} id={`pane-${index}`}>
            <rect x={PADDING} y={pane.top} width={WIDTH - 2 * PADDING} height={pane.height} rx="6" />
          </clipPath>
        ))}
      </defs>
      {PANES.map((pane, index) => {
        const width = WIDTH - 2 * PADDING;
        const scaleX = Math.min(width / (pane.east - pane.west), pane.height / ((pane.north - pane.south) * (LAT_PX / LON_PX)));
        const scaleY = scaleX * (LAT_PX / LON_PX);
        const left = PADDING + (width - (pane.east - pane.west) * scaleX) / 2;
        const top = pane.top + (pane.height - (pane.north - pane.south) * scaleY) / 2;
        const meridians = Array.from({ length: Math.floor(pane.east) - Math.ceil(pane.west) + 1 }, (_, i) => Math.ceil(pane.west) + i);
        const parallels = Array.from({ length: Math.floor(pane.north) - Math.ceil(pane.south) + 1 }, (_, i) => Math.ceil(pane.south) + i);
        return (
          <g key={pane.top} clipPath={`url(#pane-${index})`}>
            <rect x={PADDING} y={pane.top} width={width} height={pane.height} className="pane" />
            <g transform={`translate(${left} ${top}) scale(${scaleX} ${scaleY}) translate(${-pane.west} ${pane.north})`}>
              {meridians.map((lon) => <line key={`m${lon}`} x1={lon} x2={lon} y1={-pane.north} y2={-pane.south} className="graticule" />)}
              {parallels.map((lat) => <line key={`p${lat}`} x1={pane.west} x2={pane.east} y1={-lat} y2={-lat} className="graticule" />)}
              <path d={land} className="land" />
            </g>
          </g>
        );
      })}
    </svg>
  );
}

function Drawings() {
  return (
    <svg className="drawings" viewBox="0 0 1200 400" role="presentation" aria-hidden="true" focusable="false">
      <g transform="translate(40 60)">
        <rect x="150" y="70" width="34" height="230" rx="8" fill="#FFD45C" />
        <rect x="150" y="70" width="34" height="34" rx="6" fill="#B3122F" />
        <path d="M70 70h210a22 22 0 0 1 22 22v24H178v-12H90a20 20 0 0 1-20-20z" fill="#FFE4E8" />
        <path d="M70 70h-30l24 34 6-14z" fill="#FFD3DA" />
      </g>
      <g transform="translate(330 150)">
        <rect x="0" y="40" width="300" height="64" rx="8" fill="#FFE4E8" />
        <rect x="116" y="52" width="68" height="40" rx="6" fill="#1E1E22" />
        <circle cx="150" cy="72" r="14" fill="#8EE6B0" />
        <circle cx="40" cy="72" r="8" fill="#B3122F" />
        <circle cx="260" cy="72" r="8" fill="#B3122F" />
      </g>
      <g transform="translate(700 60)">
        <path d="M0 70c0-16 100-16 100 0v200c0 16-100 16-100 0z" fill="#FFE4E8" />
        <ellipse cx="50" cy="70" rx="50" ry="14" fill="#FFD3DA" />
        <rect x="8" y="130" width="84" height="90" fill="#B3122F" />
        <rect x="22" y="148" width="56" height="10" fill="#FFE4E8" />
        <rect x="22" y="168" width="40" height="10" fill="#FFD3DA" />
        <path d="M-4 90c-40-40 148-40 108 0" fill="none" stroke="#FFD3DA" strokeWidth="8" strokeLinecap="round" />
      </g>
      <g transform="translate(880 80)">
        <rect x="55" y="130" width="30" height="170" rx="10" fill="#FFD45C" />
        <rect x="45" y="100" width="50" height="38" fill="#9096A0" />
        <path d="M40 100c0-60 14-96 30-96s30 36 30 96z" fill="#FFE4E8" />
        <path d="M56 100c0-40 6-70 14-90 8 20 14 50 14 90z" fill="#FFD3DA" />
      </g>
      <g transform="translate(1010 70)">
        <path d="M40 0l30 190-26 10z" fill="#FFE4E8" />
        <path d="M110 0l-30 190 26 10z" fill="#FFD3DA" />
        <circle cx="75" cy="196" r="12" fill="#1E1E22" stroke="#FFE4E8" strokeWidth="6" />
        <rect x="30" y="210" width="26" height="96" rx="12" fill="#B3122F" transform="rotate(14 43 258)" />
        <rect x="94" y="210" width="26" height="96" rx="12" fill="#B3122F" transform="rotate(-14 107 258)" />
      </g>
    </svg>
  );
}

export function Landing({ me }: { me: Me | null }) {
  return (
    <main className="landing">
      <span className="pin pin-tramela" data-pin="tramela" aria-hidden="true">Tramela</span>
      <span className="pin pin-estate" data-pin="estate" aria-hidden="true">Estate</span>
      <section className="hero">
        <div className="panel-white">
          <p className="supporting">{SUPPORTING_SENTENCE}</p>
          {me ? (
            <Link to={landingPath(me)} className="btn-carmine">Open your screen</Link>
          ) : (
            <Link to="/sign-in" className="btn-carmine">Sign in</Link>
          )}
        </div>
        <div className="mini-panel">
          <Miniature />
        </div>
      </section>
      <section className="drawings-panel">
        <Drawings />
      </section>
      <section className="red-section">
        <h1>Click-and-collect for ferragens</h1>
        <p>Regional groups of ironmongery, paint and garden-hardware shops, in mainland Portugal and the Azores, run their shops and their online storefront from one place.</p>
        <div className="roles">
          <div>
            <h2>Regional leads</h2>
            <p>Watch every shop of the group on a live map, see which are closing soon, critically short or suspended, and review the last day of orders.</p>
          </div>
          <div>
            <h2>Shop managers</h2>
            <p>Run stock, till sales, holds, opening hours, collection and returns for your own shop, in the shop's own local time.</p>
          </div>
          <div>
            <h2>Shoppers</h2>
            <p>Find the nearest shop that has an item, hold it there and collect it at a correct local time in a slot that still has room.</p>
          </div>
          <div>
            <h2>Customer care</h2>
            <p>Page through a customer's orders, read each order's full history and tell the customer exactly what happened.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
