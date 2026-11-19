import { useEffect, useRef, useState } from "react";
import type { BlobInfo, FeeEstimate, NamespaceInfo, StakingMe, TransactionCreated } from "../../shared/api.ts";
import { STORAGE_DOWN_SUBMIT } from "../../shared/copy.ts";
import { formatFernUnit, groupThousands, plainFern } from "../../shared/units.ts";
import { CopyId } from "../components/CopyId.tsx";
import { Page } from "../components/Page.tsx";
import { ButtonPill } from "../components/Pill.tsx";
import { Field, FormAlert, FormStatus, SubmitButton, useFormModel, useRoleGate } from "../components/forms.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { api, getJson, withQuery } from "../lib/api.ts";
import { truncateId } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { Link } from "../lib/router.tsx";
import { useWorkspace } from "../lib/workspace.tsx";
import { FormPanel } from "../components/FormPanel.tsx";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function RegisterNamespaceForm({ onDone }: { onDone: () => void }) {
  const { id } = useWorkspace();
  const model = useFormModel();
  const gate = useRoleGate("write");
  const [name, setName] = useState("");
  const [hex, setHex] = useState("");

  return (
    <FormPanel title="Register namespace">
      <form aria-label="Register namespace" noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void model.run(event.currentTarget, async () => {
          const made = await api<NamespaceInfo>("POST", `/api/w/${id}/namespaces`, { name, hex });
          setName("");
          setHex("");
          onDone();
          return `Namespace ${made.name} registered.`;
        });
      }}>
        {gate.note}
        <Field name="name" label="Namespace name" error={model.errors.name} extraDescription={gate.describedBy}>
          {(props) => <input {...props} type="text" value={name} disabled={gate.disabled} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field name="hex" label="Namespace hex" error={model.errors.hex} extraDescription={gate.describedBy}>
          {(props) => <input {...props} type="text" className="mono" autoComplete="off" spellCheck={false} value={hex} disabled={gate.disabled}
            onChange={(e) => setHex(e.target.value)} />}
        </Field>
        <FormAlert model={model} />
        <SubmitButton model={model} gate={gate}>Register namespace</SubmitButton>
        <FormStatus model={model} label="Register namespace status" />
      </form>
    </FormPanel>
  );
}

function SubmitBlobForm({ namespaces, onDone }: { namespaces: NamespaceInfo[]; onDone: () => void }) {
  const { id } = useWorkspace();
  const model = useFormModel();
  const gate = useRoleGate("write");
  const [namespace, setNamespace] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [fee, setFee] = useState("");
  const [feeEdited, setFeeEdited] = useState(false);
  const [estimate, setEstimate] = useState<FeeEstimate | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const payload = file ? file.bytes : new TextEncoder().encode(text);
  const size = payload.length;

  useEffect(() => {
    let current = true;
    getJson<FeeEstimate>(withQuery(`/api/w/${id}/fee-estimate`, { bytes: Math.max(size, 1) })).then((answer) => {
      if (current) setEstimate(answer);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [id, size]);

  useEffect(() => {
    if (estimate && !feeEdited) setFee(plainFern(estimate.feeUfern));
  }, [estimate, feeEdited]);

  const shown = estimate && size > 0 ? estimate : null;

  return (
    <>
    {model.alert === STORAGE_DOWN_SUBMIT && <p className="banner">{STORAGE_DOWN_SUBMIT}</p>}
    <FormPanel title="Submit blob">
      <form aria-label="Submit blob" noValidate className="stack" onSubmit={(event) => {
        event.preventDefault();
        void model.run(event.currentTarget, async () => {
          const minimum = await getJson<FeeEstimate>(withQuery(`/api/w/${id}/fee-estimate`, { bytes: Math.max(size, 1) }));
          const chargedFee = feeEdited ? fee : plainFern(minimum.feeUfern);
          await api<TransactionCreated>("POST", `/api/w/${id}/blobs`, { namespace, dataBase64: toBase64(payload), fee: chargedFee });
          setText("");
          setFile(null);
          setFeeEdited(false);
          if (fileInput.current) fileInput.current.value = "";
          onDone();
          return "Blob submitted. It is pending until a block includes it.";
        });
      }}>
        {gate.note}
        <Field name="namespace" label="Namespace" error={model.errors.namespace} extraDescription={gate.describedBy}>
          {(props) => (
            <select {...props} value={namespace} disabled={gate.disabled} onChange={(e) => setNamespace(e.target.value)}>
              <option value="">Choose a namespace</option>
              {namespaces.map((item) => <option key={item.id} value={item.hex}>{item.name}</option>)}
            </select>
          )}
        </Field>
        <Field name="data" label="Data" error={model.errors.data} extraDescription={gate.describedBy}>
          {(props) => <textarea {...props} rows={5} value={text} disabled={gate.disabled || file !== null} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="field">
          <label htmlFor="blob-file">Upload file</label>
          <input ref={fileInput} id="blob-file" type="file" disabled={gate.disabled} aria-describedby={gate.describedBy}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              if (!chosen) return setFile(null);
              void chosen.arrayBuffer().then((buffer) => setFile({ name: chosen.name, bytes: new Uint8Array(buffer) }));
            }} />
          {file && (
            <ButtonPill variant="outline" className="pill--small" onClick={() => {
              setFile(null);
              if (fileInput.current) fileInput.current.value = "";
            }}>Remove file</ButtonPill>
          )}
        </div>
        <section aria-label="Blob estimate" className="estimate">
          <p>Size {groupThousands(size)} bytes</p>
          <p>Shares {shown?.shares ?? 0}</p>
          <p>Gas {groupThousands(shown?.gas ?? 0)}</p>
          <p>Fee {formatFernUnit(shown?.feeUfern ?? 0)}</p>
        </section>
        <Field name="fee" label="Fee (FERN)" error={model.errors.fee} extraDescription={gate.describedBy}>
          {(props) => (
            <input {...props} type="text" inputMode="decimal" value={fee} disabled={gate.disabled}
              onChange={(e) => {
                setFee(e.target.value);
                setFeeEdited(true);
              }} />
          )}
        </Field>
        <FormAlert model={model} />
        <SubmitButton model={model} gate={gate}>Submit blob</SubmitButton>
        <FormStatus model={model} label="Submit blob status" />
      </form>
    </FormPanel>
    </>
  );
}

export function SubmitPage() {
  const { id } = useWorkspace();
  const namespaces = useJson<NamespaceInfo[]>(`/api/w/${id}/namespaces`);
  const blobs = useJson<BlobInfo[]>(withQuery(`/api/w/${id}/blobs`, { mine: true }));
  const me = useJson<StakingMe>(`/api/w/${id}/staking/me`);
  const reload = () => {
    namespaces.reload();
    blobs.reload();
    me.reload();
  };

  return (
    <Page title="Submit">
      <p className="readout" aria-busy={me.loading || undefined}>{me.data ? `Available ${formatFernUnit(me.data.availableUfern)}` : "\u00a0"}</p>
      <RegisterNamespaceForm onDone={reload} />
      <SubmitBlobForm namespaces={namespaces.data ?? []} onDone={reload} />
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Your blobs</h2>
        {blobs.data ? (
          <>
            <table aria-label="Your blobs">
              <thead><tr><th scope="col">Blob</th><th scope="col">Namespace</th><th scope="col" className="num">Size</th><th scope="col" className="num">Fee</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {blobs.data.map((blob) => (
                  <tr key={blob.id}>
                    <td className="id-cell"><Link to={`/w/${id}/blobs/${blob.id}`} className="mono">{truncateId(blob.id)}</Link><CopyId value={blob.id} /></td>
                    <td>{blob.namespaceName}</td>
                    <td className="num">{groupThousands(blob.size)} bytes</td>
                    <td className="num">{formatFernUnit(blob.feeUfern)}</td>
                    <td><span className="badge">{blob.statusText}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blobs.data.length === 0 && (
              <Empty sentence="No blobs yet.">
                <ButtonPill variant="outline" onClick={() => document.querySelector<HTMLElement>('form[aria-label="Submit blob"] select')?.focus()}>Submit a blob</ButtonPill>
              </Empty>
            )}
          </>
        ) : <Loading label="Your blobs loading" />}
      </section>
    </Page>
  );
}
