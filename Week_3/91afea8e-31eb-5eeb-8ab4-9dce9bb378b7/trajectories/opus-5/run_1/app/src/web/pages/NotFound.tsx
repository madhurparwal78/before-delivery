import type { ReactNode } from 'react';
import { errorMessage } from '../../shared/messages.js';

export function NotFoundPage(): ReactNode {
  return (
    <div className="panel panel-black">
      <h1>{errorMessage('not_found')}</h1>
    </div>
  );
}
