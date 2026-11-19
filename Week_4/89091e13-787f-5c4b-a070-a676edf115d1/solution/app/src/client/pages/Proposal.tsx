import { useState } from "react";
import { VOTE_CHOICES, type Proposal, type VoteOption } from "../../shared/api.ts";
import { TRANSACTION_SENT } from "../../shared/copy.ts";
import { formatDateTime, formatFern, formatFernUnit } from "../../shared/units.ts";
import { Page } from "../components/Page.tsx";
import { Field, FormAlert, SubmitButton, useFormModel, useRoleGate, useStatusSink } from "../components/forms.tsx";
import { Loading } from "../components/StrandCanvas.tsx";
import { api } from "../lib/api.ts";
import { display } from "../lib/config.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { NotFoundContent } from "./NotFound.tsx";

function TallyRegion({ proposal }: { proposal: Proposal }) {
  const { tally } = proposal;
  const projected = proposal.status === "deposit" || proposal.status === "voting";
  return (
    <section aria-label="Tally" className="panel tally">
      <p>Votes {formatFern(tally.votesUfern)} of {formatFernUnit(tally.totalBondedUfern)} ({tally.turnout}%)</p>
      <p>Yes {formatFernUnit(tally.yesUfern)}</p>
      <p>No {formatFernUnit(tally.noUfern)}</p>
      <p>No with veto {formatFernUnit(tally.noWithVetoUfern)} ({tally.vetoShare}%)</p>
      <p>Abstain {formatFernUnit(tally.abstainUfern)}</p>
      <p>Yes share {tally.yesShare}%</p>
      <p className="tally__result">{projected ? "Projected result" : "Result"} {tally.result}</p>
    </section>
  );
}

export function ProposalPage({ number }: { number: string }) {
  const { id } = useWorkspace();
  const proposal = useJson<Proposal>(`/api/w/${id}/proposals/${number}`);
  const sink = useStatusSink();
  const voteModel = useFormModel(sink);
  const depositModel = useFormModel(sink);
  const gate = useRoleGate("write");
  const [choice, setChoice] = useState<VoteOption | null>(null);
  const [amount, setAmount] = useState("");

  if (proposal.error) return <NotFoundContent />;
  const data = proposal.data;
  if (!data) return <Page title="Proposal"><Loading label="Proposal loading" /></Page>;

  const voting = data.status === "voting";
  const selected = choice ?? data.myVote;
  const stamp = (at: string) => formatDateTime(at, display.timeZone);

  return (
    <Page title={`Proposal ${data.number}: ${data.title}`}>
      <section className="panel">
        <p className="readout">{data.statusText}</p>
        <p>{data.description}</p>
        <ul className="plain-list">
          <li>Deposit period ends {stamp(data.depositEndsAt)}</li>
          <li>{data.votingEndsAt ? `Voting period ends ${stamp(data.votingEndsAt)}` : "Voting opens when the deposit reaches the minimum."}</li>
          <li>Deposited {formatFernUnit(data.depositUfern)} of {formatFernUnit(data.minDepositUfern)}</li>
        </ul>
      </section>
      <TallyRegion proposal={data} />
      <section className="panel form-panel">
        <h2 className="form-title">Your vote</h2>
        <form aria-label="Cast vote" noValidate className="stack" onSubmit={(event) => {
          event.preventDefault();
          void voteModel.run(event.currentTarget, async () => {
            await api("POST", `/api/w/${id}/proposals/${number}/votes`, { option: selected ?? "" });
            return TRANSACTION_SENT;
          });
        }}>
          {gate.note}
          <div role="radiogroup" aria-label="Your vote" aria-describedby={gate.describedBy} className="choices">
            {VOTE_CHOICES.map((option) => (
              <label key={option.value} className="choice">
                <input type="radio" name="option" value={option.value} checked={selected === option.value} disabled={gate.disabled || !voting}
                  aria-describedby={gate.describedBy} onChange={() => setChoice(option.value)} />
                <span className="choice__mark" aria-hidden="true" />
                {option.label}
              </label>
            ))}
          </div>
          {voteModel.errors.option && <p className="field-error">{voteModel.errors.option}</p>}
          <FormAlert model={voteModel} />
          <button type="submit" className="pill pill--solid" disabled={gate.disabled || voteModel.pending || !voting}
            aria-busy={voteModel.pending || undefined} aria-describedby={gate.describedBy}>Cast vote</button>
        </form>
      </section>
      {data.status === "deposit" && (
        <section className="panel form-panel">
          <h2 className="form-title">Deposit</h2>
          <form aria-label="Deposit" noValidate className="stack" onSubmit={(event) => {
            event.preventDefault();
            void depositModel.run(event.currentTarget, async () => {
              await api("POST", `/api/w/${id}/proposals/${number}/deposits`, { amount });
              setAmount("");
              return TRANSACTION_SENT;
            });
          }}>
            <Field name="amount" label="Deposit (FERN)" error={depositModel.errors.amount} extraDescription={gate.describedBy}>
              {(props) => <input {...props} type="text" inputMode="decimal" value={amount} disabled={gate.disabled} onChange={(e) => setAmount(e.target.value)} />}
            </Field>
            <FormAlert model={depositModel} />
            <SubmitButton model={depositModel} gate={gate}>Deposit</SubmitButton>
          </form>
        </section>
      )}
      <p role="status" aria-label="Vote status" className="form-status">{sink.status}</p>
    </Page>
  );
}
