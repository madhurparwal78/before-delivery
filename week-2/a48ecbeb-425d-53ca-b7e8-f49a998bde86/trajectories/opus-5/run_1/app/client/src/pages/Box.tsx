import { useRef, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { FLAVOURS } from '../../../shared/catalogue.js';
import { flavourCardCopy } from '../../../shared/copy.js';
import { CrateRail } from '../components/CrateRail.js';
import { FlavourCard } from '../components/FlavourCard.js';
import { useShop } from '../state/shop.js';
import { useViewport } from '../state/useViewport.js';

export function Box(): ReactElement {
  const { liveConnected, stockLeft } = useShop();
  const viewport = useViewport();
  const carousel = useRef<HTMLUListElement | null>(null);

  const scrollBy = (direction: -1 | 1) => {
    const list = carousel.current;
    if (list === null) return;
    const card = list.querySelector<HTMLElement>('li');
    list.scrollBy({ left: direction * ((card?.offsetWidth ?? 280) + 24), behavior: 'smooth' });
  };

  return (
    <div className="box-page" data-viewport={viewport}>
      <div className="box-page__main">
        <header className="box-page__intro">
          <h1>Build your crate</h1>
          <p>
            Mix any 12 cans, or fill the whole crate with one flavour. Your crate holds them
            while you shop.
          </p>
        </header>

        {!liveConnected && stockLeft !== null ? (
          <p className="notice notice--quiet">{flavourCardCopy.liveStockPaused}</p>
        ) : null}

        <div className="carousel">
          {viewport === 'desktop' ? (
            <div className="carousel__controls">
              <button
                type="button"
                className="icon-button"
                aria-label="Previous flavours"
                onClick={() => scrollBy(-1)}
              >
                <ChevronLeft aria-hidden="true" size={20} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Next flavours"
                onClick={() => scrollBy(1)}
              >
                <ChevronRight aria-hidden="true" size={20} />
              </button>
            </div>
          ) : null}

          <ul className="carousel__track" aria-label="Flavours" ref={carousel}>
            {FLAVOURS.map((flavour) => (
              <li key={flavour.slug}>
                <FlavourCard slug={flavour.slug} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <CrateRail />
    </div>
  );
}
