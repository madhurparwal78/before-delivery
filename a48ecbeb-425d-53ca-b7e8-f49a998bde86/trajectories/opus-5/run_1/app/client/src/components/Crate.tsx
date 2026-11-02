import { useEffect, useRef, useState, type ReactElement } from 'react';
import { X } from 'lucide-react';
import { CRATE_SIZE, type FlavourSlug, flavourName, provinceName } from '../../../shared/catalogue.js';
import { shippingPhrase } from '../../../shared/quote.js';
import { useShop } from '../state/shop.js';
import { registerSlot } from '../state/flights.js';
import { useReducedMotion } from '../state/useReducedMotion.js';
import { canPalette } from './canArt.js';

function RollingCounter({ value }: { value: number }): ReactElement {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const frame = useRef(0);

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const from = shown;
    if (from === value) return;
    const startedAt = performance.now();
    const duration = 260;
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / duration);
      setShown(Math.round(from + (value - from) * progress));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
    // The roll runs from whatever is on screen to the new count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  return (
    <div className="crate__counter" role="group" aria-label="Cans in crate">
      <span className="mono crate__counter-value">
        {String(shown).padStart(2, '0')}
        <span className="crate__counter-total">/{CRATE_SIZE}</span>
      </span>
    </div>
  );
}

function FreeShippingMeter(): ReactElement {
  const { quote, cart } = useShop();
  const reduced = useReducedMotion();
  const percent = quote?.free_shipping.progress_percent ?? 0;
  const phrase =
    quote === null
      ? ''
      : shippingPhrase(quote, provinceName(cart?.province ?? quote.province));

  return (
    <div className="meter">
      <div
        role="meter"
        aria-label="Free shipping"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={phrase}
        className="meter__track"
      >
        <span
          className="meter__fill"
          style={{
            width: `${percent}%`,
            transition: reduced ? 'none' : 'width 0.38s cubic-bezier(0.16,0.84,0.28,1)',
          }}
        />
      </div>
      <p className="meter__phrase mono">{phrase}</p>
    </div>
  );
}

export function CrateSlots(): ReactElement {
  const { cart, pendingSlots, removeCan } = useShop();
  const reduced = useReducedMotion();
  const listRef = useRef<HTMLUListElement | null>(null);
  const [justFilled, setJustFilled] = useState<Record<number, boolean>>({});
  const previous = useRef<Array<string | null>>([]);

  useEffect(() => {
    const slots = cart?.slots ?? [];
    const filled: Record<number, boolean> = {};
    slots.forEach((slot, index) => {
      if (slot !== null && previous.current[index] === null) filled[index] = true;
    });
    previous.current = slots.map((slot) => slot?.flavour ?? null);
    if (Object.keys(filled).length === 0) return;
    setJustFilled(filled);
    const timer = window.setTimeout(() => setJustFilled({}), 260);
    return () => window.clearTimeout(timer);
  }, [cart]);

  const moveFocusAfterRemoval = (slotIndex: number) => {
    const list = listRef.current;
    if (list === null) return;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('button[data-slot]')];
    const next = buttons.find((button) => Number(button.dataset.slot) > slotIndex);
    const previousButton = [...buttons]
      .reverse()
      .find((button) => Number(button.dataset.slot) < slotIndex);
    const target = next ?? previousButton;
    if (target !== undefined) {
      target.focus();
      return;
    }
    document.querySelector<HTMLButtonElement>('button[data-add-flavour]')?.focus();
  };

  return (
    <ul className="crate__slots" aria-label="Crate slots" ref={listRef}>
      {Array.from({ length: CRATE_SIZE }, (_, index) => {
        const slot = cart?.slots[index] ?? null;
        const pending = pendingSlots[index];
        const flavour: FlavourSlug | undefined = slot?.flavour ?? pending;
        const name =
          flavour === undefined
            ? `Slot ${index + 1}: empty`
            : slot === null
              ? `Slot ${index + 1}: ${flavourName(flavour)}, pending`
              : `Slot ${index + 1}: ${flavourName(flavour)}`;
        const palette = flavour === undefined ? null : canPalette(flavour);

        return (
          <li
            key={index}
            aria-label={name}
            className={[
              'slot',
              slot !== null ? 'slot--filled' : '',
              slot === null && pending !== undefined ? 'slot--pending' : '',
              justFilled[index] === true && !reduced ? 'slot--settling' : '',
            ]
              .filter((part) => part !== '')
              .join(' ')}
            ref={(element) => registerSlot(index, element)}
            style={
              palette === null
                ? undefined
                : {
                    '--slot-colour': palette.base,
                    '--slot-band': palette.band ?? palette.base,
                  } as React.CSSProperties
            }
          >
            <span className="slot__can" aria-hidden="true" />
            {slot !== null ? (
              <button
                type="button"
                data-slot={index}
                className="slot__remove"
                aria-label={`Remove ${flavourName(slot.flavour)} from slot ${index + 1}`}
                onKeyDown={(event) => {
                  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
                  event.preventDefault();
                  moveFocusAfterRemoval(index);
                  void removeCan(index);
                }}
                onClick={() => {
                  moveFocusAfterRemoval(index);
                  void removeCan(index);
                }}
              >
                <X aria-hidden="true" size={13} strokeWidth={3} />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function CrateCounter(): ReactElement {
  const { cart } = useShop();
  return <RollingCounter value={cart?.count ?? 0} />;
}

export function CrateMeter(): ReactElement {
  return <FreeShippingMeter />;
}

export function CrateAnnouncements(): ReactElement {
  const { crateMessage } = useShop();
  return (
    <p role="status" aria-live="polite" aria-label="Crate updates" className="live-region">
      {crateMessage}
    </p>
  );
}
