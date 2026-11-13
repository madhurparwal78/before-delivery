/** The product page: viewer, promise, featured offer and EMI plans. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useCart, usePincode, useSession } from '../state.tsx';
import { Amount, PendingButton, StatusRegion } from '../components/ui.tsx';
import { ProductViewer } from '../effects/visuals.tsx';
import { MorphIcon } from '../effects/decor.tsx';
import { formatPromiseDate } from '../../shared/format.js';
import { FIELD, pincodeNotServiceable, sellerCannotReach } from '../../shared/messages.js';
import type {
  EmiPlansResponse,
  ProductDetail,
  WishlistItem,
} from '../../shared/types.js';

export function ProductPage({ productId }: { productId: string }): ReactNode {
  const { navigate } = useRouter();
  const { account } = useSession();
  const { addToCart, refresh } = useCart();
  const [pincode, setPincode] = usePincode();
  const [entry, setEntry] = useState(pincode ?? '');
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [plans, setPlans] = useState<EmiPlansResponse | null>(null);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const suffix = pincode === null ? '' : `?pin=${pincode}`;
    void api<ProductDetail>(`/api/products/${productId}${suffix}`)
      .then(setProduct)
      .catch(() => setMissing(true));
  }, [productId, pincode]);

  useEffect(() => {
    if (product?.featured_offer === null || product === null) return;
    void api<EmiPlansResponse>(`/api/emi-plans?listing_id=${product.featured_offer.listing_id}`)
      .then(setPlans)
      .catch(() => setPlans(null));
  }, [product]);

  useEffect(() => {
    if (account === null || account.role !== 'shopper') return;
    void api<{ items: WishlistItem[] }>('/api/wishlist')
      .then((response) => setSaved(response.items.some((item) => item.product_id === productId)))
      .catch(() => setSaved(false));
  }, [account, productId]);

  if (missing) {
    return (
      <div className="panel panel-black">
        <h1>nothing here. wrong turn at the chauraha.</h1>
      </div>
    );
  }
  if (product === null) return <p className="muted">loading</p>;

  const offer = product.featured_offer;

  const addLine = async (then?: () => void): Promise<void> => {
    if (offer === null) return;
    await addToCart({
      listing_id: offer.listing_id,
      product_id: product.id,
      title: product.title,
      price_paise: offer.price_paise,
      quantity: 1,
    });
    await refresh();
    setMessage(`${product.title} added.`);
    then?.();
  };

  const toggleWishlist = async (): Promise<void> => {
    if (account === null || account.role !== 'shopper') {
      navigate(`/signin?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`);
      return;
    }
    if (saved) {
      const items = await api<{ items: WishlistItem[] }>('/api/wishlist');
      const item = items.items.find((entry) => entry.product_id === productId);
      if (item !== undefined) {
        await api(`/api/wishlist/${item.item_id}`, { method: 'DELETE' });
      }
      setSaved(false);
      return;
    }
    await api('/api/wishlist', { method: 'POST', body: { product_id: productId } });
    setSaved(true);
  };

  const checkPincode = async (): Promise<void> => {
    if (!/^[1-9][0-9]{5}$/.test(entry)) {
      setMessage(FIELD.badPincode);
      return;
    }
    try {
      const info = await api<{ pincode: string; serviceable: boolean }>(`/api/pincodes/${entry}`);
      setPincode(info.pincode);
      setMessage(info.serviceable ? '' : pincodeNotServiceable(info.pincode));
    } catch (error) {
      if (error instanceof ApiFailure) setMessage(error.body.message);
    }
  };

  return (
    <>
      <h1>{product.title}</h1>
      <div className="grid split">
        <div>
          <ProductViewer title={product.title} seed={product.id} />
        </div>
        <div>
          <p className="price">
            <Amount paise={offer?.price_paise ?? 0} />
          </p>
          <p className="muted">{`${product.brand} · ${product.category} · ${product.rating.toFixed(1)}★`}</p>
          <p>{product.description}</p>
          <div className="row">
            <PendingButton label="Add to cart" onPress={() => addLine()} />
            <PendingButton
              label="Buy now"
              className="btn btn-yellow"
              onPress={() => addLine(() => navigate('/cart'))}
            />
            <button
              type="button"
              className="btn btn-quiet"
              aria-pressed={saved}
              onClick={() => void toggleWishlist()}
            >
              <MorphIcon kind="heart" active={saved} />
              Add to wishlist
            </button>
          </div>
          <div className="panel panel-black">
            <label htmlFor="product-pincode">Pincode</label>
            <input
              id="product-pincode"
              type="text"
              aria-label="Pincode"
              inputMode="numeric"
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
            />
            <PendingButton label="Check pincode" onPress={checkPincode} />
            <p>
              {offer === null
                ? ''
                : offer.promise_date !== null
                  ? `arrives by ${formatPromiseDate(offer.promise_date)}`
                  : pincode === null
                    ? 'set a pincode for a delivery promise'
                    : sellerCannotReach(offer.seller_name, pincode)}
            </p>
            <p className="muted">
              {offer === null
                ? ''
                : offer.cod_available
                  ? 'cash on delivery available'
                  : 'prepaid only'}
            </p>
          </div>
          {offer === null ? null : (
            <div className="panel panel-yellow">
              <p className="shout">featured offer</p>
              <p>{offer.seller_name}</p>
              <p>
                landed <Amount paise={offer.landed_paise} />
              </p>
            </div>
          )}
          <Link to={`/p/${product.id}/offers${pincode === null ? '' : `?pin=${pincode}`}`}>
            {`See all ${product.offers_count} offers`}
          </Link>
          <StatusRegion name="Product status" message={message} />
        </div>
      </div>

      <section className="panel">
        <h3>emi plans</h3>
        <div className="table-scroll">
          <table aria-label="EMI plans">
            <caption className="sr-only">EMI plans</caption>
            <thead>
              <tr>
                <th scope="col">Tenure</th>
                <th scope="col">Monthly instalment</th>
                <th scope="col">Total interest</th>
                <th scope="col">Total payable</th>
                <th scope="col">No cost</th>
              </tr>
            </thead>
            <tbody>
              {(plans?.plans ?? []).map((plan) => (
                <tr key={plan.tenure_months}>
                  <td>{`${plan.tenure_months} months`}</td>
                  <td>
                    <Amount paise={plan.instalment_paise} />
                  </td>
                  <td>
                    <Amount paise={plan.total_interest_paise} />
                  </td>
                  <td>
                    <Amount paise={plan.total_payable_paise} />
                  </td>
                  <td>{plan.no_cost ? 'no cost' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {plans === null ? <p className="muted">{FIELD.emiTooSmall}</p> : null}
      </section>

      <section className="panel panel-black">
        <h3>specs</h3>
        <ul className="plain">
          {Object.entries(product.specs).map(([name, value]) => (
            <li key={name}>{`${name}: ${value}`}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
