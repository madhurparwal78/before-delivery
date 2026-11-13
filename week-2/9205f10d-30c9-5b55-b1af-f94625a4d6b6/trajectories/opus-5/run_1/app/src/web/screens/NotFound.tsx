import type { ReactNode } from 'react';

export function NotFound(): ReactNode {
  return (
    <main className="page">
      <h1>Request not found</h1>
      <p>{"This request doesn't exist or isn't available to you."}</p>
    </main>
  );
}
