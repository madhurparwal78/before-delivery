import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, get, put } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { announce } from '../lib/announce.js';
import type { PortalPage, PortalPiece } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { formatMonth } from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { CHOICES, pieceStatusLabel, type Choice } from '../../shared/options.js';
import { Stations } from '../components/Stations.js';
import { Tag } from '../components/Tag.js';
import { ActionButton } from '../components/form.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';
import { GoneScreen, NotFoundScreen } from './NotFoundScreen.js';

/**
 * The consignor's own page: only their own pieces and earnings, never a sale price, the
 * shop's commission or more than the IBAN's last four characters.
 */
export function PortalScreen({ token }: { token: string }) {
  const page = usePolling(() => get<PortalPage>(`/api/portal/${token}`), token);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [pending, setPending] = useState(false);
  const saveButton = useRef<HTMLButtonElement | null>(null);
  const keepFocus = useRef(false);

  useEffect(() => {
    if (pending || !keepFocus.current) return;
    keepFocus.current = false;
    saveButton.current?.focus();
  }, [pending]);

  if (page.failure?.code === 'page_ended') return <GoneScreen heading={copy.portalPageEnded} />;
  if (page.failure?.status === 404) return <NotFoundScreen />;

  const data = page.data;

  const save = async (): Promise<void> => {
    keepFocus.current = true;
    const entries = Object.entries(choices);
    if (entries.length === 0) {
      announce(copy.choicesSaved);
      saveButton.current?.focus();
      return;
    }
    setPending(true);
    let outcome: string = copy.choicesSaved;
    try {
      await put(`/api/portal/${token}/choices`, {
        choices: entries.map(([pieceId, choice]) => ({ pieceId, choice })),
      });
      setChoices({});
      await page.reload();
    } catch (error) {
      if (error instanceof ApiError) outcome = error.failure.message;
    }
    setPending(false);
    announce(outcome);
  };

  const chosen = (piece: PortalPiece): Choice | null => choices[piece.id] ?? piece.choice;

  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main portal">
        {data === null || data === undefined ? (
          <p class="screen__loading">Reading your pieces…</p>
        ) : (
          <>
            <h1 class="heading heading--1">{data.consignor.name}</h1>
            <p class="portal__account tabular">
              {data.consignor.ibanValid && data.consignor.ibanLast4 !== null
                ? copy.paidToAccount(data.consignor.ibanLast4)
                : copy.payoutHeldBack}
            </p>

            <section class="section">
              <h2 class="section__heading">Your pieces</h2>
              <ul class="portal__pieces" role="list">
                {data.pieces.map((piece) => (
                  <li key={piece.id} class="card portal-piece">
                    <p class="portal-piece__tag tabular">{piece.tagCode}</p>
                    <h3 class="portal-piece__description">{piece.description}</h3>
                    {piece.status === 'sold' ? (
                      <>
                        <p class="portal-piece__status">Sold</p>
                        <p class="price tabular">
                          {piece.shareCents === null ? '' : formatMoney(piece.shareCents)}
                        </p>
                      </>
                    ) : (
                      <>
                        {piece.currentPriceCents === null ? null : (
                          <Tag
                            priceCents={piece.currentPriceCents}
                            previousPriceCents={piece.previousPriceCents}
                          />
                        )}
                        <p class="portal-piece__status">{pieceStatusLabel(piece.status)}</p>
                        <Stations stations={piece.stations} />
                        {piece.choiceOpen ? (
                          <fieldset
                            class="radiogroup"
                            role="radiogroup"
                            aria-label={`${piece.tagCode}: at the end of its period`}
                          >
                            <legend class="radiogroup__legend">
                              {`${piece.tagCode}: at the end of its period`}
                            </legend>
                            {CHOICES.map((option) => (
                              <label key={option.value} class="radio">
                                <input
                                  type="radio"
                                  name={`choice-${piece.id}`}
                                  checked={chosen(piece) === option.value}
                                  onChange={() =>
                                    setChoices((current) => ({
                                      ...current,
                                      [piece.id]: option.value,
                                    }))
                                  }
                                />
                                <span class="radio__label">{option.label}</span>
                              </label>
                            ))}
                          </fieldset>
                        ) : null}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section class="section">
              <h2 class="section__heading">Earnings by month</h2>
              <table class="table" aria-label="Earnings by month">
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Your share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.earnings.map((row) => (
                    <tr key={row.month}>
                      <td>{formatMonth(row.month)}</td>
                      <td class="tabular">{formatMoney(row.shareCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <BottomBar>
              <ActionButton
                label="Save choices"
                pending={pending}
                onPress={() => void save()}
                buttonRef={(node) => {
                  saveButton.current = node;
                }}
              />
            </BottomBar>
          </>
        )}
      </main>
    </div>
  );
}
