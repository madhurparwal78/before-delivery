const PATTERNS: Record<string, string[]> = {
  bolt: ['.....##..', '....##...', '...##....', '..#####..', '.....##..', '....##...', '...##....', '..##.....'],
  branch: ['....#....', '....#....', '....#....', '...###...', '..##.##..', '.##...##.', '.##...##.', '.##...##.'],
  grid: ['##.##.##.', '##.##.##.', '.........', '##.##.##.', '##.##.##.', '.........', '##.##.##.', '##.##.##.'],
  mail: ['.#######.', '.##...##.', '.#.#.#.#.', '.#..#..#.', '.#.....#.', '.#.....#.', '.#######.', '.........'],
};

/** A pixel icon: white rounded squares on a lattice grid, each square shifting a step on card hover. */
export function PixelIcon({ name }: { name: keyof typeof PATTERNS }) {
  const rows = PATTERNS[name] ?? [];
  let index = 0;
  return (
    <div className="pixel-icon" aria-hidden="true">
      {rows.flatMap((row, y) =>
        [...row].map((cell, x) => {
          if (cell !== '#') return null;
          index += 1;
          const dx = ((index * 3) % 5) - 2;
          const dy = ((index * 7) % 5) - 2;
          return <span key={`${x}-${y}`} className="px" style={{ gridColumn: x + 1, gridRow: y + 1, ['--dx' as string]: `${dx * 3}px`, ['--dy' as string]: `${dy * 3}px` }} />;
        }),
      )}
    </div>
  );
}
