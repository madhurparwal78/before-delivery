/** Compare two to four products of one category, with the differences shouted. */

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { Amount } from '../components/ui.tsx';
import { COPY } from '../../shared/messages.js';
import type { CompareResponse } from '../../shared/types.js';

export function ComparePage(): ReactNode {
  const { search, navigate } = useRouter();
  const params = new URLSearchParams(search);
  const ids = (params.get('ids') ?? '').split(',').filter((id) => id !== '');
  const diff = params.get('diff') === '1';
  const [data, setData] = useState<CompareResponse | null>(null);
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (ids.length < 2) {
      setMessage(COPY.compareUnderTwo);
      setData(null);
      return;
    }
    void api<CompareResponse>(`/api/compare?ids=${ids.join(',')}`)
      .then((response) => {
        setData(response);
        setMessage('');
      })
      .catch((error: unknown) => {
        setData(null);
        setMessage(
          error instanceof ApiFailure
            ? (error.field('ids') ?? error.body.message)
            : COPY.compareUnderTwo,
        );
      });
  }, [search]);

  const setParam = (name: string, value: string): void => {
    const next = new URLSearchParams(search);
    next.set(name, value);
    navigate(`/compare?${next.toString()}`);
  };

  return (
    <>
      <h1>compare</h1>
      {message === '' ? null : (
        <div className="panel panel-pink">
          <p className="shout">{message}</p>
        </div>
      )}
      <div className="row">
        <div className="check-row">
          <button
            type="button"
            role="switch"
            aria-checked={diff}
            aria-label="Highlight differences"
            className="btn btn-quiet"
            onClick={() => setParam('diff', diff ? '0' : '1')}
          >
            {diff ? 'highlighting differences' : 'highlight differences'}
          </button>
        </div>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(window.location.href)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          Copy link
        </button>
        {copied ? <span className="chip">link copied</span> : null}
      </div>
      {data === null ? null : (
        <div className="panel table-scroll">
          <table aria-label="Compare products">
            <caption className="sr-only">Compare products</caption>
            <thead>
              <tr>
                <th scope="col">attribute</th>
                {data.products.map((product) => (
                  <th scope="col" key={product.id}>
                    <Link to={`/p/${product.id}`}>{product.title}</Link>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() =>
                        setParam('ids', ids.filter((id) => id !== product.id).join(','))
                      }
                    >
                      {`Remove ${product.title}`}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Price</th>
                {data.products.map((product) => (
                  <td key={product.id}>
                    <Amount paise={product.best_price_paise} />
                  </td>
                ))}
              </tr>
              {data.attributes.map((attribute) => (
                <tr key={attribute.name}>
                  <th scope="row" className={diff && attribute.differs ? 'differs' : undefined}>
                    {attribute.name}
                  </th>
                  {attribute.values.map((value, index) => (
                    <td
                      key={`${attribute.name}-${index}`}
                      className={diff && attribute.differs ? 'differs' : undefined}
                    >
                      {attribute.name === 'Best price' ? <Amount paise={Number(value)} /> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
