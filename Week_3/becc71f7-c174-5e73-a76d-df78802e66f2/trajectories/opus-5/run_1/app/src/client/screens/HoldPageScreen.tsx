import { useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { announce } from '../lib/announce.js';
import type { HoldPage } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { formatDateTime } from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { sizeLabel } from '../../shared/options.js';
import { ActionButton } from '../components/form.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

/** Built for 375x812 touch first. Every instant and the countdown come from the server. */
export function HoldPageScreen({ token }: { token: string }) {
  const page = usePolling(() => get<{ hold: HoldPage }>(`/api/holds/by-token/${token}`), token);
  const [pending, setPending] = useState(false);

  if (page.failure?.status === 404) return <NotFoundScreen />;

  const hold = page.data?.hold;

  const letGo = async (): Promise<void> => {
    setPending(true);
    try {
      await post(`/api/holds/by-token/${token}/release`);
      announce(copy.holdReleased);
      await page.reload();
    } catch (error) {
      if (error instanceof ApiError) announce(error.failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main hold-page">
        {hold === undefined ? (
          <p class="screen__loading">Reading your hold…</p>
        ) : (
          <>
            <h1 class="heading heading--1">{hold.piece.description}</h1>
            <div class="hold-page__piece">
              {hold.piece.photoUrl === null ? null : <img src={hold.piece.photoUrl} alt="" />}
              <p class="tabular">{hold.piece.tagCode}</p>
              <p>
                {hold.piece.brand}
                <span aria-hidden="true"> · </span>
                {sizeLabel(hold.piece.size)}
              </p>
              <p class="price tabular">{formatMoney(hold.piece.currentPriceCents)}</p>
            </div>
            <p class="hold-page__until tabular">{`Held until ${formatDateTime(Date.parse(hold.endsAt))}`}</p>
            <p class="hold-page__left tabular">{`${Math.floor(hold.secondsLeft / 60)} minutes left`}</p>
            <p class="hold-page__address">{hold.shopAddress}</p>
            {hold.status === 'active' ? null : <p class="state-note">{copy.holdEnded}</p>}
            <BottomBar>
              <ActionButton
                label="Let the hold go"
                pending={pending}
                onPress={() => void letGo()}
              />
            </BottomBar>
          </>
        )}
      </main>
    </div>
  );
}
