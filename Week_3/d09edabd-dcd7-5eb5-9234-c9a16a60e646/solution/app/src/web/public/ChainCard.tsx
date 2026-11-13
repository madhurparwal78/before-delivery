import { useId } from 'react';
import { VAULT_CHAIN } from './vault';

/** The Vault's six nodes in chain order, each turning blue once its cue is lit, with the tour's progress line. */
export function ChainCard({ lit }: { lit: number }) {
  const heading = useId();
  return (
    <aside className="chain">
      <h2 id={heading}>Vault chain</h2>
      <ol aria-labelledby={heading}>
        {VAULT_CHAIN.map((title, index) => (
          <li key={title} data-lit={index < lit}>
            {title}
          </li>
        ))}
      </ol>
      <p role="status" aria-label="Tour progress">
        {lit} of {VAULT_CHAIN.length} cues lit
      </p>
    </aside>
  );
}
