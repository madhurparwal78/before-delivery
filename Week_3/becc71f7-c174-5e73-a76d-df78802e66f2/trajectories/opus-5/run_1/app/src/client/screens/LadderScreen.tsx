import { useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { dropDialog, holdDialog } from '../lib/resume.js';
import type { Ladder, Session } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { brusselsDate, formatDateOnly } from '../../shared/brussels.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, TableFrame } from '../components/layout.js';

const DIALOG = 'change-ladder';

const CONTROL_IDS = {
  effectiveOn: 'ladder-effective',
  firstMarkdownPercent: 'ladder-first-percent',
  firstMarkdownDay: 'ladder-first-day',
  secondMarkdownPercent: 'ladder-second-percent',
  secondMarkdownDay: 'ladder-second-day',
  periodEndDay: 'ladder-period-end',
};

export function LadderScreen({ session }: { session: Session }) {
  const ladders = usePolling(() => get<{ ladders: Ladder[] }>('/api/ladders'), 'ladders');
  const dialog = useOverlay();
  const [draft, setDraft] = useState({
    effectiveOn: brusselsDate(Date.now()),
    firstMarkdownPercent: '25',
    firstMarkdownDay: '30',
    secondMarkdownPercent: '50',
    secondMarkdownDay: '60',
    periodEndDay: '90',
  });
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);

  const rows = ladders.data?.ladders ?? [];

  const change = (next: Partial<typeof draft>): void => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      holdDialog(DIALOG, merged);
      return merged;
    });
  };

  const save = async (): Promise<void> => {
    setPending(true);
    try {
      const created = await post<{ ladder: Ladder }>('/api/ladders', {
        effectiveOn: draft.effectiveOn,
        firstMarkdownPercent: Number(draft.firstMarkdownPercent),
        firstMarkdownDay: Number(draft.firstMarkdownDay),
        secondMarkdownPercent: Number(draft.secondMarkdownPercent),
        secondMarkdownDay: Number(draft.secondMarkdownDay),
        periodEndDay: Number(draft.periodEndDay),
      });
      announce(copy.ladderSaved(formatDateOnly(created.ladder.effectiveOn)));
      setProblems(noProblems);
      dropDialog(DIALOG);
      dialog.close();
      await ladders.reload();
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
    <StaffShell session={session}>
      <h1 class="heading heading--1">Markdown ladder</h1>
      <TableFrame name="Ladders">
        <table class="table" aria-label="Ladders">
          <thead>
            <tr>
              <th scope="col">Takes effect on</th>
              <th scope="col">First markdown</th>
              <th scope="col">Second markdown</th>
              <th scope="col">Period ends</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ladder) => (
              <tr key={ladder.id}>
                <td class="tabular">{formatDateOnly(ladder.effectiveOn)}</td>
                <td class="tabular">
                  {`${ladder.firstMarkdownPercent}% off from day ${ladder.firstMarkdownDay}`}
                </td>
                <td class="tabular">
                  {`${ladder.secondMarkdownPercent}% off from day ${ladder.secondMarkdownDay}`}
                </td>
                <td class="tabular">{`day ${ladder.periodEndDay}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>

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
          Change ladder
        </button>
      </BottomBar>

      {dialog.mounted ? (
        <Overlay state={dialog} name="Change ladder">
          <h2 class="dialog__heading">Change ladder</h2>
          <ProblemsSummary problems={problems} controlIds={CONTROL_IDS} labels={{}} />
          <Field
            id={CONTROL_IDS.effectiveOn}
            label="Takes effect on"
            type="date"
            value={draft.effectiveOn}
            onInput={(value) => change({ effectiveOn: value })}
            problem={problems.fields['effectiveOn']}
          />
          <Field
            id={CONTROL_IDS.firstMarkdownPercent}
            label="First markdown percent"
            inputMode="numeric"
            value={draft.firstMarkdownPercent}
            onInput={(value) => change({ firstMarkdownPercent: value })}
            problem={problems.fields['firstMarkdownPercent']}
          />
          <Field
            id={CONTROL_IDS.firstMarkdownDay}
            label="First markdown day"
            inputMode="numeric"
            value={draft.firstMarkdownDay}
            onInput={(value) => change({ firstMarkdownDay: value })}
            problem={problems.fields['firstMarkdownDay']}
          />
          <Field
            id={CONTROL_IDS.secondMarkdownPercent}
            label="Second markdown percent"
            inputMode="numeric"
            value={draft.secondMarkdownPercent}
            onInput={(value) => change({ secondMarkdownPercent: value })}
            problem={problems.fields['secondMarkdownPercent']}
          />
          <Field
            id={CONTROL_IDS.secondMarkdownDay}
            label="Second markdown day"
            inputMode="numeric"
            value={draft.secondMarkdownDay}
            onInput={(value) => change({ secondMarkdownDay: value })}
            problem={problems.fields['secondMarkdownDay']}
          />
          <Field
            id={CONTROL_IDS.periodEndDay}
            label="Period end day"
            inputMode="numeric"
            value={draft.periodEndDay}
            onInput={(value) => change({ periodEndDay: value })}
            problem={problems.fields['periodEndDay']}
          />
          <DialogActions>
            <ActionButton label="Save ladder" pending={pending} onPress={() => void save()} />
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
