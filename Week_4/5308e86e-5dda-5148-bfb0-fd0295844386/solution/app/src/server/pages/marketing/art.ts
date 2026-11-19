/** Original vignettes drawn in SVG from the design tokens. They carry no text, so the headings beside them say everything. */

function scene(inner: string, viewBox = "0 0 480 360"): string {
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function ground(fill: string): string {
  return `<rect width="480" height="360" rx="28" fill="${fill}"/>`;
}

function bar(x: number, y: number, width: number, fill = "var(--color-hairline-strong)", height = 12): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${fill}"/>`;
}

export function virtualCardArt(): string {
  const dotGroups = [0, 1, 2, 3]
    .map((group) =>
      [0, 1, 2, 3].map((dot) => `<circle cx="${122 + group * 62 + dot * 12}" cy="232" r="3.5"/>`).join(""),
    )
    .join("");
  return scene(`<defs><linearGradient id="art-card-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--color-panel-top)"/><stop offset="1" stop-color="var(--color-panel-bottom)"/></linearGradient></defs>
    ${ground("var(--avatar-indigo)")}
    <circle cx="410" cy="60" r="96" fill="var(--color-action-wash)"/>
    <g transform="rotate(-7 240 196)">
      <rect x="80" y="96" width="320" height="196" rx="22" fill="url(#art-card-fill)"/>
      <rect x="114" y="132" width="46" height="34" rx="8" fill="var(--avatar-amber)"/>
      <path d="M114 149h46M137 132v34" stroke="var(--color-panel-top)" stroke-width="2" opacity="0.45"/>
      <g fill="var(--color-on-rail)" opacity="0.85">${dotGroups}</g>
      <circle cx="352" cy="148" r="16" fill="none" stroke="var(--color-on-rail)" stroke-width="3" opacity="0.9"/>
      <circle cx="366" cy="148" r="16" fill="none" stroke="var(--color-on-rail)" stroke-width="3" opacity="0.5"/>
    </g>
    <g>
      <rect x="296" y="36" width="150" height="46" rx="23" fill="var(--color-surface)"/>
      <circle cx="321" cy="59" r="8" fill="var(--color-money-in)"/>
      ${bar(339, 53, 84)}
    </g>
    <g>
      <rect x="40" y="298" width="128" height="40" rx="20" fill="var(--color-surface)"/>
      ${bar(58, 313, 56)}
      <circle cx="144" cy="318" r="10" fill="var(--color-action)"/>
    </g>`);
}

export function calendarArt(): string {
  const bills = new Set(["0-1", "1-3", "2-5"]);
  const holidays = new Set(["1-4"]);
  const cells: string[] = [];
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 7; column++) {
      const key = `${row}-${column}`;
      const fill = bills.has(key)
        ? "var(--color-action)"
        : holidays.has(key)
          ? "var(--avatar-amber)"
          : "var(--color-secondary)";
      cells.push(`<rect x="${68 + column * 52}" y="${124 + row * 46}" width="40" height="34" rx="9" fill="${fill}"/>`);
      if (bills.has(key)) cells.push(`<circle cx="${88 + column * 52}" cy="${141 + row * 46}" r="6" fill="var(--color-on-action)"/>`);
    }
  }
  return scene(`${ground("var(--avatar-cyan)")}
    <rect x="44" y="40" width="392" height="284" rx="22" fill="var(--color-surface)"/>
    ${bar(68, 62, 120, "var(--color-ink)", 14)}
    <circle cx="376" cy="69" r="10" fill="var(--color-action-wash)"/><circle cx="406" cy="69" r="10" fill="var(--color-action-wash)"/>
    ${cells.join("")}
    <path d="M304 202c20-22 36-22 50 0" fill="none" stroke="var(--color-money-out)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 7"/>
    <path d="M346 198l8 6-10 3" fill="none" stroke="var(--color-money-out)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export function invoiceArt(): string {
  const lines = [0, 1, 2]
    .map((line) => `${bar(100, 122 + line * 30, 150 - line * 24)}${bar(262, 122 + line * 30, 44, "var(--color-ink)")}`)
    .join("");
  return scene(`<defs><linearGradient id="art-invoice-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--color-panel-top)"/><stop offset="1" stop-color="var(--color-panel-bottom)"/></linearGradient></defs>
    ${ground("var(--avatar-lime)")}
    <rect x="72" y="36" width="250" height="274" rx="18" fill="var(--color-surface)"/>
    <rect x="100" y="62" width="76" height="30" rx="15" fill="var(--color-money-in)" opacity="0.18"/>
    <circle cx="118" cy="77" r="6" fill="var(--color-money-in)"/>${bar(130, 71, 34, "var(--color-money-in)")}
    ${lines}
    <path d="M100 232h206" stroke="var(--color-hairline-strong)" stroke-width="2"/>
    ${bar(100, 252, 70, "var(--color-ink)", 16)}${bar(228, 252, 78, "var(--color-action)", 16)}
    <path d="M322 200c40 0 36 40 40 70" fill="none" stroke="var(--color-action)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 8"/>
    <rect x="250" y="252" width="200" height="82" rx="20" fill="url(#art-invoice-fill)"/>
    ${bar(274, 276, 78, "var(--color-on-rail)", 10)}${bar(274, 298, 120, "var(--color-on-rail)", 10)}
    <circle cx="418" cy="282" r="14" fill="var(--color-money-in)"/>
    <path d="M411 282l5 5 9-10" fill="none" stroke="var(--color-on-action)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`);
}

export function receiptArt(): string {
  return scene(`${ground("var(--avatar-amber)")}
    <path d="M56 40h172v260l-14-12-14 12-14-12-14 12-14-12-14 12-14-12-14 12-14-12-14 12-14-12-14 12z" fill="var(--color-surface)"/>
    ${bar(80, 70, 90, "var(--color-ink)", 14)}
    ${[0, 1, 2, 3].map((line) => `${bar(80, 112 + line * 30, 82 - line * 10)}${bar(184, 112 + line * 30, 20, "var(--color-body)")}`).join("")}
    ${bar(80, 244, 124, "var(--color-action)", 16)}
    <path d="M232 170h50" stroke="var(--color-action)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 8"/>
    <circle cx="258" cy="170" r="20" fill="var(--color-money-in)"/>
    <path d="M249 170l6 6 11-12" fill="none" stroke="var(--color-on-action)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="290" y="120" width="160" height="100" rx="18" fill="var(--color-surface)"/>
    <circle cx="322" cy="152" r="14" fill="var(--avatar-cyan)"/>
    ${bar(346, 144, 72)}${bar(346, 164, 44, "var(--color-hairline)", 10)}
    ${bar(314, 192, 112, "var(--color-money-out)", 14)}`);
}

export function controlsArt(): string {
  const avatars = ["var(--avatar-cyan)", "var(--avatar-lime)", "var(--avatar-indigo)"];
  const rows = avatars
    .map((fill, index) => {
      const top = 46 + index * 96;
      const on = index !== 2;
      return `<rect x="44" y="${top}" width="392" height="78" rx="18" fill="var(--color-surface)"/>
        <circle cx="86" cy="${top + 39}" r="19" fill="${fill}"/>
        ${bar(120, top + 24, 110 - index * 14, "var(--color-ink)", 12)}${bar(120, top + 46, 150, "var(--color-hairline-strong)", 10)}
        <rect x="364" y="${top + 24}" width="52" height="30" rx="15" fill="${on ? "var(--color-action)" : "var(--color-hairline-strong)"}"/>
        <circle cx="${on ? 401 : 379}" cy="${top + 39}" r="11" fill="var(--color-surface)"/>`;
    })
    .join("");
  return scene(`${ground("var(--avatar-indigo)")}${rows}`);
}

export function growthArt(): string {
  return scene(`<defs><linearGradient id="art-growth-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--color-action)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--color-action)" stop-opacity="0"/></linearGradient></defs>
    ${ground("var(--avatar-cyan)")}
    <rect x="40" y="40" width="400" height="280" rx="22" fill="var(--color-surface)"/>
    ${[0, 1, 2, 3].map((line) => `<path d="M68 ${100 + line * 50}h344" stroke="var(--color-hairline)" stroke-width="2"/>`).join("")}
    <path d="M68 280C140 276 170 262 216 220S320 130 412 96V280z" fill="url(#art-growth-fill)"/>
    <path d="M68 280C140 276 170 262 216 220S320 130 412 96" fill="none" stroke="var(--color-action)" stroke-width="4" stroke-linecap="round"/>
    <circle cx="216" cy="220" r="9" fill="var(--color-surface)" stroke="var(--color-action)" stroke-width="4"/>
    <circle cx="412" cy="96" r="9" fill="var(--color-action)"/>
    ${bar(68, 62, 96, "var(--color-ink)", 14)}`);
}

/** A dotted route of stops across the home hero: companies on the move. */
export function routeArt(): string {
  const stops = [
    { x: 150, y: 150 },
    { x: 420, y: 96 },
    { x: 700, y: 128 },
    { x: 1030, y: 62 },
  ];
  const nodes = stops
    .map(
      (stop, index) => `<circle cx="${stop.x}" cy="${stop.y}" r="13" fill="var(--color-surface)" stroke="var(--color-action)" stroke-width="4"/>
      <rect x="${stop.x - 58}" y="${stop.y - 62 - (index % 2) * 10}" width="116" height="34" rx="17" fill="var(--color-surface)" stroke="var(--color-hairline)" stroke-width="2"/>
      <circle cx="${stop.x - 34}" cy="${stop.y - 45 - (index % 2) * 10}" r="7" fill="${index === 3 ? "var(--color-money-in)" : "var(--color-action)"}"/>
      ${bar(stop.x - 20, stop.y - 51 - (index % 2) * 10, 62, "var(--color-hairline-strong)", 12)}`,
    )
    .join("");
  return scene(
    `<path d="M-20 200C80 190 90 150 150 150S330 70 420 96 600 160 700 128 920 40 1030 62 1160 70 1220 40" fill="none" stroke="var(--color-hairline-strong)" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 14"/>
    ${nodes}`,
    "0 -24 1200 244",
  );
}
