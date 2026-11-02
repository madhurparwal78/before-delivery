import type { ReactElement } from 'react';
import { ShoppingBasket } from 'lucide-react';
import { useShop } from '../state/shop.js';
import { useViewport } from '../state/useViewport.js';
import {
  CrateAnnouncements,
  CrateCounter,
  CrateMeter,
  CrateSlots,
} from './Crate.js';
import { TotalsPanel } from './TotalsPanel.js';

/**
 * The crate: a fixed rail beside the flavour carousel on desktops, a side panel
 * on tablets and a bottom sheet on phones. Its order is the crate heading, the
 * counter, the slot grid, the meter, the order total region and the cart button.
 */
export function CrateRail(): ReactElement {
  const { cart, openCart } = useShop();
  const viewport = useViewport();
  const onPhone = viewport === 'phone';

  return (
    <section className="crate paper" aria-label="Crate" data-viewport={viewport}>
      <h2 className={onPhone ? 'visually-hidden' : 'crate__heading'}>Your crate</h2>
      <CrateCounter />
      <CrateSlots />
      <CrateMeter />
      {onPhone ? null : <TotalsPanel />}
      <button
        type="button"
        className="button button--primary crate__cart"
        aria-label="Open cart"
        onClick={openCart}
      >
        <ShoppingBasket aria-hidden="true" size={18} />
        Cart
        <span className="mono">{cart?.count ?? 0}</span>
      </button>
      <CrateAnnouncements />
    </section>
  );
}
