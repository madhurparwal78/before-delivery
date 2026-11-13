/** Original stitch glyphs drawn on a 24 x 24 grid; every glyph is referenced from one sprite. */
const SHAPES: Record<string, string> = {
  k: '<path d="M12 4v16"/>',
  p: '<path d="M6 12h12"/>',
  yo: '<circle cx="12" cy="12" r="5.5"/>',
  k2tog: '<path d="M6 19 18 5"/>',
  ssk: '<path d="M6 5 18 19"/>',
  cdd: '<path d="M6 19 12 5l6 14M12 5v14"/>',
  m1l: '<path d="M6 19 18 5M6 5h4"/>',
  m1r: '<path d="M6 5 18 19M18 5h-4"/>',
  ns: '<path d="M9 12h6" opacity=".35"/>',
  c22: '<path d="M5 19 19 5M5 5l14 14"/>',
  sc: '<path d="M5 12h14M12 5v14"/>',
  hdc: '<path d="M6 5h12M12 5v14"/>',
  dc: '<path d="M6 5h12M12 5v14M9 12l6-3"/>',
  inc: '<path d="M6 5l6 14 6-14"/>',
  dec: '<path d="M6 19 12 5l6 14"/>',
}

export function GlyphSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(SHAPES).map(([key, shape]) => (
          <symbol key={key} id={`g-${key}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: shape }} />
        ))}
      </defs>
    </svg>
  )
}

export function Glyph({ stitch, size }: { stitch: string; size?: number }) {
  return (
    <svg className="glyph" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <use href={`#g-${stitch}`} />
    </svg>
  )
}
