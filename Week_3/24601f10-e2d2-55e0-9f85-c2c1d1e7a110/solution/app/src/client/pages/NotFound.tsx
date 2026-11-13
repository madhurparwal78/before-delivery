import type { ReactNode } from 'react';
import { Chrome } from '../components/Chrome.js';

export function NotFound({ text = "We couldn't find that page." }: { text?: string }): ReactNode {
  return (
    <Chrome>
      <p className="not-found">{text}</p>
    </Chrome>
  );
}
