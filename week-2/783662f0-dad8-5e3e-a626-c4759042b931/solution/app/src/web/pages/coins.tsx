import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { COPY, FIELD_COPY, coinsAdded, coinsRefunded } from '../../shared/copy.js';
import { PACKS, PACK_IDS, type PackId } from '../../shared/domain.js';
import type { CharacterObject, PurchaseObject, ServerObject } from '../../shared/types.js';
import { ApiFailure, freshKey, get, postFull } from '../api.js';
import { Link, useRouter } from '../router.js';
import { FieldError, Status } from '../ui.js';

const STEPS = ['Pack', 'Review', 'Pay'] as const;

export function CoinsPage({ slug }: { slug: string }): ReactNode {
  const { go } = useRouter();
  const [step, setStep] = useState(1);
  const [pack, setPack] = useState<PackId | ''>('');
  const [characterId, setCharacterId] = useState('');
  const [characters, setCharacters] = useState<CharacterObject[]>([]);
  const [purchases, setPurchases] = useState<PurchaseObject[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const key = useRef(freshKey());

  const reload = useCallback(async () => {
    setCharacters(
      (await get<{ characters: CharacterObject[] }>(`/api/servers/${slug}/characters?mine=true`))
        .characters,
    );
    setPurchases(
      (await get<{ purchases: PurchaseObject[] }>(`/api/servers/${slug}/coin-purchases`)).purchases,
    );
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const chosenPack = pack === '' ? null : PACKS[pack];
  const chosenCharacter = characters.find((character) => character.id === characterId) ?? null;

  const next = (): void => {
    if (step === 1) {
      const found: Record<string, string> = {};
      if (pack === '') found.pack = FIELD_COPY.coinPackRequired;
      if (characterId === '') found.character_id = FIELD_COPY.coinCharacterRequired;
      if (Object.keys(found).length > 0) {
        setFields(found);
        setStatus(Object.values(found).join(' '));
        return;
      }
    }
    setFields({});
    setStatus('');
    setStep(step + 1);
  };

  return (
    <div className="page split">
      <div className="card">
        <h1 tabIndex={-1} ref={heading}>
          {`Step ${step} of 3: ${STEPS[step - 1]}`}
        </h1>
        {step === 1 ? (
          <>
            <fieldset role="radiogroup" aria-label="Coin pack">
              <legend>Coin pack</legend>
              {PACK_IDS.map((id) => (
                <label className="radio-row" key={id}>
                  <input
                    type="radio"
                    name="pack"
                    checked={pack === id}
                    aria-label={`${PACKS[id].name}, ${PACKS[id].coins} coins, ${PACKS[id].price} USD`}
                    onChange={() => setPack(id)}
                  />
                  <span>{`${PACKS[id].name}, ${PACKS[id].coins} coins, ${PACKS[id].price} USD`}</span>
                </label>
              ))}
              <FieldError id="pack-error" message={fields.pack ?? ''} />
            </fieldset>
            <fieldset role="radiogroup" aria-label="Character">
              <legend>Character</legend>
              {characters.map((character) => (
                <label className="radio-row" key={character.id}>
                  <input
                    type="radio"
                    name="coin-character"
                    checked={characterId === character.id}
                    aria-label={character.name}
                    onChange={() => setCharacterId(character.id)}
                  />
                  <span>{character.name}</span>
                </label>
              ))}
              <FieldError id="character-error" message={fields.character_id ?? ''} />
            </fieldset>
          </>
        ) : null}
        {step === 2 ? (
          <ul aria-label="Review">
            <li>{`Pack: ${chosenPack?.name ?? ''}`}</li>
            <li className="coins mono">{`Coins: ${chosenPack?.coins ?? 0}`}</li>
            <li>{`Character: ${chosenCharacter?.name ?? ''}`}</li>
            <li className="amount">{`${chosenPack?.price ?? ''} USD`}</li>
          </ul>
        ) : null}
        <div className="steps">
          {step > 1 ? (
            <button type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button type="button" className="primary" onClick={next}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                if (busy || pack === '') return;
                setBusy(true);
                void postFull<PurchaseObject>(
                  `/api/servers/${slug}/coin-purchases`,
                  { character_id: characterId, pack },
                  { idempotencyKey: key.current },
                )
                  .then((sent) => {
                    go(`/s/${slug}/coins/${sent.body.id}`, { replace: true });
                  })
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) setStatus(purchaseRefusal(error));
                  })
                  .finally(() => setBusy(false));
              }}
            >
              {`Pay ${chosenPack?.price ?? ''} USD`}
            </button>
          )}
        </div>
        <Status name="Purchase status" text={status} />
      </div>
      <div className="card">
        <h2 className="card-title">Your purchases</h2>
        <ul aria-label="Purchases">
          {purchases.map((purchase) => (
            <li key={purchase.id}>
              <Link to={`/s/${slug}/coins/${purchase.id}`}>
                {`${PACKS[purchase.pack].name}, ${purchase.coins} coins`}
              </Link>{' '}
              <span className="status-word">{stateWord(purchase.state)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const stateWord = (state: PurchaseObject['state']): string =>
  state === 'paid' ? 'PAID' : state === 'refunded' ? 'REFUNDED' : 'PENDING';

const purchaseRefusal = (error: ApiFailure): string => {
  switch (error.code) {
    case 'daily_limit_reached':
      return COPY.dailyLimitReached;
    case 'billing_unavailable':
      return COPY.coinsOutage;
    case 'coins_spent':
      return COPY.coinsSpent;
    case 'already_refunded':
      return COPY.alreadyRefunded;
    default:
      return Object.values(error.fields).join(' ') || error.message;
  }
};

export function PurchasePage({
  purchaseId,
  server,
}: {
  purchaseId: string;
  server: ServerObject | null;
}): ReactNode {
  const [purchase, setPurchase] = useState<PurchaseObject | null>(null);
  const [characterName, setCharacterName] = useState('');
  const [message, setMessage] = useState('');
  const pinned = useRef(false);

  const reload = useCallback(async () => {
    const next = await get<PurchaseObject>(`/api/coin-purchases/${purchaseId}`);
    setPurchase(next);
    const character = await get<CharacterObject>(`/api/characters/${next.character_id}`);
    setCharacterName(character.name);
    if (!pinned.current) {
      setMessage(
        next.state === 'paid'
          ? coinsAdded(next.coins, character.name)
          : next.state === 'refunded'
            ? coinsRefunded(next.coins, character.name)
            : COPY.billingPaymentSent,
      );
    }
  }, [purchaseId]);

  useEffect(() => {
    pinned.current = false;
    void reload();
  }, [reload]);

  useEffect(() => {
    if (purchase === null || purchase.state !== 'pending') return;
    const timer = setInterval(() => {
      void reload();
    }, 3000);
    return () => clearInterval(timer);
  }, [purchase, reload]);

  return (
    <div className="page">
      <h1>Purchase</h1>
      <div role="status" aria-label="Purchase status" aria-live="polite" className="card">
        {purchase !== null ? (
          <>
            <p className="status-word">{stateWord(purchase.state)}</p>
            <p>{`${PACKS[purchase.pack].name}, ${purchase.coins} coins`}</p>
            <p className="amount">{`${purchase.price} USD`}</p>
            <p>{message}</p>
            {purchase.receipt === 'held' && purchase.state !== 'pending' ? (
              <p>{COPY.receiptHeld}</p>
            ) : null}
          </>
        ) : null}
      </div>
      {server !== null && server.role === 'owner' ? (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            void postFull<PurchaseObject>(`/api/coin-purchases/${purchaseId}/refund`, {})
              .then((sent) => {
                setPurchase(sent.body);
                setMessage(coinsRefunded(sent.body.coins, characterName));
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) setMessage(purchaseRefusal(error));
              });
          }}
        >
          Refund
        </button>
      ) : null}
    </div>
  );
}
