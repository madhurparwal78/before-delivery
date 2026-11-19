// Drawn in code for this app: grid-tile thumbnails and empty-state line drawings.

/** A small stable number from a file name, so each sheet draws its own framing. */
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The sheet number for the title block: a drawing number such as "S-101", else the name's initials. */
function sheetMark(name: string): string {
  const number = /^[A-Z]{1,2}-\d{2,4}/.exec(name);
  if (number) return number[0];
  return name.split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
}

/** A mini drawing sheet: border, a structural grid with bubbles and beam lines, title block bottom right. */
export function SheetThumb({ name }: { name: string }) {
  const seed = seedOf(name);
  const bays = 2 + (seed % 3);
  const lines = 2 + ((seed >>> 3) % 3);
  const xs = Array.from({ length: bays + 1 }, (_, i) => 18 + (i * 60) / bays);
  const ys = Array.from({ length: lines }, (_, i) => 24 + (i * 44) / (lines - 1));
  const left = xs[0] ?? 18, right = xs[xs.length - 1] ?? 78;
  const top = ys[0] ?? 24, bottom = ys[ys.length - 1] ?? 68;
  const brace = (seed >>> 6) % bays;
  const braceLeft = xs[brace] ?? left, braceRight = xs[brace + 1] ?? right;
  return (
    <svg className="thumb" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="116" height="86" className="t-paper" />
      <rect x="6" y="6" width="108" height="78" className="t-rule" />
      <g className="t-grid">
        <path d={[...xs.map((x) => `M${x} 16V76`), ...ys.map((y) => `M12 ${y}H84`)].join("")} />
      </g>
      <g className="t-rule">
        {xs.map((x) => <circle key={x} cx={x} cy="12" r="3" />)}
      </g>
      <g className="t-ink">
        <path d={ys.map((y) => `M${left} ${y}H${right}`).join("")} />
        {(seed >>> 9) % 2 === 0 && <path d={`M${braceLeft} ${top}L${braceRight} ${bottom}M${braceRight} ${top}L${braceLeft} ${bottom}`} />}
        {xs.flatMap((x) => ys.map((y) => <rect key={`${x}-${y}`} x={x - 2} y={y - 2} width="4" height="4" />))}
      </g>
      <rect x="86" y="58" width="28" height="26" className="t-rule" />
      <path d="M86 66h28M86 74h28" className="t-rule" />
      <text x="100" y="81.5" className="t-mark">{sheetMark(name)}</text>
    </svg>
  );
}

/** A mini blueprint drawing for images. */
export function BlueprintThumb() {
  return (
    <svg className="thumb" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="116" height="86" className="b-ground" />
      <path d="M2 20h116M2 38h116M2 56h116M2 74h116M20 2v86M40 2v86M60 2v86M80 2v86M100 2v86" className="b-grid" />
      <g className="b-line">
        <rect x="14" y="16" width="22" height="22" /><rect x="22" y="24" width="6" height="6" />
        <rect x="48" y="16" width="22" height="22" /><rect x="56" y="24" width="6" height="6" />
        <rect x="14" y="50" width="22" height="22" /><rect x="48" y="50" width="22" height="22" />
        <circle cx="96" cy="26" r="9" /><path d="M96 35V17l-3 5M96 17l3 5" />
      </g>
    </svg>
  );
}

export function FolderThumb() {
  return (
    <svg className="thumb" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
      <path d="M16 24h30l6 7h52v41H16z" className="f-body" />
      <path d="M16 36h88" className="t-rule" />
    </svg>
  );
}

/** A drafting-table drawing for empty states: an empty sheet on a board with a set square. */
export function EmptyDrawing() {
  return (
    <svg className="empty-art" viewBox="0 0 160 110" aria-hidden="true" focusable="false">
      <rect x="10" y="14" width="140" height="84" className="e-board" />
      <rect x="24" y="24" width="92" height="64" className="e-sheet" />
      <path d="M24 78h92M96 78v10" className="e-rule" />
      <path d="M118 30l26 50h-26z" className="e-square" />
      <path d="M30 34h40" className="e-faint" />
    </svg>
  );
}
