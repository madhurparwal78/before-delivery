// The Add to case dialog: pick an open case or start a new one, then add a group or an inbox item to it.
import { useState, type FormEvent } from "react";
import { api, ApiFailure } from "../lib/api";
import { Modal } from "../lib/dialog";
import { announce } from "../lib/store";
import { Button, ErrorSummary, Field, useBusy } from "../lib/ui";
import { useResource } from "../lib/useResource";

export type CaseTarget = { rule: number; group: string; title: string } | { inbox_item: number; title: string };

interface CaseSummary { number: number; title: string; status: string }

const NEW_CASE = "new";

export function AddToCaseDialog({ target, onClose }: { target: CaseTarget; onClose: () => void }) {
  const cases = useResource(() => api.get<{ cases: CaseSummary[] }>("/api/cases"), []);
  const [choice, setChoice] = useState(NEW_CASE);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, run] = useBusy();
  const open = cases.data?.cases.filter((c) => c.status !== "closed") ?? [];
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void run(async () => {
      try {
        let number = Number(choice);
        if (choice === NEW_CASE) number = (await api.post<{ number: number }>("/api/cases", { title: target.title })).number;
        const { title, ...reference } = target;
        void title;
        await api.post(`/api/cases/${number}/items`, reference);
        announce(`Added to case ${number}.`);
        onClose();
      } catch (error) {
        setFailure(error as ApiFailure);
      }
    });
  };
  return (
    <Modal label="Add to case" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <ErrorSummary failure={failure} />
        <Field label="Case">
          {(props) => (
            <select {...props} value={choice} onChange={(event) => setChoice(event.target.value)}>
              {open.map((c) => <option key={c.number} value={c.number}>{`Case ${c.number}: ${c.title}`}</option>)}
              <option value={NEW_CASE}>New case</option>
            </select>
          )}
        </Field>
        <div className="dialog-actions">
          <button type="submit" className="btn btn-primary" aria-busy={busy || undefined}>Add</button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
