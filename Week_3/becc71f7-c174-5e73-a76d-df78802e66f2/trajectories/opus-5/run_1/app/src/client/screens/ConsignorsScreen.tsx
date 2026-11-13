import { useEffect, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { claimResume, dropDialog, holdDialog } from '../lib/resume.js';
import type { Consignor, Session } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatIban } from '../../shared/money.js';
import { consignorStatusLabel } from '../../shared/options.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link, TableFrame } from '../components/layout.js';

const DIALOG = 'new-consignor';

const CONTROL_IDS = {
  name: 'consignor-name',
  email: 'consignor-email',
  phone: 'consignor-phone',
  iban: 'consignor-iban',
};

export function ConsignorsScreen({ session }: { session: Session }) {
  const consignors = usePolling(
    () => get<{ consignors: Consignor[] }>('/api/consignors'),
    'consignors',
  );
  const dialog = useOverlay();
  const resumed = claimResume(DIALOG);
  const [draft, setDraft] = useState({
    name: resumed?.['name'] ?? '',
    email: resumed?.['email'] ?? '',
    phone: resumed?.['phone'] ?? '',
    iban: resumed?.['iban'] ?? '',
  });
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (resumed !== null) dialog.open();
  }, []);

  const rows = consignors.data?.consignors ?? [];
  const chosen = rows.find((consignor) => consignor.id === selected) ?? rows[0];

  const change = (next: Partial<typeof draft>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      holdDialog(DIALOG, merged);
      return merged;
    });
  };

  const save = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(draft.name)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(draft.email)) fields['email'] = fieldCopy.email;
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending(true);
    try {
      await post<{ consignor: Consignor }>('/api/consignors', {
        name: draft.name.trim(),
        email: draft.email.trim(),
        phone: draft.phone.trim() === '' ? null : draft.phone.trim(),
        iban: draft.iban.trim() === '' ? null : draft.iban.trim(),
      });
      announce(copy.consignorSaved);
      setProblems(noProblems);
      setDraft({ name: '', email: '', phone: '', iban: '' });
      dropDialog(DIALOG);
      dialog.close();
      await consignors.reload();
    } catch (error) {
      if (error instanceof ApiError) {
        const { failure } = error;
        setProblems(
          Object.keys(failure.fields).length > 0
            ? problemsOf(failure.fields)
            : problemsOf({}, failure.message),
        );
        announce(failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session} layout="split">
      <h1 class="heading heading--1">Consignors</h1>
      <div class="split">
        <TableFrame name="Consignors">
          <table class="table" aria-label="Consignors">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">IBAN</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((consignor) => (
                <tr
                  key={consignor.id}
                  class={consignor.id === chosen?.id ? 'is-selected' : ''}
                  onClick={() => setSelected(consignor.id)}
                >
                  <td>
                    <Link href={`/staff/consignors/${consignor.id}`}>{consignor.name}</Link>
                  </td>
                  <td>{consignor.email ?? ''}</td>
                  <td class="tabular">{consignor.phone ?? ''}</td>
                  <td class="tabular">
                    {consignor.iban === null ? '' : formatIban(consignor.iban)}
                  </td>
                  <td>{consignorStatusLabel(consignor.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <aside class="detail">
          {chosen === undefined ? (
            <p>No consignor chosen.</p>
          ) : (
            <>
              <h2 class="detail__heading">{chosen.name}</h2>
              <p>{chosen.email ?? ''}</p>
              <p class="tabular">{chosen.iban === null ? '' : formatIban(chosen.iban)}</p>
              <p>{consignorStatusLabel(chosen.status)}</p>
              <Link href={`/staff/consignors/${chosen.id}`}>Open this consignor</Link>
            </>
          )}
        </aside>
      </div>

      <BottomBar>
        <button
          type="button"
          class="button button--primary"
          ref={dialog.openerRef}
          onClick={() => {
            holdDialog(DIALOG, draft);
            dialog.open();
          }}
        >
          New consignor
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="New consignor">
          <h2 class="dialog__heading">New consignor</h2>
          <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
          <Field
            id={CONTROL_IDS.name}
            label="Name"
            value={draft.name}
            onInput={(value) => change({ name: value })}
            problem={problems.fields['name']}
          />
          <Field
            id={CONTROL_IDS.email}
            label="Email"
            type="email"
            value={draft.email}
            onInput={(value) => change({ email: value })}
            problem={problems.fields['email']}
          />
          <Field
            id={CONTROL_IDS.phone}
            label="Phone"
            type="tel"
            value={draft.phone}
            onInput={(value) => change({ phone: value })}
            problem={problems.fields['phone']}
          />
          <Field
            id={CONTROL_IDS.iban}
            label="IBAN"
            value={draft.iban}
            onInput={(value) => change({ iban: value })}
            problem={problems.fields['iban']}
          />
          <DialogActions>
            <ActionButton label="Save consignor" pending={pending} onPress={() => void save()} />
            <button
              type="button"
              class="button button--quiet"
              onClick={() => {
                dropDialog(DIALOG);
                dialog.close();
              }}
            >
              Cancel
            </button>
          </DialogActions>
        </Overlay>
      ) : null}
    </StaffShell>
  );
}
