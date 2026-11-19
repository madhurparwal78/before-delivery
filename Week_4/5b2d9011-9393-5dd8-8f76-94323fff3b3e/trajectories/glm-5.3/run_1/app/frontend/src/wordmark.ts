// The Holdfast pixel wordmark: an original grid of square pixels spelling
// "Holdfast" with a few loose pixels breaking off its left edge.
export function wordmarkSVG(): string {
  // 5x7 pixel font for each letter, drawn on a 71-unit grid.
  // Rows are encoded as strings of '.' and '#'.
  const letters: Record<string, string[]> = {
    H: ["##.##", "##.##", "#####", "##.##", "##.##", "##.##", "##.##"],
    o: [".###.", "##.##", "##.##", "##.##", "##.##", "##.##", ".###."],
    l: ["##...", "##...", "##...", "##...", "##...", "##...", "##..."],
    d: ["..##.", ".###.", "##.##", "##.##", "##.##", ".###.", "..##."],
    f: ["####.", "##...", "###..", "##...", "##...", "##...", "##..."],
    a: [".###.", "##.##", "##.##", "#####", "##.##", "##.##", "##.##"],
    s: [".####", "##...", "##...", ".###.", "...##", "...##", "####."],
    t: ["#####", "..##.", "..##.", "..##.", "..##.", "..##.", "..##."],
  };
  const word = "Holdfast";
  const px = 4; // pixel size
  const gap = 1;
  const letterSpacing = 5 * px + gap * px;

  let rects = "";
  let originX = 0;
  for (const ch of word) {
    const rows = letters[ch];
    if (!rows) { originX += letterSpacing; continue; }
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === "#") {
          const x = originX + c * px;
          const y = r * px;
          rects += `<rect x="${x}" y="${y}" width="${px - 0.5}" height="${px - 0.5}"/>`;
        }
      }
    }
    originX += letterSpacing;
  }

  // Loose pixels breaking off the left edge, like debris.
  const debris = [
    { x: -3.5, y: 4 }, { x: -2.2, y: 9 }, { x: -4.5, y: 14 }, { x: -2.6, y: 20 },
  ];
  for (const d of debris) {
    rects += `<rect x="${d.x}" y="${d.y}" width="2.6" height="2.6" opacity="0.8"/>`;
  }

  const w = 8 * letterSpacing + 8;
  const h = 7 * px + 6;
  return `<svg viewBox="${-8} 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="#d9e9e2">${rects}</g>
</svg><span class="tagline">Nights</span>`;
}
