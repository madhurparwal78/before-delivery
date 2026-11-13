/** A shared wishlist or cart: product, price and the owner's chosen name, nothing else. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { useCart } from '../state.tsx';
import { Amount, PendingButton } from '../components/ui.tsx';
import { ProductImage } from '../effects/visuals.tsx';
import { errorMessage } from '../../shared/messages.js';
import type { SharedPage as SharedPageData } from '../../shared/types.js';

export function SharedPage({ token }: { token: string }): ReactNode {
  const { addToCart } = useCart();
  const [page, setPage] = useState<SharedPageData | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void api<SharedPageData>(`/api/shared/${token}`)
      .then(setPage)
      .catch((error: unknown) => {
        setPage(null);
        setMessage(
          error instanceof ApiFailure ? error.body.message : errorMessage('link_not_found'),
        );
      });
  }, [token]);

  if (page === null) {
    return (
      <div className="panel panel-black">
        <h1>{message === '' ? errorMessage('link_not_found') : message}</h1>
      </div>
    );
  }

  return (
    <>
      <h1>{`${page.display_name}'s ${page.kind}`}</h1>
      <ul className="plain grid grid-2 grid-3">
        {page.items.map((item) => (
          <li key={item.listing_id}>
            <article className="panel" aria-label={item.title}>
              <ProductImage src={item.image_url} alt={item.title} />
              <h4>{item.title}</h4>
              <p className="price">
                <Amount paise={item.price_paise} />
              </p>
              <PendingButton
                label={`Add ${item.title} to my cart`}
                onPress={() =>
                  addToCart({
                    listing_id: item.listing_id,
                    product_id: item.product_id,
                    title: item.title,
                    price_paise: item.price_paise,
                    quantity: 1,
                  })
                }
              />
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}
