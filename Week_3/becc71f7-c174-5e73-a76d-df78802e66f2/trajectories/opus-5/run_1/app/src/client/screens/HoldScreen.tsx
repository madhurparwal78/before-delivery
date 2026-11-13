import { useRef, useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { useArrivalFocus } from '../lib/landing.js';
import type { Hold, Session } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { formatDateTime } from '../../shared/brussels.js';
import { Overlay } from '../components/Overlay.js';
import { ActionButton, DialogActions } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

export function HoldScreen({ session, holdId }: { session: Session; holdId: string }) {
  const hold = usePolling(() => get<{ hold: Hold }>(`/api/holds/${holdId}`), holdId);
  const dialog = useOverlay();
  const heading = useRef<HTMLHeadingElement>(null);
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);
  useArrivalFocus(heading, hold.data !== null);

  if (hold.failure?.status === 404) return <NotFoundScreen />;
  const found = hold.data?.hold;

  const release = async (): Promise<void> => {
    setPending(true);
    try {
      await post(`/api/holds/${holdId}/release`);
      setProblems(noProblems);
      dialog.close();
      await hold.reload();
      heading.current?.focus();
      announce(copy.holdReleased);
    } catch (error) {
      if (error instanceof ApiError) {
        setProblems(problemsOf({}, error.failure.message));
        announce(error.failure.message);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <StaffShell session={session}>
      {found === undefined ? (
        <p class="screen__loading">Reading this hold…</p>
      ) : (
        <>
          <h1 ref={heading} class="heading heading--1 tabular" tabIndex={-1}>
            {`Hold ${found.tagCode ?? ''}`}
          </h1>
          {dialog.mounted ? null : (
            <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
          )}
          <dl class="facts">
            <dt>Shopper</dt>
            <dd>{found.shopperName ?? ''}</dd>
            <dt>Email</dt>
            <dd>{found.shopperEmail ?? ''}</dd>
            <dt>Started</dt>
            <dd class="tabular">{formatDateTime(Date.parse(found.startsAt))}</dd>
            <dt>Ends</dt>
            <dd class="tabular">{formatDateTime(Date.parse(found.endsAt))}</dd>
          </dl>
          {found.status === 'active' ? null : <p class="state-note">{copy.holdEnded}</p>}
          <Link href={`/staff/pieces/${found.pieceId}`} class="standalone-link">
            Open this piece
          </Link>

          <BottomBar>
            <button
              type="button"
              class="button button--primary"
              ref={dialog.openerRef}
              onClick={() => dialog.open()}
            >
              Release
            </button>
          </BottomBar>

          {dialog.mounted ? (
            <Overlay state={dialog} name="Release hold">
              <h2 class="dialog__heading">Release hold</h2>
              <ProblemsSummary problems={problems} controlIds={{}} labels={{}} />
              <DialogActions>
                <ActionButton
                  label="Release hold"
                  pending={pending}
                  onPress={() => void release()}
                />
                <button type="button" class="button button--quiet" onClick={() => dialog.close()}>
                  Keep hold
                </button>
              </DialogActions>
            </Overlay>
          ) : null}
        </>
      )}
    </StaffShell>
  );
}
