import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { formatNumber } from '../../shared/domain';
import { api, ApiFailure, type CashPack, type ShopItem } from '../api';
import { refreshMe, type Store } from '../store';
import { Figures, Modal, restoreFocus, Screen } from '../ui';

const TABS = ['Cues', 'Cash cues', 'Cloths', 'Cash packs'] as const;
type Tab = (typeof TABS)[number];

const STAT_MAX = { aim: 25, power: 10, spin: 15, time: 3 };
const CURRENCY = { coins: 'Coins', cash: 'Cash' };

interface Catalogue {
  items: ShopItem[];
  packs: CashPack[];
}

function newKey(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function itemPrice(item: ShopItem): string {
  return `${formatNumber(item.price)} ${CURRENCY[item.currency]}`;
}

function itemState(item: ShopItem): string {
  if (item.equipped) return 'Equipped';
  return item.owned ? 'Owned' : `Level ${item.minLevel}`;
}

function StatRows({ item }: { item: ShopItem }): ReactNode {
  const rows = [
    [`Aim +${item.aim}%`, item.aim / STAT_MAX.aim],
    [`Power +${item.power}%`, item.power / STAT_MAX.power],
    [`Spin +${item.spin}%`, item.spin / STAT_MAX.spin],
    [`Time +${item.time} s`, item.time / STAT_MAX.time],
  ] as const;
  return (
    <div className="stat-rows">
      {rows.map(([text, share]) => (
        <div className="stat-row" key={text}>
          <span>{text}</span>
          <div className="stat-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function ItemDialog({ item, equippedCue, blocked, onBuy, onEquip, onClose, busy }: {
  item: ShopItem; equippedCue: ShopItem | undefined; blocked: boolean; onBuy: () => void; onEquip: () => void; onClose: () => void; busy: boolean;
}): ReactNode {
  const equip = useRef<HTMLButtonElement>(null);
  const wasOwned = useRef(item.owned);
  useLayoutEffect(() => {
    if (item.owned && !wasOwned.current) equip.current?.focus();
    wasOwned.current = item.owned;
  }, [item.owned]);
  return (
    <Modal label={item.name} onEscape={onClose}>
      <h2>{item.name}</h2>
      {(item.owned || item.equipped) && <p className="caption">{item.equipped ? 'Equipped' : 'Owned'}</p>}
      {item.kind === 'cue' && equippedCue !== undefined && (
        <section className="compare" role="region" aria-label="Compare">
          <StatRows item={item} />
          <p className="label">Equipped: {equippedCue.name}</p>
          <StatRows item={equippedCue} />
        </section>
      )}
      {item.owned
        ? <button ref={equip} type="button" className="primary" disabled={item.equipped} onClick={onEquip}>Equip</button>
        : <button type="button" className="primary" disabled={busy || blocked} onClick={onBuy}>Buy for {formatNumber(item.price)} {CURRENCY[item.currency]}</button>}
      <button type="button" onClick={onClose}>Close</button>
    </Modal>
  );
}

export function Shop({ store }: { store: Store }): ReactNode {
  const { me } = store;
  const [tab, setTab] = useState<Tab>('Cues');
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [notice, setNotice] = useState('');
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [pack, setPack] = useState<CashPack | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const paymentKey = useRef('');
  const tabs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const load = useCallback(async (): Promise<void> => {
    setCatalogue(await api<Catalogue>('GET', '/api/shop'));
  }, []);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const blockedSentence = (item: ShopItem): string | null => {
    if (me === null || item.owned) return null;
    if (me.level < item.minLevel) return `Reach level ${item.minLevel} to buy this.`;
    const held = item.currency === 'coins' ? me.coins : me.cash;
    return held < item.price ? `You need ${formatNumber(item.price - held)} more ${CURRENCY[item.currency]}.` : null;
  };

  const eligibilityNotice = (): string => {
    if (me?.minor) return 'Players under 18 cannot buy Cash.';
    return me?.emailVerified ? '' : 'Verify your email to buy Cash.';
  };
  const activate = (next: Tab): void => {
    setTab(next);
    setNotice(next === 'Cash packs' ? eligibilityNotice() : '');
  };
  const onTabKey = (event: KeyboardEvent): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    activate(next);
    tabs.current[next]?.focus();
  };

  const showItem = (item: ShopItem, from: HTMLElement): void => {
    opener.current = from;
    setOpenItem(item.id);
    setNotice(blockedSentence(item) ?? '');
  };
  const closeItem = (): void => {
    setOpenItem(null);
    setNotice('');
    restoreFocus(opener.current);
  };
  const buy = async (item: ShopItem): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', `/api/shop/items/${item.id}/buy`);
      await Promise.all([load(), refreshMe()]);
      setNotice(`Bought ${item.name}.`);
    } catch (error) {
      setNotice((error as ApiFailure).message);
    } finally {
      setBusy(false);
    }
  };
  const equip = async (item: ShopItem): Promise<void> => {
    setBusy(true);
    try {
      await api('POST', `/api/shop/items/${item.id}/equip`);
      await Promise.all([load(), refreshMe()]);
      setNotice(`Equipped ${item.name}.`);
    } catch (error) {
      setNotice((error as ApiFailure).message);
    } finally {
      setBusy(false);
    }
  };

  const openPack = (chosen: CashPack, from: HTMLElement): void => {
    opener.current = from;
    paymentKey.current = newKey();
    setPack(chosen);
    setNotice('');
  };
  const closePack = (): void => {
    setPack(null);
    restoreFocus(opener.current);
  };
  const pay = async (chosen: CashPack): Promise<void> => {
    setConfirming(true);
    setNotice('Confirming');
    try {
      const result = await api<{ receipt: 'sent' | 'delayed' }>('POST', `/api/shop/cash-packs/${chosen.id}/purchase`, undefined, { 'Idempotency-Key': paymentKey.current });
      await refreshMe();
      const cash = formatNumber(chosen.cash);
      setNotice(result.receipt === 'sent' ? `Cash added: ${cash} Cash. Receipt sent to ${me?.email}.` : `Cash added: ${cash} Cash. Receipt delayed. Your Cash is safe.`);
    } catch (error) {
      setNotice((error as ApiFailure).message);
    } finally {
      setConfirming(false);
      closePack();
    }
  };
  const resend = async (): Promise<void> => {
    try {
      await api('POST', '/api/auth/resend-verification');
      setNotice(`Verification email sent to ${me?.email}.`);
    } catch (error) {
      setNotice((error as ApiFailure).message);
    }
  };

  const items = (catalogue?.items ?? []).filter((item) => {
    if (tab === 'Cues') return item.kind === 'cue' && item.currency === 'coins';
    if (tab === 'Cash cues') return item.kind === 'cue' && item.currency === 'cash';
    return item.kind === 'cloth';
  });
  const shown = catalogue?.items.find((item) => item.id === openItem);
  const equippedCue = catalogue?.items.find((item) => item.kind === 'cue' && item.equipped);
  const canBuyCash = me !== null && !me.minor && me.emailVerified;
  const canResend = me !== null && !me.minor && !me.emailVerified;
  const dialogOpen = shown !== undefined || pack !== null;

  return (
    <Screen store={store} title="Shop">
      <p role="status" aria-label="Shop notice" className={`notice shop-notice${dialogOpen ? ' floating' : ''}`}>{notice}</p>
      <div className="tablist" role="tablist" aria-label="Shop sections" onKeyDown={onTabKey}>
        {TABS.map((name) => (
          <button
            key={name}
            ref={(element) => {
              tabs.current[name] = element;
            }}
            type="button"
            role="tab"
            aria-selected={tab === name}
            aria-controls="shop-panel"
            tabIndex={tab === name ? 0 : -1}
            onClick={() => activate(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div id="shop-panel" role="tabpanel" aria-label={tab}>
        {tab === 'Cash packs' ? (
          <div className="item-grid">
            {catalogue?.packs.map((item) => (
              <div className="pack-card" key={item.id}>
                <h3>{item.name}</h3>
                <p><span className="pack-figure"><Figures text={formatNumber(item.cash)} /></span> <span className="caption">Cash</span></p>
                <p className="item-price">${item.priceUsd}</p>
                {canBuyCash && <button type="button" className="primary" onClick={(event) => openPack(item, event.currentTarget)}>Buy {item.name}</button>}
              </div>
            ))}
            {canResend && <div><button type="button" onClick={() => void resend()}>Resend verification</button></div>}
          </div>
        ) : (
          <ul className="item-grid">
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className="item-card" aria-description={`${itemPrice(item)}, ${itemState(item)}`} onClick={(event) => showItem(item, event.currentTarget)}>
                  <span className="item-title">{item.name}</span>
                  <span className="item-price" aria-hidden="true"><Figures text={itemPrice(item)} /></span>
                  <span className="caption" aria-hidden="true">{itemState(item)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {shown !== undefined && (
        <ItemDialog
          item={shown}
          equippedCue={equippedCue}
          blocked={blockedSentence(shown) !== null}
          onBuy={() => void buy(shown)}
          onEquip={() => void equip(shown)}
          onClose={closeItem}
          busy={busy}
        />
      )}
      {pack !== null && (
        <Modal label="Buy Cash" onEscape={() => {
          if (!confirming) closePack();
        }}>
          <h2>{pack.name}</h2>
          <p><span className="pack-figure"><Figures text={formatNumber(pack.cash)} /></span> <span className="caption">Cash</span></p>
          <button type="button" className="primary" disabled={confirming} onClick={() => void pay(pack)}>Pay ${pack.priceUsd}</button>
          <button type="button" disabled={confirming} onClick={closePack}>Cancel</button>
        </Modal>
      )}
    </Screen>
  );
}
