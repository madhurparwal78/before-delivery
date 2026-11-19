import { useState } from "react";
import type { Proposal } from "../../shared/api.ts";
import { TRANSACTION_SENT } from "../../shared/copy.ts";
import { Page } from "../components/Page.tsx";
import { Field, FormAlert, FormStatus, SubmitButton, useFormModel, useRoleGate } from "../components/forms.tsx";
import { Loading } from "../components/StrandCanvas.tsx";
import { api } from "../lib/api.ts";
import { useJson } from "../lib/resource.ts";
import { Link } from "../lib/router.tsx";
import { useWorkspace } from "../lib/workspace.tsx";
import { FormPanel } from "../components/FormPanel.tsx";

export function VotePage() {
  const { id } = useWorkspace();
  const proposals = useJson<Proposal[]>(`/api/w/${id}/proposals`);
  const model = useFormModel();
  const gate = useRoleGate("write");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [initialDeposit, setInitialDeposit] = useState("0");

  if (!proposals.data) return <Page title="Vote"><Loading label="Proposals loading" page /></Page>;

  return (
    <Page title="Vote">
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Proposals</h2>
        <table aria-label="Proposals">
            <thead><tr><th scope="col">Number</th><th scope="col">Title</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {proposals.data.map((proposal) => (
                <tr key={proposal.number}>
                  <td>{proposal.number}</td>
                  <td><Link to={`/w/${id}/vote/${proposal.number}`}>{proposal.title}</Link></td>
                  <td>{proposal.statusText}</td>
                </tr>
              ))}
            </tbody>
        </table>
      </section>
      <FormPanel title="New proposal">
        <form aria-label="New proposal" noValidate className="stack" onSubmit={(event) => {
          event.preventDefault();
          void model.run(event.currentTarget, async () => {
            await api("POST", `/api/w/${id}/proposals`, { title, description, initialDeposit });
            setTitle("");
            setDescription("");
            return TRANSACTION_SENT;
          });
        }}>
          {gate.note}
          <Field name="title" label="Title" error={model.errors.title} extraDescription={gate.describedBy}>
            {(props) => <input {...props} type="text" value={title} disabled={gate.disabled} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field name="description" label="Description" error={model.errors.description} extraDescription={gate.describedBy}>
            {(props) => <textarea {...props} rows={4} value={description} disabled={gate.disabled} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <Field name="initialDeposit" label="Initial deposit (FERN)" error={model.errors.initialDeposit} extraDescription={gate.describedBy}>
            {(props) => <input {...props} type="text" inputMode="decimal" value={initialDeposit} disabled={gate.disabled} onChange={(e) => setInitialDeposit(e.target.value)} />}
          </Field>
          <FormAlert model={model} />
          <SubmitButton model={model} gate={gate}>Submit proposal</SubmitButton>
          <FormStatus model={model} label="New proposal status" />
        </form>
      </FormPanel>
    </Page>
  );
}
