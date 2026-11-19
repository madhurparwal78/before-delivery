// The Gandyboard puffy wordmark: each letter its own colour with a darker extruded lower edge about 5px deep, on an
// uneven playful baseline. Drawn for this product from Fredoka letterforms, layered in SVG.

const LETTERS = [
  { char: 'G', hue: '#0fa6ee', dark: '#0158b4', dy: 0, tilt: -4 },
  { char: 'a', hue: '#ff9f0f', dark: '#c46a00', dy: 8, tilt: 3 },
  { char: 'n', hue: '#3fb56b', dark: '#1f7a45', dy: -3, tilt: -2 },
  { char: 'd', hue: '#e8478b', dark: '#a3205a', dy: 5, tilt: 4 },
  { char: 'y', hue: '#7a5cf0', dark: '#4a30b8', dy: -2, tilt: -3 },
  { char: 'b', hue: '#0fa6ee', dark: '#0158b4', dy: 6, tilt: 2 },
  { char: 'o', hue: '#ff9f0f', dark: '#c46a00', dy: -4, tilt: -4 },
  { char: 'a', hue: '#3fb56b', dark: '#1f7a45', dy: 4, tilt: 3 },
  { char: 'r', hue: '#e8478b', dark: '#a3205a', dy: -2, tilt: -2 },
  { char: 'd', hue: '#7a5cf0', dark: '#4a30b8', dy: 7, tilt: 4 },
]

const WIDTHS: Record<string, number> = { G: 56, a: 46, n: 46, d: 48, y: 44, b: 48, o: 46, r: 34, '': 0 }
const GAP = 3

export function Wordmark() {
  let x = 6
  const placed = LETTERS.map(letter => {
    const at = x
    x += (WIDTHS[letter.char] ?? 46) + GAP
    return { ...letter, x: at }
  })
  const width = x + 6
  return (
    <svg role="img" aria-label="Gandyboard" data-testid="splash-wordmark" className="wordmark" viewBox={`0 0 ${width} 96`} preserveAspectRatio="xMidYMid meet">
      {placed.map((letter, index) => (
        <g key={index} transform={`translate(${letter.x} ${54 + letter.dy}) rotate(${letter.tilt} ${(WIDTHS[letter.char] ?? 46) / 2} 0)`}>
          {[5, 4, 3, 2, 1].map(depth => (
            <text key={depth} x="0" y={depth} className="wordmark-letter" fill={letter.dark} stroke={letter.dark} strokeWidth="5" strokeLinejoin="round" aria-hidden="true">{letter.char}</text>
          ))}
          <text x="0" y="0" className="wordmark-letter" fill={letter.hue} stroke={letter.hue} strokeWidth="5" strokeLinejoin="round" aria-hidden="true">{letter.char}</text>
          <text x="0" y="0" className="wordmark-letter" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.4" transform="translate(-0.5 -1.2)" aria-hidden="true">{letter.char}</text>
        </g>
      ))}
    </svg>
  )
}
