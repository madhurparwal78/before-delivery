// Procedural flat drawings, black and white: a disc electricity meter and a pylon. Generated in code.

function svg(markup, cls) {
  const wrap = document.createElement("div");
  wrap.className = cls;
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML = markup;
  return wrap;
}

export function meter(cls = "art-meter") {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    const r1 = 92, r2 = i % 3 === 0 ? 78 : 84;
    return `<line x1="${(200 + Math.cos(a) * r1).toFixed(1)}" y1="${(262 + Math.sin(a) * r1).toFixed(1)}" x2="${(200 + Math.cos(a) * r2).toFixed(1)}" y2="${(262 + Math.sin(a) * r2).toFixed(1)}" stroke="#0D0D0B" stroke-width="${i % 3 === 0 ? 5 : 3}"/>`;
  }).join("");
  const digits = [0, 0, 4, 7, 1].map((d, i) => `<rect x="${112 + i * 34}" y="108" width="30" height="40" fill="#0D0D0B"/><text x="${127 + i * 34}" y="139" text-anchor="middle" font-family="Unbounded Variable, sans-serif" font-weight="900" font-size="26" fill="#fff">${d}</text>`).join("");
  const screws = [[64, 64], [336, 64], [64, 336], [336, 336]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="#0D0D0B" stroke-width="5"/><line x1="${x - 6}" y1="${y - 6}" x2="${x + 6}" y2="${y + 6}" stroke="#0D0D0B" stroke-width="3"/>`).join("");
  return svg(`<svg viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <rect x="14" y="14" width="372" height="392" fill="#fff" stroke="#0D0D0B" stroke-width="14"/>
    <circle cx="200" cy="200" r="168" fill="#fff" stroke="#0D0D0B" stroke-width="12"/>
    <circle cx="200" cy="200" r="150" fill="#fff" stroke="#0D0D0B" stroke-width="4"/>
    ${digits}
    <text x="200" y="190" text-anchor="middle" font-family="Onest Variable, sans-serif" font-weight="700" font-size="20" fill="#0D0D0B">kWh  240 V  50 Hz</text>
    <circle cx="200" cy="262" r="100" fill="#fff" stroke="#0D0D0B" stroke-width="8"/>
    ${ticks}
    <circle cx="200" cy="262" r="46" fill="#0D0D0B"/>
    <rect x="192" y="168" width="16" height="42" fill="#0D0D0B"/>
    <circle cx="200" cy="262" r="12" fill="#fff"/>
    <rect x="120" y="362" width="160" height="36" fill="#0D0D0B"/>
    <circle cx="152" cy="380" r="9" fill="#fff"/><circle cx="200" cy="380" r="9" fill="#fff"/><circle cx="248" cy="380" r="9" fill="#fff"/>
    ${screws}
  </svg>`, cls);
}

export function pylon(cls = "art-pylon") {
  const bars = (y, w) => `<line x1="${200 - w}" y1="${y}" x2="${200 + w}" y2="${y}" stroke="#0D0D0B" stroke-width="10"/>`;
  const drops = (y, w) => [-w, w].map((dx) => `<line x1="${200 + dx}" y1="${y}" x2="${200 + dx}" y2="${y + 22}" stroke="#0D0D0B" stroke-width="6"/><rect x="${200 + dx - 7}" y="${y + 22}" width="14" height="22" fill="#fff" stroke="#0D0D0B" stroke-width="4"/>`).join("");
  return svg(`<svg viewBox="0 0 400 520" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <polygon points="200,20 130,500 270,500" fill="none" stroke="#0D0D0B" stroke-width="12" stroke-linejoin="miter"/>
    <polyline points="168,260 232,380 168,380 232,260" fill="none" stroke="#0D0D0B" stroke-width="8"/>
    <polyline points="154,380 246,500 154,500 246,380" fill="none" stroke="#0D0D0B" stroke-width="8"/>
    <polyline points="184,130 216,260 184,260 216,130" fill="none" stroke="#0D0D0B" stroke-width="8"/>
    ${bars(120, 120)}${bars(220, 170)}${bars(320, 120)}
    ${drops(120, 120)}${drops(220, 170)}${drops(320, 120)}
  </svg>`, cls);
}
