import { fmtInt, fmtTime } from '../shared/format.js';

export interface Region { id: string; name: string; continent: string; lon: number; lat: number }
export interface PlanRow { id: string; name: string; price: string; included_storage_bytes: number; included_egress_bytes: number; storage_overage: string; egress_overage: string; request_units: string }

/** The dot-grid world strip, drawn from a coarse land mask. */
export function WorldStrip({ regions }: { regions: Region[] }): JSX.Element {
  // equirectangular: lon -180..180, lat 78..-58; dot grid every 6 degrees
  const dots: Array<{ x: number; y: number }> = [];
  const W = 960, H = 300;
  const project = (lon: number, lat: number): [number, number] => [
    (lon + 180) / 360 * W,
    (78 - lat) / 136 * H,
  ];
  for (let lat = -56; lat <= 76; lat += 5) {
    for (let lon = -178; lon <= 178; lon += 5) {
      if (isLand(lon, lat)) {
        const [x, y] = project(lon, lat);
        dots.push({ x, y });
      }
    }
  }
  return (
    <svg class="worldstrip" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Farshore regions">
      {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="1.7" fill="#2a3142" />)}
      {regions.map(r => {
        const [x, y] = project(r.lon, r.lat);
        return (
          <g key={r.id}>
            <circle cx={x} cy={y} r="5" fill="#f2b53c" />
            <text x={x + 9} y={y - 4} fill="#e9e5da" font-size="13" font-family="Space Grotesk, sans-serif">{r.name}</text>
            <text x={x + 9} y={y + 10} fill="#8b95a8" font-size="11">{r.continent}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Coarse land mask: bounding boxes and blobs over (lon, lat).
function isLand(lon: number, lat: number): boolean {
  const boxes: Array<[number, number, number, number]> = [
    [-168, 70, -52, 50], // North America
    [-140, 48, -55, 15], // Central America
    [-82, 12, -35, -55], // South America
    [-10, 71, 40, 36], // Europe
    [-6, 36, 34, 10], // North Africa / Mediterranean
    [-17, 10, 50, -35], // Africa
    [26, 70, 180, 40], // Asia
    [68, 38, 90, 8], // South Asia
    [95, 0, 150, -10], // Indonesia
    [113, -10, 154, -44], // Australia
    [166, -35, 179, -47], // New Zealand
    [-180, 66, -140, 60], // Alaska tail
    [55, 75, 140, 68], // Siberia north
  ];
  for (const [x1, y1, x2, y2] of boxes) {
    if (lon >= x1 && lon <= x2 && lat <= y1 && lat >= y2) {
      // nibble some coast irregularity
      if (boxNoise(lon, lat)) return true;
    }
  }
  return false;
}

function boxNoise(lon: number, lat: number): boolean {
  return (Math.sin(lon * 1.7) * Math.cos(lat * 2.3)) > -0.65;
}

export function PricingTable({ plans }: { plans: PlanRow[] }): JSX.Element {
  return (
    <table aria-label="Pricing">
      <thead>
        <tr>
          <th>Plan</th><th class="num">Monthly price</th><th class="num">Included storage</th>
          <th class="num">Included egress</th><th>Storage overage</th><th>Egress overage</th><th>Request units</th>
        </tr>
      </thead>
      <tbody>
        {plans.map(p => (
          <tr key={p.id}>
            <td>{p.name}</td>
            <td class="num">{p.price}</td>
            <td class="num">{fmtInt(p.included_storage_bytes)}</td>
            <td class="num">{fmtInt(p.included_egress_bytes)}</td>
            <td>{p.storage_overage}</td>
            <td>{p.egress_overage}</td>
            <td>{p.request_units}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function PricingCards({ plans }: { plans: PlanRow[] }): JSX.Element {
  return (
    <div class="pricing-cards">
      {plans.map(p => (
        <div class="pricing-card" key={p.id}>
          <h3>{p.name}</h3>
          <div class="kv"><b>Monthly price</b><span class="num">{p.price}</span></div>
          <div class="kv"><b>Included storage</b><span class="num">{fmtInt(p.included_storage_bytes)}</span></div>
          <div class="kv"><b>Included egress</b><span class="num">{fmtInt(p.included_egress_bytes)}</span></div>
          <div class="kv"><b>Storage overage</b><span>{p.storage_overage}</span></div>
          <div class="kv"><b>Egress overage</b><span>{p.egress_overage}</span></div>
          <div class="kv"><b>Request units</b><span>{p.request_units}</span></div>
        </div>
      ))}
    </div>
  );
}

export function utcNow(): string { return fmtTime(new Date().toISOString()); }
