const flightMs = 420;
const fadeMs = 140;

export interface Flight {
  /** Settles the tile into the tray slot. */
  settle: () => void;
  /** Slides the tile back along the same path to its place in the strip. */
  back: () => Promise<void>;
}

/** The plucked tile travels as one element from the strip to its numbered tray slot. */
export function flyTile(source: string, from: DOMRect, to: DOMRect, reducedMotion: boolean): Flight {
  const tile = document.createElement('img');
  tile.src = source;
  tile.alt = '';
  tile.className = 'flying-tile';
  tile.style.left = `${from.left}px`;
  tile.style.top = `${from.top}px`;
  tile.style.width = `${from.width}px`;
  tile.style.height = `${from.height}px`;
  document.body.append(tile);

  const transform = `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${
    from.width === 0 ? 1 : to.width / from.width
  }, ${from.height === 0 ? 1 : to.height / from.height})`;

  const easing = 'cubic-bezier(0.16, 0.76, 0.3, 1)';
  if (reducedMotion) {
    tile.style.left = `${to.left}px`;
    tile.style.top = `${to.top}px`;
    tile.style.width = `${to.width}px`;
    tile.style.height = `${to.height}px`;
    tile.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fadeMs, easing: 'linear' });
  } else {
    tile.style.transformOrigin = 'top left';
    tile.animate([{ transform: 'none' }, { transform }], { duration: flightMs, easing, fill: 'forwards' });
  }

  return {
    settle: () => {
      tile.remove();
    },
    back: async () => {
      if (reducedMotion) {
        tile.remove();
        return;
      }
      const animation = tile.animate([{ transform }, { transform: 'none' }], {
        duration: flightMs,
        easing,
        fill: 'forwards',
      });
      await animation.finished.catch(() => undefined);
      tile.remove();
    },
  };
}
