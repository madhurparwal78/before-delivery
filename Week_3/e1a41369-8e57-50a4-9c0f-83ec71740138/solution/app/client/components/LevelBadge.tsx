/** The level badge: a flat shield in blush and aubergine with the level in display type. */
export function LevelBadge({ level }: { level: number }) {
  return (
    <svg className="badge" role="img" aria-label={`Level ${level} badge`} width="128" height="128" viewBox="0 0 128 128">
      <polygon points="64,4 120,24 120,72 64,124 8,72 8,24" fill="var(--ink)" />
      <polygon points="64,16 108,32 108,68 64,108 20,68 20,32" fill="none" stroke="var(--blush)" strokeWidth="3" />
      <text x="64" y="80" textAnchor="middle" fontSize="52" fill="var(--blush)">{level}</text>
    </svg>
  );
}
