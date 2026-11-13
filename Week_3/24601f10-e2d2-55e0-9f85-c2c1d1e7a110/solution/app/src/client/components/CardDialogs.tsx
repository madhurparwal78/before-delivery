import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Dependent, MatchView } from '../../shared/api.js';
import { isOrganizerRole } from '../../shared/rules.js';
import { dialogFor, type CardDialog } from '../bracketModel.js';
import type { Snapshot, TournamentStore } from '../liveStore.js';
import type { TraceController } from '../trace.js';
import { EditDialog } from './EditDialog.js';
import { ConfirmDialog, DetailsDialog, ReportDialog, ResolveDialog, type DialogEnv, type Viewer } from './ScoreDialogs.js';

interface Open { kind: CardDialog; match: MatchView; editing: boolean }

function focusCard(id: string): void {
  document.querySelector<HTMLElement>(`[data-match-id="${id}"]`)?.focus();
}

// The dialogs a match card opens, shared by the bracket, player and public pages. The dialog keeps the match as it was
// when it opened, so a write carries the version the person saw.
export function useCardDialogs({ store, snapshot, controller, feederOf, say }: {
  store: TournamentStore;
  snapshot: Snapshot;
  controller: TraceController;
  feederOf: (dependent: Dependent, reached: string[]) => string;
  say: (text: string) => void;
}): { open: (match: MatchView) => void; node: ReactNode; viewer: Viewer } {
  const [dialog, setDialog] = useState<Open | null>(null);
  const [refocus, setRefocus] = useState<{ id: string; n: number } | null>(null);
  const role = snapshot.tournament?.my_role;
  const viewer = useMemo<Viewer>(() => ({ organizer: role !== undefined && isOrganizerRole(role),
    entrantId: snapshot.me?.entrant.id ?? null, entrantName: snapshot.me?.entrant.name ?? null }), [role, snapshot.me]);

  useEffect(() => {
    if (refocus) focusCard(refocus.id);
  }, [refocus]);

  const env: DialogEnv = {
    store, viewer, say,
    finish: (id) => {
      setDialog(null);
      setRefocus((r) => ({ id, n: (r?.n ?? 0) + 1 }));
    },
    close: () => {
      if (dialog) setRefocus((r) => ({ id: dialog.match.id, n: (r?.n ?? 0) + 1 }));
      setDialog(null);
    },
  };

  const open = (match: MatchView): void => {
    setDialog({ kind: dialogFor(match, viewer), match, editing: false });
  };

  let node: ReactNode = null;
  if (dialog) {
    const { match } = dialog;
    node = (
      <>
        {dialog.kind === 'report' ? <ReportDialog match={match} env={env} /> : null}
        {dialog.kind === 'confirm' ? <ConfirmDialog match={match} env={env} /> : null}
        {dialog.kind === 'resolve' ? <ResolveDialog match={match} env={env} /> : null}
        {dialog.kind === 'details' ? <DetailsDialog match={match} env={env} onEdit={() => setDialog({ ...dialog, editing: true })} /> : null}
        {dialog.kind === 'details' && dialog.editing ? (
          <EditDialog match={match} env={env} controller={controller} feederOf={feederOf}
            onCancel={() => setDialog({ ...dialog, editing: false })} />
        ) : null}
      </>
    );
  }
  return { open, node, viewer };
}
