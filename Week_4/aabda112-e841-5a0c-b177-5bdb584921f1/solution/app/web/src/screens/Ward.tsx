import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { can, type TreatmentStatus } from '../../../shared/domain';
import { announce } from '../lib/announce';
import { errorText, mutate, post } from '../lib/api';
import { useLayout, useMe, useMotion } from '../lib/env';
import { hm, longDayLabel } from '../lib/format';
import { useResource } from '../lib/resource';
import type { Dose, PatientSummary } from '../lib/types';
import { KennelBeacons, type BeaconValues } from '../components/Beacons';
import { SplitBand } from '../components/Shell';
import { AdmitDialog, NoteDialog, SkipDialog } from '../components/WardDialogs';
import { Avatar, Banner, Chip, EmptyCard, Pill, Skeleton } from '../components/ui';

const STATUS_LABEL: Record<TreatmentStatus, string> = { upcoming: 'Upcoming', due: 'Due', overdue: 'Overdue', given: 'Given', skipped: 'Skipped' };
const GROUPS = [
  { name: 'Overdue', has: (s: TreatmentStatus) => s === 'overdue', tone: 'rose' },
  { name: 'Due', has: (s: TreatmentStatus) => s === 'due', tone: 'sky' },
  { name: 'Upcoming', has: (s: TreatmentStatus) => s === 'upcoming', tone: 'plain' },
  { name: 'Done', has: (s: TreatmentStatus) => s === 'given' || s === 'skipped', tone: 'mint' },
] as const;

/** The neighbour a ward-board arrow key leads to, by the published reading-order and column rules. */
function neighbour(groups: Dose[][], from: string, key: string, columns: number): string | null {
  const g = groups.findIndex((list) => list.some((d) => d.id === from));
  if (g < 0) return null;
  const list = groups[g]!;
  const idx = list.findIndex((d) => d.id === from);
  const row = Math.floor(idx / columns);
  const col = idx % columns;
  const rows = Math.ceil(list.length / columns);
  const nextGroup = groups.slice(g + 1).find((l) => l.length > 0);
  const previousGroup = [...groups.slice(0, g)].reverse().find((l) => l.length > 0);
  const inRow = (target: Dose[], r: number) => target[Math.min(r * columns + col, target.length - 1, r * columns + columns - 1)]!.id;
  switch (key) {
    case 'ArrowRight':
      return idx + 1 < list.length ? list[idx + 1]!.id : (nextGroup?.[0]?.id ?? null);
    case 'ArrowLeft':
      return idx > 0 ? list[idx - 1]!.id : (previousGroup?.[previousGroup.length - 1]?.id ?? null);
    case 'ArrowDown':
      if (idx + columns < list.length) return list[idx + columns]!.id;
      if (row + 1 < rows) return list[list.length - 1]!.id;
      return nextGroup ? inRow(nextGroup, 0) : null;
    case 'ArrowUp':
      if (row > 0) return list[idx - columns]!.id;
      return previousGroup ? inRow(previousGroup, Math.ceil(previousGroup.length / columns) - 1) : null;
    default:
      return null;
  }
}

/** Columns of the board at the viewport as it is right now (a resize may not have re-rendered yet). */
const columnsNow = (): number => (window.matchMedia('(min-width: 1100px)').matches ? 3 : window.matchMedia('(min-width: 768px)').matches ? 2 : 1);

type Dialog = { kind: 'note' | 'skip'; dose: Dose } | { kind: 'admit' };

function DoseCell({ dose, active, tone, canAct, onKey, onGiven, onReopen, onNote, onSkip }: {
  dose: Dose;
  active: boolean;
  tone: string;
  canAct: boolean;
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  onGiven: () => void;
  onReopen: () => void;
  onNote: () => void;
  onSkip: () => void;
}) {
  const motion = useMotion();
  const closed = dose.status === 'given' || dose.status === 'skipped';
  const pair = `${dose.patientName}, ${dose.name}`;
  return (
    <div
      role="gridcell"
      aria-label={`${pair}, ${hm(dose.scheduledAt)}, ${STATUS_LABEL[dose.status]}`}
      tabIndex={active ? 0 : -1}
      data-testid={`dose-${dose.id}`}
      className={`dose tint-${tone}`}
      {...motion('board-status', 300, 'ease-in-out')}
      onKeyDown={onKey}
    >
      <div className="dose-head">
        <Avatar name={dose.patientName} size={40} />
        <div>
          <p className="dose-patient">{dose.patientName}</p>
          <p className="muted">{`Kennel ${dose.kennel}`}</p>
        </div>
        <Chip tone={dose.status === 'overdue' ? 'rose' : dose.status === 'due' ? 'sky' : dose.status === 'given' ? 'mint' : 'plain'}>{STATUS_LABEL[dose.status]}</Chip>
      </div>
      <p className="dose-treatment">{dose.name}</p>
      <p className="dose-time">{hm(dose.scheduledAt)}</p>
      {dose.status === 'given' && dose.givenBy && <p className="muted">{`Given by ${dose.givenBy}`}</p>}
      {dose.status === 'skipped' && dose.skipReason && <p className="muted">{`Skipped: ${dose.skipReason}`}</p>}
      {dose.notes.length > 0 && (
        <ul className="dose-notes">
          {dose.notes.map((n) => (
            <li key={n.id}>{n.text}</li>
          ))}
        </ul>
      )}
      {canAct && (
        <div className="dose-actions">
          {closed ? (
            <Pill tabIndex={-1} variant="blue" aria-label={`Reopen, ${pair}`} onClick={onReopen}>
              Reopen
            </Pill>
          ) : (
            <Pill tabIndex={-1} aria-label={`Mark given, ${pair}`} onClick={onGiven}>
              Mark given
            </Pill>
          )}
          <Pill tabIndex={-1} variant="outline" className="on-light" aria-label={`Add note, ${pair}`} onClick={onNote}>
            Add note
          </Pill>
          {!closed && (
            <Pill tabIndex={-1} variant="outline" className="on-light" aria-label={`Skip, ${pair}`} onClick={onSkip}>
              Skip
            </Pill>
          )}
        </div>
      )}
    </div>
  );
}

export function Ward() {
  const me = useMe();
  const layout = useLayout();
  const columns = layout === 'desktop' ? 3 : layout === 'tablet' ? 2 : 1;
  const board = useResource<{ beacons: BeaconValues; treatments: Dose[] }>('/api/ward/board', ['ward']);
  const patients = useResource<{ patients: PatientSummary[] }>('/api/patients', ['patients']);
  const time = useResource<{ clinicDate: string }>('/api/time');
  const canAct = can(me.role, 'ward.act');
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const wanted = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const doses = board.data?.treatments;
  const groups = GROUPS.map((g) => (doses ?? []).filter((d) => g.has(d.status)));
  const firstId = groups.find((l) => l.length > 0)?.[0]?.id ?? null;
  const activeId = doses?.some((d) => d.id === active) ? active : firstId;

  useLayoutEffect(() => {
    if (!wanted.current || (document.activeElement && document.activeElement !== document.body)) return;
    document.querySelector<HTMLElement>(`[data-testid="dose-${wanted.current}"]`)?.focus();
  });

  // Focus follows a treatment that a push moves to another group, until the person deliberately moves on.
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      const cell = event.target instanceof HTMLElement && event.target.matches('[role="gridcell"][data-testid^="dose-"]') ? event.target : null;
      if (!cell) return;
      const id = cell.dataset.testid!.slice('dose-'.length);
      wanted.current = id;
      setActive(id);
    };
    document.addEventListener('focusin', remember, true);
    const forget = (event: Event) => {
      if (event.type === 'pointerdown' || (event instanceof globalThis.KeyboardEvent && event.key === 'Tab')) wanted.current = null;
    };
    document.addEventListener('pointerdown', forget, true);
    document.addEventListener('keydown', forget, true);
    return () => {
      document.removeEventListener('focusin', remember, true);
      document.removeEventListener('pointerdown', forget, true);
      document.removeEventListener('keydown', forget, true);
    };
  }, []);

  const cellFor = (id: string) => () => document.querySelector<HTMLElement>(`[data-testid="dose-${id}"]`);

  const act = (dose: Dose, verb: 'given' | 'reopen') => {
    setAlert(null);
    const say = verb === 'given' ? 'marked given' : 'reopened';
    mutate(
      () => post<Dose>(`/api/treatments/${dose.id}/${verb}`),
      () => announce(`${dose.patientName}, ${dose.name} ${say}.`),
    )
      .then(() => board.reload())
      .catch((error: unknown) => {
        setAlert(errorText(error));
        board.reload();
      });
  };

  const onKey = (dose: Dose) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const next = neighbour(groups, dose.id, event.key, columnsNow());
      if (next) {
        setActive(next);
        cellFor(next)()?.focus();
      }
    } else if (event.key === ' ' && canAct) {
      event.preventDefault();
      act(dose, event.shiftKey ? 'reopen' : 'given');
    } else if ((event.key === 'n' || event.key === 'N') && canAct) {
      event.preventDefault();
      setDialog({ kind: 'note', dose });
    } else if ((event.key === 's' || event.key === 'S') && canAct) {
      event.preventDefault();
      setDialog({ kind: 'skip', dose });
    }
  };

  const open = (kind: 'note' | 'skip', dose: Dose) => {
    setAlert(null);
    setDialog({ kind, dose });
  };

  const closeDialog = () => setDialog(null);
  const admit = (
    <Pill variant="mint" onClick={() => setDialog({ kind: 'admit' })}>
      Admit patient
    </Pill>
  );
  const anyDoses = (doses?.length ?? 0) > 0;

  return (
    <>
      <SplitBand title="Ward, today" aside={time.data && <span className="band-date">{longDayLabel(time.data.clinicDate)}</span>} actions={canAct ? admit : undefined}>
        <KennelBeacons values={board.data?.beacons} />
      </SplitBand>
      <Banner message={alert} />
      {!doses ? (
        <Skeleton rows={4} />
      ) : !anyDoses ? (
        <EmptyCard title="No patients are in the ward." tone="mint">
          {canAct && (
            <Pill variant="blue" onClick={() => setDialog({ kind: 'admit' })}>
              Admit a patient
            </Pill>
          )}
        </EmptyCard>
      ) : (
        <div role="grid" aria-label="Ward board" className="ward-board" ref={gridRef}>
          {GROUPS.map((group, g) => (
            <div key={group.name} role="rowgroup" aria-label={group.name} className="dose-group">
              <div role="row" className="group-head">
                <div role="columnheader">
                  <h2 className="section-title">{group.name}</h2>
                  <span className="muted">{groups[g]!.length}</span>
                </div>
              </div>
              {groups[g]!.length === 0 && <p className="muted group-empty">{`Nothing ${group.name === 'Done' ? 'finished' : group.name.toLowerCase()} right now.`}</p>}
              {Array.from({ length: Math.ceil(groups[g]!.length / columns) }, (_, r) => (
                <div role="row" key={r} className="dose-row" style={{ '--columns': columns } as React.CSSProperties}>
                  {groups[g]!.slice(r * columns, (r + 1) * columns).map((dose) => (
                    <DoseCell
                      key={dose.id}
                      dose={dose}
                      tone={group.tone}
                      active={dose.id === activeId}
                      canAct={canAct}
                      onKey={onKey(dose)}
                      onGiven={() => act(dose, 'given')}
                      onReopen={() => act(dose, 'reopen')}
                      onNote={() => open('note', dose)}
                      onSkip={() => open('skip', dose)}
                    />
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {dialog?.kind === 'admit' && patients.data && (
        <AdmitDialog patients={patients.data.patients} returnFocus={() => document.querySelector<HTMLElement>('.band-actions button')} onClose={closeDialog} onDone={board.reload} />
      )}
      {dialog?.kind === 'note' && <NoteDialog dose={dialog.dose} returnFocus={cellFor(dialog.dose.id)} onClose={closeDialog} onDone={board.reload} />}
      {dialog?.kind === 'skip' && <SkipDialog dose={dialog.dose} returnFocus={cellFor(dialog.dose.id)} onClose={closeDialog} onDone={board.reload} />}
    </>
  );
}
