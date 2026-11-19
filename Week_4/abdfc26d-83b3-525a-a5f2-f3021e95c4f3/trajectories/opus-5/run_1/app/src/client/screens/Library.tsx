import { useEffect, useState } from 'react';
import type { DownloadLink, Order } from '../../shared/api.js';
import { emptyStates, libraryStatus } from '../../shared/copy.js';
import { formatUsd } from '../../shared/money.js';
import { api, ApiFailure } from '../lib/api.js';
import { useBreakpoint, useLoader } from '../lib/hooks.js';
import { PUBLIC_PIECE_SHADER } from '../lib/pieceShader.js';
import { usePublicUniforms } from '../lib/pieceUniforms.js';
import { editionSeedValue } from '../lib/editionSeed.js';
import { Link } from '../lib/router.js';
import { LiveCanvas } from '../components/LiveCanvas.js';
import { EmptyState, StatusRegion } from '../components/StatusRegion.js';

/** A small live canvas of that edition's own seed variation. */
function EditionThumb({ slug, edition }: { slug: string; edition: number }): JSX.Element {
  const uniforms = usePublicUniforms(slug);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    let alive = true;
    void editionSeedValue(slug, edition).then((value) => {
      if (alive) setSeed(value);
    });
    return () => {
      alive = false;
    };
  }, [slug, edition]);

  return (
    <span className="library__thumb">
      <LiveCanvas fragmentSource={PUBLIC_PIECE_SHADER} uniforms={uniforms} seed={seed} />
    </span>
  );
}

export function Library(): JSX.Element {
  const breakpoint = useBreakpoint();
  const orders = useLoader(() => api.get<{ orders: Order[] }>('/api/me/orders'), [], 10000);
  const [message, setMessage] = useState<string | null>(null);

  const download = (order: Order, kind: 'export' | 'invoice') => (): void => {
    void api
      .get<DownloadLink>(`/api/orders/${order.id}/${kind}`)
      .then((link) => {
        window.location.assign(link.url);
      })
      .catch((error: unknown) => {
        if (!(error instanceof ApiFailure)) return;
        if (error.code === 'storage_unavailable') {
          setMessage(libraryStatus.storageOffline);
        } else if (error.code === 'invoice_pending') {
          setMessage(libraryStatus.invoicePending(String(error.detail.invoice_number ?? '')));
        } else {
          setMessage(error.message);
        }
      });
  };

  const rows = orders.data?.orders ?? [];

  if (rows.length === 0 && !orders.loading) {
    return (
      <div className="shell library">
        <h1 className="library__title display">Your editions.</h1>
        <EmptyState
          sentence={emptyStates.library}
          actionLabel="Browse the gallery"
          actionTo="/gallery"
        />
      </div>
    );
  }

  const actions = (order: Order): JSX.Element => (
    <>
      <button type="button" className="ghost-button" onClick={download(order, 'export')}>
        Download export
      </button>
      <button type="button" className="ghost-button" onClick={download(order, 'invoice')}>
        Download invoice
      </button>
    </>
  );

  return (
    <div className="shell library">
      <h1 className="library__title display">Your editions.</h1>

      {breakpoint === 'phone' ? (
        <ul className="library__stack" aria-label="Your editions">
          {rows.map((order) => (
            <li key={order.id} className="library__card">
              <EditionThumb slug={order.piece_slug} edition={order.edition} />
              <Link to={`/pieces/${order.piece_slug}`} className="library__piece display">
                {order.piece_title}
              </Link>
              <p className="tabular">
                Edition {order.edition} of {order.edition_count}
              </p>
              <p>
                <span className="muted">State</span> <span>{order.state}</span>
              </p>
              <p className="tabular">
                <span className="muted">Invoice</span> <span>{order.invoice_number ?? '—'}</span>
              </p>
              <p className="tabular">
                <span className="muted">Paid</span> <span>${formatUsd(order.gross_cents)}</span>
              </p>
              <div className="library__actions">{actions(order)}</div>
            </li>
          ))}
        </ul>
      ) : (
        <table className="data-table" aria-label="Your editions">
          <thead>
            <tr>
              <th scope="col">Edition</th>
              <th scope="col">Piece</th>
              <th scope="col">Number</th>
              <th scope="col">State</th>
              <th scope="col">Invoice</th>
              <th scope="col" className="amount">
                Paid
              </th>
              <th scope="col">Downloads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((order) => (
              <tr key={order.id}>
                <td>
                  <EditionThumb slug={order.piece_slug} edition={order.edition} />
                </td>
                <th scope="row">
                  <Link to={`/pieces/${order.piece_slug}`}>{order.piece_title}</Link>
                </th>
                <td className="tabular">
                  Edition {order.edition} of {order.edition_count}
                </td>
                <td>{order.state}</td>
                <td className="tabular mono">{order.invoice_number ?? '—'}</td>
                <td className="amount tabular">${formatUsd(order.gross_cents)}</td>
                <td className="library__actions">{actions(order)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <StatusRegion label="Library status" message={message} />
    </div>
  );
}
