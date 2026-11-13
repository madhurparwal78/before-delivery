const PANELS = [
  {
    title: 'Walk the room before you build it.',
    body: 'Keyway Bench puts your escape room on a 3D grid, so you can check sightlines and cue reveals before the carpenter starts.',
  },
  {
    title: 'Start from the plan',
    body: 'Set the room size, drop in doors, boxes and cylinders, and upload the props you already own. Lengths stay exact in metres or feet.',
  },
  {
    title: 'Wire the chain',
    body: 'Every puzzle, lock and cue is a node. Link it to a prop, list what has to happen first, and watch the chain light up cue by cue.',
  },
  {
    title: 'Step through the door',
    body: 'Press Play and stand at 1.6 m, 0.8 m inside the entry door, with a server-timed clock. Testers join from an emailed link.',
  },
  {
    title: 'Hand over one page',
    body: 'Freeze a version and share its build pack: sizes, placements, trigger wiring and file hashes, in the units your fabricator uses.',
  },
] as const;

/** Five short panels that pass over the stage as the visitor scrolls; the first carries the page's level-one heading. */
export function TourPanels() {
  return (
    <>
      {PANELS.map((panel, index) => {
        const Heading = index === 0 ? 'h1' : 'h2';
        return (
          <section key={panel.title} className="tour-section">
            <article className="tour-panel">
              <span className="tour-step mono" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <Heading>{panel.title}</Heading>
              <p>{panel.body}</p>
            </article>
          </section>
        );
      })}
    </>
  );
}
