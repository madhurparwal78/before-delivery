// The pinned story: three statements, swapped by scroll over three viewport heights (stacked with reduced motion).
const STATEMENTS = ["Four days.", "Five venues.", "One lattice."];

export function Story() {
  return (
    <section className="section section--story" data-ground="story" data-story data-step="0" aria-label="About the festival">
      <div className="story__pin">
        <div className="story__stage grid">
          {STATEMENTS.map((text, i) => (
            <p key={text} className="display story__statement" data-index={i} data-fit>{text}</p>
          ))}
        </div>
        <div className="grid"><ol className="story__index figures" aria-hidden="true"><li>01 Four days</li><li>02 Five venues</li><li>03 One lattice</li></ol></div>
        <div className="grid"><p className="story__note">Kerf Collective is a small nonprofit festival of art and technology. Every session sits on the lattice above: a slab per day, a pillar per venue.</p></div>
      </div>
    </section>
  );
}
