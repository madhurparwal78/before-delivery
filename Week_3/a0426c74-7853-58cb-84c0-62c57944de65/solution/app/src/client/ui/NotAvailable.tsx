import { Notice } from './Notice.tsx';

/** The Not available screen: plain sentences in a surface block on the ground. */
export function NotAvailable({ sentences }: { sentences: readonly string[] }) {
  return (
    <main className="not-available">
      <Notice>
        {sentences.map((sentence) => <p key={sentence}>{sentence}</p>)}
      </Notice>
    </main>
  );
}
