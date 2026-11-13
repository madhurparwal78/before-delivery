import { useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { useOverlay } from '../lib/overlay.js';
import { announce } from '../lib/announce.js';
import { dropDialog, holdDialog } from '../lib/resume.js';
import type { Hold, PublicPiece } from '../lib/types.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { formatTime } from '../../shared/brussels.js';
import { conditionLabel, sizeLabel } from '../../shared/options.js';
import { isValidEmailish, isValidNameish } from '../lib/validate.js';
import { Garment } from '../components/Garment.js';
import { Overlay } from '../components/Overlay.js';
import { Stations } from '../components/Stations.js';
import { Tag } from '../components/Tag.js';
import { ActionButton, DialogActions, Field } from '../components/form.js';
import { ProblemsSummary, noProblems, problemsOf, type Problems } from '../components/Problems.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';
import { GoneScreen } from './NotFoundScreen.js';

const DIALOG = 'hold-this-piece';

export function PublicPieceScreen({ pieceId }: { pieceId: string }) {
  const piece = usePolling(
    () => get<{ piece: PublicPiece }>(`/api/public/pieces/${pieceId}`),
    pieceId,
  );
  const dialog = useOverlay();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [problems, setProblems] = useState<Problems>(noProblems);
  const [pending, setPending] = useState(false);

  if (piece.failure?.code === 'piece_gone') return <GoneScreen heading={copy.pieceGone} />;


  const found = piece.data?.piece;

  const placeHold = async (): Promise<void> => {
    const fields: Record<string, string> = {};
    if (!isValidNameish(name)) fields['name'] = fieldCopy.name;
    if (!isValidEmailish(email)) fields['email'] = fieldCopy.email;
    if (Object.keys(fields).length > 0) {
      setProblems(problemsOf(fields));
      return;
    }
    setPending(true);
    try {
      const result = await post<{ hold: Hold }>(`/api/pieces/${pieceId}/holds`, {
        name: name.trim(),
        email: email.trim(),
      });
      announce(copy.holdPlacedPublic(formatTime(Date.parse(result.hold.endsAt))));
      setProblems(noProblems);
      setName('');
      setEmail('');
      dropDialog(DIALOG);
      dialog.close();
      await piece.reload();
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
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main piece-page">
        {found === undefined ? (
          <p class="screen__loading">Reading the rail…</p>
        ) : (
          <>
            <h1 class="heading heading--1">{found.description}</h1>
            <div class="piece-page__layout">
              <div class="piece-page__photos">
                {found.photoUrls.length === 0 ? (
                  <Garment category={found.category} seed={found.tagCode} />
                ) : (
                  found.photoUrls.map((url) => <img key={url} src={url} alt="" />)
                )}
              </div>
              <div class="piece-page__facts">
                <Tag
                  priceCents={found.currentPriceCents}
                  previousPriceCents={found.previousPriceCents}
                  size="page"
                />
                <dl class="facts">
                  <dt>Brand</dt>
                  <dd>{found.brand}</dd>
                  <dt>Size</dt>
                  <dd>{sizeLabel(found.size)}</dd>
                  <dt>Condition</dt>
                  <dd>{conditionLabel(found.condition)}</dd>
                </dl>
                {found.status === 'sold' ? <p class="state-note">Sold</p> : null}
                {found.status === 'on_hold' ? <p class="state-note">On hold</p> : null}
              </div>
            </div>

            <Stations stations={found.stations} />

            <BottomBar>
              <button
                type="button"
                class="button button--primary"
                ref={dialog.openerRef}
                onClick={() => {
                  holdDialog(DIALOG, { name, email });
                  dialog.open();
                }}
              >
                Hold this piece
              </button>
            </BottomBar>

            {dialog.mounted ? (
              <Overlay state={dialog} name="Hold this piece">
                <h2 class="dialog__heading">Hold this piece</h2>
                <ProblemsSummary
                  problems={problems}
                  controlIds={{ name: 'hold-name', email: 'hold-email' }}
                  labels={{}}
                />
                <Field
                  id="hold-name"
                  label="Your name"
                  value={name}
                  onInput={(value) => {
                    setName(value);
                    holdDialog(DIALOG, { name: value, email });
                  }}
                  problem={problems.fields['name']}
                />
                <Field
                  id="hold-email"
                  label="Email"
                  type="email"
                  value={email}
                  onInput={(value) => {
                    setEmail(value);
                    holdDialog(DIALOG, { name, email: value });
                  }}
                  problem={problems.fields['email']}
                />
                <DialogActions>
                  <ActionButton
                    label="Hold piece"
                    pending={pending}
                    onPress={() => void placeHold()}
                  />
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
          </>
        )}
      </main>
    </div>
  );
}
