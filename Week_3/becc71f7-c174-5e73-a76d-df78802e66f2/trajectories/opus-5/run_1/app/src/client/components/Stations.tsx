import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Station } from '../lib/types.js';
import { formatDateOnly, formatDateTime } from '../../shared/brussels.js';
import { formatMoney } from '../../shared/money.js';
import { useOverlay } from '../lib/overlay.js';
import { Overlay } from './Overlay.js';

interface StationsProps {
  stations: Station[];
}

/**
 * The four markdown stations: one keyboard composite with one Tab stop, focus landing on
 * the current station. Every state and instant comes from the server.
 */
export function Stations({ stations }: StationsProps) {
  const currentIndex = Math.max(
    0,
    stations.findIndex((station) => station.state === 'current'),
  );
  const [focusIndex, setFocusIndex] = useState(currentIndex);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const popover = useOverlay();

  const moveTo = (index: number): void => {
    const clamped = Math.min(stations.length - 1, Math.max(0, index));
    setFocusIndex(clamped);
    buttons.current[clamped]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number): void => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveTo(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveTo(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveTo(0);
        break;
      case 'End':
        event.preventDefault();
        moveTo(stations.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        setOpenIndex(index);
        popover.openerRef(buttons.current[index] ?? null);
        popover.open();
        break;
      default:
        break;
    }
  };

  const openStation = openIndex === null ? null : stations[openIndex];

  return (
    <div class="stations">
      <div class="stations__row" role="toolbar" aria-label="Markdown stations">
        {stations.map((station, index) => (
          <button
            key={station.station}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            class={`station station--${station.state}`}
            aria-label={`${station.label}, ${formatDateOnly(station.at.slice(0, 10))}`}
            data-station={station.station}
            data-state={station.state}
            data-at={station.at}
            tabIndex={index === focusIndex ? 0 : -1}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => {
              setFocusIndex(index);
              setOpenIndex(index);
              popover.openerRef(buttons.current[index] ?? null);
              popover.open();
            }}
          >
            <span class="station__label">{station.label}</span>
            <span class="station__date">{formatDateOnly(station.at.slice(0, 10))}</span>
          </button>
        ))}
      </div>
      {popover.mounted && openStation !== undefined && openStation !== null ? (
        <StationPopover
          state={popover}
          station={openStation}
          anchor={buttons.current[openIndex as number] ?? null}
        />
      ) : null}
    </div>
  );
}

interface StationPopoverProps {
  state: ReturnType<typeof useOverlay>;
  station: Station;
  anchor: HTMLButtonElement | null;
}

/** The popover opens inside the viewport, never cut off, at 375 and 1280 pixels wide. */
function StationPopover({ state, station, anchor }: StationPopoverProps) {
  const holder = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = holder.current?.querySelector<HTMLElement>('.overlay__panel');
    if (node === null || node === undefined || anchor === null) return;
    const margin = 8;
    const rect = anchor.getBoundingClientRect();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const left = Math.min(
      Math.max(margin, rect.left + rect.width / 2 - width / 2),
      Math.max(margin, window.innerWidth - width - margin),
    );
    const below = rect.bottom + margin;
    const top = below + height + margin > window.innerHeight
      ? Math.max(margin, rect.top - height - margin)
      : below;
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  });

  return (
    <div ref={holder} class="station-popover">
      <Overlay state={state} name={station.label} kind="menu" modal={false}>
        <p class="station-popover__when">{formatDateTime(Date.parse(station.at))}</p>
        <p class="station-popover__price">
          {station.priceCents === null ? '—' : formatMoney(station.priceCents)}
        </p>
        <button type="button" class="button button--quiet" onClick={() => state.close()}>
          Close
        </button>
      </Overlay>
    </div>
  );
}
