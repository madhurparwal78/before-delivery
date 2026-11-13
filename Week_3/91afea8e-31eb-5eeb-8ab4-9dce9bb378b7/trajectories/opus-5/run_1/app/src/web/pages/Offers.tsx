/** Seller offers in server order: table on tablet and desktop, stacked cards on a phone. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { useRouter } from '../router.tsx';
import { useCart } from '../state.tsx';
import { Amount, PendingButton, useWideViewport } from '../components/ui.tsx';
import { formatPromiseDate } from '../../shared/format.js';
import type { Offer } from '../../shared/types.js';

export function OffersPage({ productId }: { productId: string }): ReactNode {
  const { search, navigate } = useRouter();
  const { addToCart, refresh } = useCart();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [title, setTitle] = useState('');
  const wide = useWideViewport();
  const pin = new URLSearchParams(search).get('pin');

  useEffect(() => {
    const suffix = pin === null ? '' : `?pin=${pin}`;
    void api<{ offers: Offer[] }>(`/api/products/${productId}/offers${suffix}`)
      .then((response) => setOffers(response.offers))
      .catch(() => setOffers([]));
    void api<{ title: string }>(`/api/products/${productId}`)
      .then((response) => setTitle(response.title))
      .catch(() => setTitle(''));
  }, [productId, pin]);

  const choose = async (offer: Offer): Promise<void> => {
    await addToCart({
      listing_id: offer.listing_id,
      product_id: productId,
      title,
      price_paise: offer.price_paise,
      quantity: 1,
    });
    await refresh();
    navigate('/cart');
  };

  const promise = (offer: Offer): string =>
    offer.promise_date === null ? '—' : `arrives by ${formatPromiseDate(offer.promise_date)}`;

  return (
    <>
      <h1>{`offers for ${title}`}</h1>
      {wide ? (
        <div className="table-scroll panel">
          <table aria-label="Seller offers">
            <caption className="sr-only">Seller offers</caption>
            <thead>
              <tr>
                <th scope="col">Seller</th>
                <th scope="col">Price</th>
                <th scope="col">Delivery</th>
                <th scope="col">Landed price</th>
                <th scope="col">Arrives by</th>
                <th scope="col">Cash on delivery</th>
                <th scope="col">Choose</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((offer) => (
                <tr key={offer.listing_id}>
                  <td>
                    {offer.seller_name}
                    {offer.featured ? <span className="chip">featured offer</span> : null}
                  </td>
                  <td>
                    <Amount paise={offer.price_paise} />
                  </td>
                  <td>
                    <Amount paise={offer.delivery_fee_paise} />
                  </td>
                  <td>
                    <Amount paise={offer.landed_paise} />
                  </td>
                  <td>{promise(offer)}</td>
                  <td>{offer.cod_available ? 'yes' : 'no'}</td>
                  <td>
                    <PendingButton
                      label={`Choose ${offer.seller_name}`}
                      onPress={() => choose(offer)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="plain grid">
          {offers.map((offer) => (
            <li key={offer.listing_id} className="panel">
              <h4>{offer.seller_name}</h4>
              {offer.featured ? <p className="chip">featured offer</p> : null}
              <p className="price">
                <Amount paise={offer.price_paise} />
              </p>
              <p>
                delivery <Amount paise={offer.delivery_fee_paise} />
              </p>
              <p>
                landed price <Amount paise={offer.landed_paise} />
              </p>
              <p>{promise(offer)}</p>
              <p>{`cash on delivery: ${offer.cod_available ? 'yes' : 'no'}`}</p>
              <PendingButton label={`Choose ${offer.seller_name}`} onPress={() => choose(offer)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
