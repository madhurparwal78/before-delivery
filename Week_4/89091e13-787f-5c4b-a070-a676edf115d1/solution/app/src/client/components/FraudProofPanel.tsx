import type { FraudProof } from "../../shared/api.ts";
import { capitalise } from "../lib/format.ts";

/** The fraud proof of a badly encoded line: both roots in full, and the verdict. */
export function FraudProofPanel({ proof }: { proof: FraudProof }) {
  const axis = capitalise(proof.axis);
  const crossing = proof.axis === "row" ? "column roots" : "row roots";
  const verified = proof.shares.filter((share) => share.verified).length;
  return (
    <section aria-label="Bad encoding fraud proof" className="panel fraud">
      <h2 className="section-title">Bad encoding fraud proof</h2>
      <p>{axis} {proof.index} of block {proof.height}</p>
      <p>{verified} of {proof.shares.length} shares verified against {crossing}</p>
      <p>Committed {proof.axis} root <code>{proof.committedRoot.hash}</code></p>
      <p>Recomputed {proof.axis} root <code>{proof.recomputedRoot.hash}</code></p>
      <p>{axis} {proof.index} is not encoded correctly. Block {proof.height} rejected.</p>
    </section>
  );
}
