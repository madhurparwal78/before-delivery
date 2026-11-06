import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import * as copy from '../../shared/copy.js';
import { COPY, FIELD_COPY } from '../../shared/copy.js';
import {
  ITEM_NAMES,
  type ItemKind,
  RECIPES,
  slotToCell,
} from '../../shared/domain.js';
import type {
  CharacterObject,
  FriendObject,
  InventoryObject,
  InviteObject,
  TradeObject,
} from '../../shared/types.js';
import { ApiFailure, freshKey, get, post } from '../api.js';
import { Dialog, FieldError, Status, useGrid } from '../ui.js';

/* Inventory and crafting. */

export function InventoryDialog({
  character,
  onClose,
  onChanged,
}: {
  character: CharacterObject;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [inventory, setInventory] = useState<InventoryObject | null>(null);
  const [carrying, setCarrying] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const grid = useGrid(6, 4, { x: 0, y: 0 });

  const reload = useCallback(async () => {
    setInventory(await get<InventoryObject>(`/api/characters/${character.id}/inventory`));
  }, [character.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const slots = inventory?.slots ?? [];
  const slotAt = (x: number, y: number): number => y * 6 + x + 1;

  const sendMove = async (from: number, to: number): Promise<void> => {
    try {
      const answer = await post<InventoryObject>(
        `/api/characters/${character.id}/inventory/moves`,
        { from, to },
      );
      setInventory(answer);
      const moved = slots[from - 1];
      setAnnouncement(
        copy.movedItem(moved?.kind === null || moved === undefined ? '' : ITEM_NAMES[moved.kind], slotToCell(to)),
      );
      onChanged();
    } catch (error) {
      if (error instanceof ApiFailure) {
        setAnnouncement(error.code === 'inventory_full' ? COPY.inventoryFull : error.message);
      }
    }
    setCarrying(null);
  };

  const activate = (slot: number): void => {
    const cell = slots[slot - 1];
    if (carrying === null) {
      if (cell === undefined || cell.kind === null) return;
      setCarrying(slot);
      setAnnouncement(copy.pickedUp(ITEM_NAMES[cell.kind], slotToCell(slot)));
      return;
    }
    void sendMove(carrying, slot);
  };

  return (
    <Dialog label="Inventory" onClose={onClose}>
      <h2>Inventory</h2>
      <div
        className="inventory-grid"
        role="grid"
        aria-label="Inventory"
        onKeyDown={(event) => {
          if (grid.onKeyDown(event)) {
            event.preventDefault();
            return;
          }
          const slot = slotAt(grid.cursor.x, grid.cursor.y);
          if (event.key === ' ') {
            event.preventDefault();
            activate(slot);
          } else if (event.key === 'Escape') {
            if (carrying !== null) {
              event.preventDefault();
              event.stopPropagation();
              setCarrying(null);
              setAnnouncement(COPY.moveCancelled);
            }
          }
        }}
      >
        {Array.from({ length: 24 }, (_, index) => {
          const x = index % 6;
          const y = Math.floor(index / 6);
          const slot = index + 1;
          const cell = slots[index];
          const name =
            cell === undefined || cell.kind === null
              ? `${slotToCell(slot)}, empty`
              : `${slotToCell(slot)}, ${ITEM_NAMES[cell.kind]}, ${cell.count}`;
          const isCursor = grid.cursor.x === x && grid.cursor.y === y;
          return (
            <div
              key={slot}
              role="gridcell"
              aria-label={name}
              tabIndex={isCursor ? 0 : -1}
              draggable={cell?.kind !== null}
              ref={(node) => grid.register(x, y, node)}
              className={`inventory-cell ${carrying === slot ? 'carrying' : ''}`}
              onClick={() => {
                grid.focusCell(x, y);
                activate(slot);
              }}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', String(slot));
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/plain'));
                if (Number.isInteger(from) && from >= 1) void sendMove(from, slot);
              }}
            >
              <span className="mono">{slotToCell(slot)}</span>
              <span>{cell?.kind === null || cell === undefined ? '' : ITEM_NAMES[cell.kind]}</span>
              <span className="mono">{cell?.kind === null || cell === undefined ? '' : cell.count}</span>
            </div>
          );
        })}
      </div>
      <div role="region" aria-label="Crafting">
        <h3>Crafting</h3>
        <div className="row">
          {RECIPES.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => {
                void post<{ inventory: InventoryObject; crafted: { kind: ItemKind } }>(
                  `/api/characters/${character.id}/crafts`,
                  { recipe: recipe.id },
                )
                  .then((answer) => {
                    setInventory(answer.inventory);
                    setAnnouncement(copy.crafted(ITEM_NAMES[answer.crafted.kind]));
                    onChanged();
                  })
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) {
                      setAnnouncement(
                        error.code === 'missing_ingredients'
                          ? copy.missingIngredients(recipe.name)
                          : error.code === 'inventory_full'
                            ? COPY.inventoryFull
                            : error.message,
                      );
                    }
                  });
              }}
            >
              {`Craft ${recipe.name}`}
            </button>
          ))}
        </div>
      </div>
      <Status name="Inventory announcements" text={announcement} />
    </Dialog>
  );
}

/* Offer a trade: a three-step form. */

const OFFER_STEPS = ['Partner', 'Your offer', 'Review'] as const;

export function OfferTradeDialog({
  slug,
  character,
  partners,
  onClose,
  onOpened,
}: {
  slug: string;
  character: CharacterObject;
  partners: readonly { id: string; name: string }[];
  onClose: () => void;
  onOpened: (trade: TradeObject) => void;
}): ReactNode {
  const [step, setStep] = useState(1);
  const [partnerId, setPartnerId] = useState('');
  const [coins, setCoins] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [inventory, setInventory] = useState<InventoryObject | null>(null);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void get<InventoryObject>(`/api/characters/${character.id}/inventory`).then(setInventory);
  }, [character.id]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const kinds = [
    ...new Set(
      (inventory?.slots ?? [])
        .filter((slot) => slot.kind !== null)
        .map((slot) => slot.kind as ItemKind),
    ),
  ];
  const availableOf = (kind: ItemKind): number =>
    (inventory?.slots ?? [])
      .filter((slot) => slot.kind === kind)
      .reduce((sum, slot) => sum + slot.count - slot.held, 0);

  const partner = partners.find((entry) => entry.id === partnerId) ?? null;

  return (
    <Dialog label="Offer a trade" onClose={onClose}>
      <h2 tabIndex={-1} ref={heading}>
        {`Step ${step} of 3: ${OFFER_STEPS[step - 1]}`}
      </h2>
      {step === 1 ? (
        <div>
          <label htmlFor="trade-partner">Partner</label>
          <select
            id="trade-partner"
            aria-label="Partner"
            value={partnerId}
            onChange={(event) => setPartnerId(event.target.value)}
          >
            <option value="">Choose a player</option>
            {partners.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="stack">
          <div>
            <label htmlFor="trade-coins">Coins to offer</label>
            <input
              id="trade-coins"
              type="number"
              aria-label="Coins to offer"
              value={coins}
              onChange={(event) => setCoins(Number(event.target.value))}
            />
          </div>
          {kinds.map((kind) => (
            <div key={kind}>
              <label htmlFor={`offer-${kind}`}>{`${ITEM_NAMES[kind]} to offer`}</label>
              <input
                id={`offer-${kind}`}
                type="number"
                aria-label={`${ITEM_NAMES[kind]} to offer`}
                value={counts[kind] ?? 0}
                onChange={(event) =>
                  setCounts((current) => ({ ...current, [kind]: Number(event.target.value) }))
                }
              />
            </div>
          ))}
        </div>
      ) : null}
      {step === 3 ? (
        <ul aria-label="Review">
          <li>{`Partner: ${partner?.name ?? ''}`}</li>
          <li className="coins mono">{`Coins: ${coins}`}</li>
          {kinds
            .filter((kind) => (counts[kind] ?? 0) > 0)
            .map((kind) => (
              <li key={kind}>{`${ITEM_NAMES[kind]}: ${counts[kind]}`}</li>
            ))}
        </ul>
      ) : null}
      <FieldError id="offer-error" message={error} />
      <div className="steps">
        {step > 1 ? (
          <button type="button" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : null}
        {step < 3 ? (
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (step === 1 && partnerId === '') {
                setError(FIELD_COPY.partnerRequired);
                return;
              }
              if (step === 2) {
                if (coins < 0 || coins > character.available) {
                  setError(copy.coinsToOfferRange(character.available));
                  return;
                }
                for (const kind of kinds) {
                  const count = counts[kind] ?? 0;
                  if (count < 0 || count > availableOf(kind)) {
                    setError(copy.coinsToOfferRange(availableOf(kind)));
                    return;
                  }
                }
              }
              setError('');
              setStep(step + 1);
            }}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => {
              void post<TradeObject>(`/api/servers/${slug}/trades`, {
                character_id: character.id,
                partner_id: partnerId,
                coins,
                items: kinds
                  .filter((kind) => (counts[kind] ?? 0) > 0)
                  .map((kind) => ({ kind, count: counts[kind] })),
              })
                .then(onOpened)
                .catch((failure: unknown) => {
                  if (!(failure instanceof ApiFailure)) return;
                  if (failure.code === 'too_far') {
                    setError(copy.tradeTooFar(partner?.name ?? ''));
                  } else if (failure.code === 'trade_open') {
                    setError(failure.message);
                  } else {
                    setError(Object.values(failure.fields).join(' ') || failure.message);
                  }
                });
            }}
          >
            Open trade
          </button>
        )}
      </div>
    </Dialog>
  );
}

/* The trade window, with offers held in escrow. */

export function TradeDialog({
  trade,
  character,
  partnerName,
  onClose,
  onChanged,
}: {
  trade: TradeObject;
  character: CharacterObject;
  partnerName: string;
  onClose: () => void;
  onChanged: (trade: TradeObject) => void;
}): ReactNode {
  const mine = trade.sides.find((side) => side.character_id === character.id) ?? trade.sides[0];
  const theirs = trade.sides.find((side) => side.character_id !== character.id) ?? trade.sides[1];
  const [coins, setCoins] = useState(mine.coins);
  const [status, setStatus] = useState(copy.tradeOpened(partnerName));
  const version = useRef(trade.version);
  const previousVersion = useRef(trade.version);

  useEffect(() => {
    version.current = trade.version;
    if (trade.version !== previousVersion.current) {
      previousVersion.current = trade.version;
      setCoins(mine.coins);
      setStatus(COPY.tradeChanged);
    }
    if (trade.state === 'completed') setStatus(COPY.tradeComplete);
    if (trade.state === 'cancelled') setStatus(COPY.tradeCancelled);
    if (theirs.accepted && !mine.accepted) setStatus(copy.partnerAccepted(partnerName));
    // Each push replaces the status with what the newest state says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade]);

  const sideView = (
    side: TradeObject['sides'][number],
    label: string,
  ): ReactNode => (
    <div role="region" aria-label={label} className="card">
      <h3 className="card-title">{label}</h3>
      <p className="coins mono">{`${side.coins} coins`}</p>
      <ul>
        {side.items.map((item) => (
          <li key={item.kind}>{`${ITEM_NAMES[item.kind]}: ${item.count}`}</li>
        ))}
      </ul>
      <p className="status-word">{side.accepted ? 'ACCEPTED' : 'NOT ACCEPTED'}</p>
    </div>
  );

  return (
    <Dialog label={`Trade with ${partnerName}`} onClose={onClose}>
      <h2>{`Trade with ${partnerName}`}</h2>
      {sideView(mine, 'Your offer')}
      {sideView(theirs, `${partnerName}'s offer`)}
      <div>
        <label htmlFor="trade-window-coins">Coins to offer</label>
        <input
          id="trade-window-coins"
          type="number"
          aria-label="Coins to offer"
          value={coins}
          onChange={(event) => setCoins(Number(event.target.value))}
        />
      </div>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void post<TradeObject>(`/api/trades/${trade.id}/offer`, {
              character_id: character.id,
              version: version.current,
              coins,
              items: mine.items,
            })
              .then((answer) => {
                onChanged(answer);
                setStatus(COPY.offerUpdated);
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setStatus(error.code === 'trade_changed' ? COPY.tradeChanged : error.message);
                }
              });
          }}
        >
          Update offer
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void post<TradeObject>(`/api/trades/${trade.id}/accept`, {
              character_id: character.id,
              version: version.current,
            })
              .then((answer) => {
                onChanged(answer);
                setStatus(
                  answer.state === 'completed'
                    ? COPY.tradeComplete
                    : copy.youAccepted(partnerName),
                );
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  setStatus(
                    error.code === 'trade_changed'
                      ? COPY.tradeChanged
                      : error.code === 'inventory_full'
                        ? COPY.tradeInventoryFull
                        : error.message,
                  );
                }
              });
          }}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => {
            void post<TradeObject>(`/api/trades/${trade.id}/cancel`, {
              character_id: character.id,
            })
              .then((answer) => {
                onChanged(answer);
                setStatus(COPY.tradeCancelled);
              })
              .catch(() => undefined);
          }}
        >
          Cancel trade
        </button>
      </div>
      <Status name="Trade status" text={status} />
    </Dialog>
  );
}

/* Friends, with live presence and invites. */

export function FriendsDialog({ slug, onClose }: { slug: string; onClose: () => void }): ReactNode {
  const [friends, setFriends] = useState<FriendObject[]>([]);
  const [invites, setInvites] = useState<InviteObject[]>([]);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setFriends((await get<{ friends: FriendObject[] }>(`/api/servers/${slug}/friends`)).friends);
    setInvites((await get<{ invites: InviteObject[] }>(`/api/servers/${slug}/invites`)).invites);
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <Dialog label="Friends" onClose={onClose}>
      <h2>Friends</h2>
      <ul aria-label="Friends">
        {friends.map((friend) => (
          <li key={friend.handle}>
            {`${friend.display_name} (${friend.handle}): `}
            <span className="status-word">{friend.online ? 'ONLINE' : 'OFFLINE'}</span>
          </li>
        ))}
      </ul>
      <div>
        <label htmlFor="friend-email">Friend&apos;s email</label>
        <input
          id="friend-email"
          type="text"
          aria-label="Friend's email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <FieldError id="friend-email-error" message={error} />
      </div>
      <button
        type="button"
        className="primary"
        onClick={() => {
          setError('');
          const key = freshKey();
          void post<{ invite: InviteObject }>(
            `/api/servers/${slug}/invites`,
            { email },
            { idempotencyKey: key },
          )
            .then(async (answer) => {
              setStatus(
                answer.invite.mail === 'sent' ? copy.inviteSent(answer.invite.email) : COPY.inviteHeld,
              );
              setEmail('');
              await reload();
            })
            .catch((failure: unknown) => {
              if (!(failure instanceof ApiFailure)) return;
              if (failure.code === 'already_member') {
                setStatus(copy.inviteAlreadyMember(email));
              } else if (failure.fields.email !== undefined) {
                setError(failure.fields.email);
                setStatus(failure.fields.email);
              } else {
                setStatus(failure.message);
              }
            });
        }}
      >
        Send invite
      </button>
      <ul aria-label="Invites">
        {invites.map((invite) => (
          <li key={invite.id}>
            {`${invite.email}: `}
            <span className="status-word">{inviteWord(invite)}</span>
          </li>
        ))}
      </ul>
      <Status name="Invite status" text={status} />
    </Dialog>
  );
}

const inviteWord = (invite: InviteObject): string => {
  if (invite.state === 'used') return 'USED';
  if (invite.state === 'expired') return 'EXPIRED';
  if (invite.state === 'superseded') return 'SUPERSEDED';
  return invite.mail === 'sent' ? 'SENT' : 'HELD';
};
