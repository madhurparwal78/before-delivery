import { EmptyPrint } from "../ui/Prints";

/** One lit print drawn in code with one sentence beside it. */
export function EmptyState({ sentence, seed }: { sentence: string; seed: string }) {
  return (
    <div className="empty-state">
      <EmptyPrint seed={seed} />
      <p className="empty-sentence">{sentence}</p>
    </div>
  );
}
