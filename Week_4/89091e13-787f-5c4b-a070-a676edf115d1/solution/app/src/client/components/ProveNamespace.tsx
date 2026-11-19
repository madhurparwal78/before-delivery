import { useState } from "react";
import type { BlockDetail, NamespaceProofs, RowProof } from "../../shared/api.ts";
import { verifyRowProof } from "../../shared/nmt.ts";
import { getJson, withQuery } from "../lib/api.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { Field, FormAlert, SubmitButton, useFormModel } from "./forms.tsx";

function proofLine(proof: RowProof): string {
  if (proof.kind === "inclusion") return `Row ${proof.row}: inclusion, columns ${proof.start} to ${proof.end - 1}, ${proof.nodes.length} proof nodes`;
  if (proof.kind === "absence") return `Row ${proof.row}: absence, next leaf at column ${proof.nextLeaf.col}`;
  return `Row ${proof.row}: outside this row's namespace range`;
}

/** The prove form and the Namespace proof region; Verify recomputes the row root in the browser. */
export function ProveNamespace({ block }: { block: BlockDetail }) {
  const { id } = useWorkspace();
  const model = useFormModel();
  const [namespace, setNamespace] = useState("");
  const [proofs, setProofs] = useState<NamespaceProofs | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, string>>({});

  const verify = (proof: RowProof, committed: BlockDetail["rowRoots"][number], namespaceHex: string) => {
    const { verified } = verifyRowProof(proof, namespaceHex, block.squareWidth * 2, committed);
    setVerdicts((old) => ({ ...old, [proof.row]: verified ? `Verified against row ${proof.row} root.` : `Proof does not match row ${proof.row} root.` }));
  };

  return (
    <section className="panel">
      <h2 className="form-title">Prove namespace</h2>
      <form aria-label="Prove namespace" noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void model.run(event.currentTarget, async () => {
          setProofs(await getJson<NamespaceProofs>(withQuery(`/api/w/${id}/blocks/${block.height}/proofs`, { namespace })));
          setVerdicts({});
          return "";
        });
      }}>
        <Field name="namespace" label="Namespace to prove" error={model.errors.namespace}>
          {(props) => <input {...props} type="text" className="mono" autoComplete="off" spellCheck={false} value={namespace} onChange={(e) => setNamespace(e.target.value)} />}
        </Field>
        <FormAlert model={model} />
        <SubmitButton model={model}>Prove namespace</SubmitButton>
      </form>
      <section aria-label="Namespace proof" className="proof">
        {proofs?.rows.map((proof) => (
          <div key={proof.row} className="proof__row">
            <p>{proofLine(proof)}</p>
            {proof.kind === "absence" && <p>Next leaf hash <code>{proof.nextLeaf.hash}</code></p>}
            {proof.kind !== "outside" && (
              <>
                <ol aria-label={`Row ${proof.row} proof nodes`} className="roots">
                  {proof.nodes.map((node, index) => (
                    <li key={index} data-min={node.min} data-max={node.max} data-hash={node.hash}>
                      <code>{node.min}</code> <code>{node.max}</code> <code>{node.hash}</code>
                    </li>
                  ))}
                </ol>
                <button type="button" className="pill pill--outline"
                  onClick={() => verify(proof, block.rowRoots[proof.row] as BlockDetail["rowRoots"][number], proofs.namespace)}>
                  Verify row {proof.row}
                </button>
                {verdicts[proof.row] && <p className="proof__verdict">{verdicts[proof.row]}</p>}
              </>
            )}
          </div>
        ))}
      </section>
    </section>
  );
}
