import { useState } from 'react';
import { KENNELS } from '../../../shared/domain';
import { ApiError, mutate, post } from '../lib/api';
import { announce } from '../lib/announce';
import type { Dose, PatientSummary } from '../lib/types';
import { Modal } from './Modal';
import { describedBy, ErrorSummary, Field, Pill, type SummaryItem } from './ui';

const failure = (error: unknown): string => (error instanceof ApiError ? error.message : 'Something went wrong. Try again.');

function useSummary() {
  const [items, setItems] = useState<SummaryItem[]>([]);
  const [token, setToken] = useState(0);
  const show = (next: SummaryItem[]) => {
    setItems(next);
    setToken((t) => t + 1);
  };
  return { items, token, show, messageFor: (field: string) => items.find((i) => i.field === field)?.message };
}

interface DoseDialogProps {
  dose: Dose;
  returnFocus: () => HTMLElement | null;
  onClose: () => void;
  onDone: () => void;
}

/** `Add note`: a blank note is refused in the browser; the dialog, its text and its summary survive every refresh. */
export function NoteDialog({ dose, returnFocus, onClose, onDone }: DoseDialogProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const summary = useSummary();
  const submit = async () => {
    if (busy) return;
    if (text.trim() === '') {
      summary.show([{ field: 'note', message: 'Note is required.' }]);
      return;
    }
    setBusy(true);
    try {
      await mutate(
        () => post(`/api/treatments/${dose.id}/notes`, { text }),
        () => {
          announce(`Note saved for ${dose.patientName}, ${dose.name}.`);
          onDone();
          onClose();
        },
      );
    } catch (error) {
      summary.show([{ message: failure(error) }]);
      setBusy(false);
    }
  };
  return (
    <Modal label="Add note" onClose={onClose} returnFocus={returnFocus}>
      <h2 className="modal-title">Add note</h2>
      <p className="muted">{`${dose.patientName}, ${dose.name}`}</p>
      <ErrorSummary items={summary.items} token={summary.token} fieldId={(f) => `dose-${f}`} />
      <Field id="dose-note" label="Note" error={summary.messageFor('note')}>
        <textarea id="dose-note" rows={4} value={text} onChange={(e) => setText(e.target.value)} {...describedBy('dose-note', summary.messageFor('note'))} />
      </Field>
      <div className="modal-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Save note
        </Pill>
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Modal>
  );
}

/** `Skip treatment`: a reason is required; a rejection from the server stays in this dialog's summary. */
export function SkipDialog({ dose, returnFocus, onClose, onDone }: DoseDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const summary = useSummary();
  const submit = async () => {
    if (busy) return;
    if (reason.trim() === '') {
      summary.show([{ field: 'reason', message: 'Reason is required.' }]);
      return;
    }
    setBusy(true);
    try {
      await mutate(
        () => post(`/api/treatments/${dose.id}/skip`, { reason }),
        () => {
          announce(`${dose.patientName}, ${dose.name} skipped.`);
          onDone();
          onClose();
        },
      );
    } catch (error) {
      summary.show([{ message: failure(error) }]);
      setBusy(false);
      onDone();
    }
  };
  return (
    <Modal label="Skip treatment" onClose={onClose} returnFocus={returnFocus}>
      <h2 className="modal-title">Skip treatment</h2>
      <p className="muted">{`${dose.patientName}, ${dose.name}`}</p>
      <ErrorSummary items={summary.items} token={summary.token} fieldId={(f) => `dose-${f}`} />
      <Field id="dose-reason" label="Reason" error={summary.messageFor('reason')}>
        <input id="dose-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} {...describedBy('dose-reason', summary.messageFor('reason'))} />
      </Field>
      <div className="modal-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Skip treatment
        </Pill>
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Modal>
  );
}

const ADMIT_FIELDS: Record<string, string> = {
  patientId: 'patient',
  kennel: 'kennel',
  'treatments.0.name': 'treatment',
  'treatments.0.firstAt': 'first-dose',
  'treatments.0.intervalHours': 'every',
  'treatments.0.count': 'doses',
};

/** `Admit patient`: one treatment per admission; every rejection shows in the summary with a link to its control. */
export function AdmitDialog({ patients, returnFocus, onClose, onDone }: { patients: PatientSummary[]; returnFocus: () => HTMLElement | null; onClose: () => void; onDone: () => void }) {
  const [patientId, setPatientId] = useState('');
  const [kennel, setKennel] = useState('');
  const [treatment, setTreatment] = useState('');
  const [firstAt, setFirstAt] = useState('');
  const [every, setEvery] = useState('8');
  const [doses, setDoses] = useState('1');
  const [busy, setBusy] = useState(false);
  const summary = useSummary();
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await mutate(
        () =>
          post('/api/ward/admissions', {
            ...(patientId ? { patientId } : {}),
            ...(kennel ? { kennel } : {}),
            treatments: [{ ...(treatment ? { name: treatment } : {}), ...(firstAt ? { firstAt } : {}), ...(every ? { intervalHours: Number(every) } : {}), ...(doses ? { count: Number(doses) } : {}) }],
          }),
        () => {
          announce(`${patients.find((p) => p.id === patientId)?.name ?? 'Patient'} admitted to ${kennel}.`);
          onDone();
          onClose();
        },
      );
    } catch (error) {
      summary.show([{ field: error instanceof ApiError && error.field ? ADMIT_FIELDS[error.field] : undefined, message: failure(error) }]);
      setBusy(false);
    }
  };
  return (
    <Modal label="Admit patient" onClose={onClose} returnFocus={returnFocus}>
      <h2 className="modal-title">Admit patient</h2>
      <ErrorSummary items={summary.items} token={summary.token} fieldId={(f) => `admit-${f}`} />
      <Field id="admit-patient" label="Patient" error={summary.messageFor('patient')}>
        <select id="admit-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
          <option value="">Choose a patient</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id="admit-kennel" label="Kennel" error={summary.messageFor('kennel')}>
        <select id="admit-kennel" value={kennel} onChange={(e) => setKennel(e.target.value)}>
          <option value="">Choose a kennel</option>
          {KENNELS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <Field id="admit-treatment" label="Treatment" error={summary.messageFor('treatment')}>
        <input id="admit-treatment" type="text" value={treatment} onChange={(e) => setTreatment(e.target.value)} />
      </Field>
      <Field id="admit-first-dose" label="First dose" hint="Year-month-day and 24-hour clinic time, like 2026-11-17 08:00" error={summary.messageFor('first-dose')}>
        <input id="admit-first-dose" type="text" inputMode="numeric" value={firstAt} onChange={(e) => setFirstAt(e.target.value)} />
      </Field>
      <div className="field-pair">
        <Field id="admit-every" label="Every (hours)" error={summary.messageFor('every')}>
          <input id="admit-every" type="number" min={1} max={24} value={every} onChange={(e) => setEvery(e.target.value)} />
        </Field>
        <Field id="admit-doses" label="Doses" error={summary.messageFor('doses')}>
          <input id="admit-doses" type="number" min={1} max={28} value={doses} onChange={(e) => setDoses(e.target.value)} />
        </Field>
      </div>
      <div className="modal-actions">
        <Pill busy={busy} onClick={() => void submit()}>
          Admit
        </Pill>
        <Pill variant="outline" className="on-light" onClick={onClose}>
          Cancel
        </Pill>
      </div>
    </Modal>
  );
}
