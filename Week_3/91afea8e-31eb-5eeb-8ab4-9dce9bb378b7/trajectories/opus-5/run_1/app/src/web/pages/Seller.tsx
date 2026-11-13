/** The seller console: listings, stock, shipments, returns and the settlement statement. */

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiFailure } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useReducedMotion } from '../state.tsx';
import {
  Amount,
  CountedField,
  Dialog,
  PendingButton,
  Reel,
  StatusRegion,
  useWideViewport,
} from '../components/ui.tsx';
import { categoryName, CATEGORIES } from '../../shared/catalogue.js';
import { formatPromiseDate } from '../../shared/format.js';
import { COPY, errorMessage, saveFailed, stockSaved } from '../../shared/messages.js';
import type {
  ReturnView,
  SellerListing,
  SellerShipmentView,
  SettlementLine,
  SettlementTotals,
} from '../../shared/types.js';

export function SellerListingsPage(): ReactNode {
  const [listings, setListings] = useState<SellerListing[]>([]);
  const [facets, setFacets] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const wide = useWideViewport();

  const load = async (query: string, cursorValue: string | null): Promise<void> => {
    const params = new URLSearchParams();
    if (query !== '') params.set('q', query);
    if (cursorValue !== null) params.set('cursor', cursorValue);
    const response = await api<{
      listings: SellerListing[];
      facets: { category: Record<string, number> };
      next_cursor: string | null;
    }>(`/api/seller/listings?${params.toString()}`);
    setListings((previous) =>
      cursorValue === null ? response.listings : [...previous, ...response.listings],
    );
    setFacets(response.facets.category);
    setCursor(response.next_cursor);
  };

  useEffect(() => {
    void load(search, null).catch(() => setListings([]));
  }, [search]);

  return (
    <>
      <h1>listings</h1>
      <div className="row">
        <input
          type="text"
          role="searchbox"
          aria-label="Search my listings"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Link to="/seller/listings/new" className="btn" ariaLabel="New listing">
          New listing
        </Link>
        <Link to="/seller/stock" className="btn btn-quiet">
          low stock board
        </Link>
      </div>
      <p>
        {Object.entries(facets).map(([slug, count]) => (
          <span className="chip" key={slug}>{`${categoryName(slug)} (${count})`}</span>
        ))}
      </p>
      {wide ? (
        <div className="panel table-scroll">
          <table aria-label="Listings">
            <caption className="sr-only">Listings</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Category</th>
                <th scope="col">Price</th>
                <th scope="col">Cost price</th>
                <th scope="col">Stock</th>
                <th scope="col">Status</th>
                <th scope="col">Photos</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((listing) => (
                <tr key={listing.listing_id}>
                  <td>
                    <Link to={`/seller/listings/${listing.listing_id}`}>{listing.title}</Link>
                  </td>
                  <td>{categoryName(listing.category)}</td>
                  <td>
                    <Amount paise={listing.price_paise} />
                  </td>
                  <td>
                    <Amount paise={listing.cost_price_paise} />
                  </td>
                  <td>{listing.stock}</td>
                  <td>{listing.status}</td>
                  <td>{listing.photo_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="plain grid">
          {listings.map((listing) => (
            <li key={listing.listing_id} className="panel">
              <h4>
                <Link to={`/seller/listings/${listing.listing_id}`}>{listing.title}</Link>
              </h4>
              <p className="price">
                <Amount paise={listing.price_paise} />
              </p>
              <p>{`stock ${listing.stock} · ${listing.status} · ${listing.photo_count} photos`}</p>
            </li>
          ))}
        </ul>
      )}
      {cursor === null ? null : (
        <button type="button" className="btn" onClick={() => void load(search, cursor)}>
          Load more
        </button>
      )}
    </>
  );
}

export function SellerListingFormPage({ listingId }: { listingId: string | null }): ReactNode {
  const { navigate } = useRouter();
  const [form, setForm] = useState({
    title: '',
    brand: '',
    category: 'kitchen',
    description: '',
    returnNote: '',
    price: 0,
    costPrice: 0,
    stock: 0,
    codAllowed: true,
    noCostEmi: false,
  });
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<{ photo_id: string; url: string }[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (listingId === null) return;
    void api<SellerListing>(`/api/seller/listings/${listingId}`)
      .then((listing) => {
        setForm({
          title: listing.title,
          brand: listing.brand ?? '',
          category: listing.category,
          description: listing.description ?? '',
          returnNote: listing.return_note ?? '',
          price: listing.price_paise,
          costPrice: listing.cost_price_paise,
          stock: listing.stock,
          codAllowed: listing.cod_allowed,
          noCostEmi: listing.no_cost_emi,
        });
        setPhotos(listing.photos ?? []);
      })
      .catch(() => setStatus(errorMessage('not_found')));
  }, [listingId]);

  const save = async (): Promise<void> => {
    const body: Record<string, unknown> = {
      description: form.description,
      return_note: form.returnNote,
      price_paise: form.price,
      cost_price_paise: form.costPrice,
      stock: form.stock,
      cod_allowed: form.codAllowed,
      no_cost_emi: form.noCostEmi,
      title: form.title,
      brand: form.brand,
      category: form.category,
    };
    try {
      const saved = await api<SellerListing>(
        listingId === null ? '/api/seller/listings' : `/api/seller/listings/${listingId}`,
        { method: listingId === null ? 'POST' : 'PATCH', body },
      );
      setStatus(COPY.listingSaved);
      setErrors({});
      if (listingId === null) navigate(`/seller/listings/${saved.listing_id}`);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setErrors(error.body.errors ?? {});
        const first = error.body.errors === undefined ? null : Object.values(error.body.errors)[0];
        setStatus(saveFailed(first ?? error.body.message));
      }
    }
  };

  const upload = async (file: File): Promise<void> => {
    if (listingId === null) return;
    const form_ = new FormData();
    form_.append('file', file);
    try {
      const uploaded = await api<{ photo_id: string; url: string }>(
        `/api/seller/listings/${listingId}/photos`,
        { method: 'POST', form: form_ },
      );
      setPhotos((previous) => [...previous, uploaded]);
      setStatus(COPY.listingSaved);
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(saveFailed(error.body.message));
    }
  };

  return (
    <>
      <h1>{listingId === null ? 'new listing' : 'edit listing'}</h1>
      {Object.keys(errors).length === 0 ? null : (
        <div className="panel panel-pink">
          <p>{errorMessage('validation_failed')}</p>
          <ul className="plain">
            {Object.entries(errors).map(([field, message]) => (
              <li key={field}>
                <a href={`#listing-${field}`}>{`${field}: ${message}`}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="panel">
        <CountedField
          label="Title"
          value={form.title}
          max={120}
          onChange={(value) => setForm({ ...form, title: value })}
        />
        <label htmlFor="listing-brand">Brand</label>
        <input
          id="listing-brand"
          type="text"
          aria-label="Brand"
          value={form.brand}
          onChange={(event) => setForm({ ...form, brand: event.target.value })}
        />
        <label htmlFor="listing-category">Category</label>
        <select
          id="listing-category"
          aria-label="Category"
          value={form.category}
          onChange={(event) => setForm({ ...form, category: event.target.value })}
        >
          {CATEGORIES.map((category) => (
            <option key={category.slug} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
        <CountedField
          label="Description"
          value={form.description}
          max={2000}
          multiline
          onChange={(value) => setForm({ ...form, description: value })}
        />
        <CountedField
          label="Return note"
          value={form.returnNote}
          max={500}
          multiline
          onChange={(value) => setForm({ ...form, returnNote: value })}
        />
        <label htmlFor="listing-price">Price (₹)</label>
        <input
          id="listing-price"
          type="number"
          role="spinbutton"
          aria-label="Price (₹)"
          min={0}
          value={form.price / 100}
          onChange={(event) => setForm({ ...form, price: Math.round(Number(event.target.value) * 100) })}
        />
        <label htmlFor="listing-cost">Cost price (₹)</label>
        <input
          id="listing-cost"
          type="number"
          role="spinbutton"
          aria-label="Cost price (₹)"
          min={0}
          value={form.costPrice / 100}
          onChange={(event) =>
            setForm({ ...form, costPrice: Math.round(Number(event.target.value) * 100) })
          }
        />
        <label htmlFor="listing-stock">Stock</label>
        <input
          id="listing-stock"
          type="number"
          role="spinbutton"
          aria-label="Stock"
          min={0}
          value={form.stock}
          onChange={(event) => setForm({ ...form, stock: Number(event.target.value) })}
        />
        <div className="check-row">
          <input
            id="listing-cod"
            type="checkbox"
            aria-label="Cash on delivery"
            checked={form.codAllowed}
            onChange={() => setForm({ ...form, codAllowed: !form.codAllowed })}
          />
          <label htmlFor="listing-cod">Cash on delivery</label>
        </div>
        <div className="check-row">
          <input
            id="listing-emi"
            type="checkbox"
            aria-label="No-cost EMI"
            checked={form.noCostEmi}
            onChange={() => setForm({ ...form, noCostEmi: !form.noCostEmi })}
          />
          <label htmlFor="listing-emi">No-cost EMI</label>
        </div>
        <label htmlFor="listing-photos">Listing photos</label>
        <input
          id="listing-photos"
          ref={fileInput}
          type="file"
          aria-label="Listing photos"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void upload(file);
          }}
        />
        <ul className="plain row">
          {photos.map((photo) => (
            <li key={photo.photo_id}>
              <img src={photo.url} alt="" width={80} height={80} style={{ borderRadius: 12 }} />
            </li>
          ))}
        </ul>
        <PendingButton label="Save listing" onPress={save} />
        <StatusRegion name="Save status" message={status} />
      </section>
    </>
  );
}

export function SellerStockPage(): ReactNode {
  const [rows, setRows] = useState<{ listing_id: string; title: string; stock: number }[]>([]);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [status, setStatus] = useState('');
  const wide = useWideViewport();

  const load = async (): Promise<void> => {
    const response = await api<{ listings: { listing_id: string; title: string; stock: number }[] }>(
      '/api/seller/low-stock',
    );
    setRows(response.listings);
    setDrafts(
      Object.fromEntries(response.listings.map((listing) => [listing.listing_id, listing.stock])),
    );
  };

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, []);

  const save = async (listingId: string, title: string): Promise<void> => {
    try {
      const stock = drafts[listingId] ?? 0;
      await api(`/api/seller/listings/${listingId}/stock`, { method: 'PUT', body: { stock } });
      setStatus(stockSaved(title, stock));
      await load();
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(saveFailed(error.body.message));
    }
  };

  const field = (row: { listing_id: string; title: string }): ReactNode => (
    <>
      <label htmlFor={`stock-${row.listing_id}`} className="sr-only">
        {`Stock for ${row.title}`}
      </label>
      <input
        id={`stock-${row.listing_id}`}
        type="number"
        role="spinbutton"
        aria-label={`Stock for ${row.title}`}
        min={0}
        value={drafts[row.listing_id] ?? 0}
        onChange={(event) =>
          setDrafts({ ...drafts, [row.listing_id]: Number(event.target.value) })
        }
      />
      <PendingButton
        label={`Save stock for ${row.title}`}
        onPress={() => save(row.listing_id, row.title)}
      />
    </>
  );

  return (
    <>
      <h1>low stock</h1>
      {wide ? (
        <div className="panel table-scroll">
          <table aria-label="Low stock">
            <caption className="sr-only">Low stock</caption>
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Stock</th>
                <th scope="col">Save</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.listing_id}>
                  <td>{row.title}</td>
                  <td>{row.stock}</td>
                  <td>{field(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="plain grid">
          {rows.map((row) => (
            <li key={row.listing_id} className="panel">
              <h4>{row.title}</h4>
              <p>{`stock ${row.stock}`}</p>
              {field(row)}
            </li>
          ))}
        </ul>
      )}
      <StatusRegion name="Save status" message={status} />
    </>
  );
}

export function SellerShipmentsPage(): ReactNode {
  const [shipments, setShipments] = useState<SellerShipmentView[]>([]);
  const [status, setStatus] = useState('');

  const load = async (): Promise<void> => {
    const response = await api<{ shipments: SellerShipmentView[] }>('/api/seller/shipments');
    setShipments(response.shipments);
  };

  useEffect(() => {
    void load().catch(() => setShipments([]));
  }, []);

  const move = async (shipmentId: string, action: 'pack' | 'ship' | 'deliver'): Promise<void> => {
    try {
      await api(`/api/seller/shipments/${shipmentId}/${action}`, { method: 'POST', body: {} });
      setStatus('');
      await load();
    } catch (error) {
      if (error instanceof ApiFailure) setStatus(error.body.message);
    }
  };

  return (
    <>
      <h1>shipments</h1>
      <ul className="plain grid grid-2 grid-3">
        {shipments.map((shipment) => (
          <li key={shipment.shipment_id}>
            <section
              className="panel"
              role="region"
              aria-label={`Shipment ${shipment.shipment_id}`}
            >
              <h4>{shipment.shipment_id}</h4>
              <p className="chip">{shipment.state}</p>
              <p className="chip">
                {shipment.payment_status === 'pending'
                  ? 'payment pending'
                  : shipment.payment_status === 'paid'
                    ? 'paid'
                    : shipment.payment_status === 'refunded'
                      ? 'refunded'
                      : 'partly refunded'}
              </p>
              <p className="chip">
                {shipment.invoice_status === 'ready' ? 'invoice ready' : 'invoice pending'}
              </p>
              <p className="chip">
                {shipment.label_status === 'ready' ? 'label ready' : 'label pending'}
              </p>
              <p>{`arrives by ${formatPromiseDate(shipment.promise_date)}`}</p>
              <p>{`${shipment.ship_to.name} · ${shipment.ship_to.city} ${shipment.ship_to.pincode}`}</p>
              <ul className="plain">
                {shipment.lines.map((line) => (
                  <li key={line.line_id}>
                    {`${line.title} × ${line.quantity} · `}
                    <Amount paise={line.gross_paise} />
                  </li>
                ))}
              </ul>
              {shipment.payment_status === 'pending' && shipment.payment_kind === 'prepaid' ? (
                <p className="panel panel-pink">{errorMessage('payment_pending')}</p>
              ) : null}
              {shipment.label_status === 'pending' ? (
                <p className="panel panel-pink">{errorMessage('label_pending')}</p>
              ) : null}
              <div className="row">
                {shipment.state === 'placed' ? (
                  <PendingButton
                    label="Mark packed"
                    onPress={() => move(shipment.shipment_id, 'pack')}
                  />
                ) : null}
                {shipment.state === 'packed' ? (
                  <PendingButton
                    label="Mark shipped"
                    disabled={shipment.label_status === 'pending'}
                    onPress={() => move(shipment.shipment_id, 'ship')}
                  />
                ) : null}
                {shipment.state === 'shipped' ? (
                  <PendingButton
                    label="Mark delivered"
                    onPress={() => move(shipment.shipment_id, 'deliver')}
                  />
                ) : null}
                {shipment.label_status === 'ready' ? (
                  <a
                    className="btn btn-quiet"
                    href={`/api/seller/shipments/${shipment.shipment_id}/label`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Print label
                  </a>
                ) : null}
                {shipment.invoice_status === 'ready' ? (
                  <a
                    className="btn btn-quiet"
                    href={`/api/shipments/${shipment.shipment_id}/invoice`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Invoice
                  </a>
                ) : null}
              </div>
            </section>
          </li>
        ))}
      </ul>
      <StatusRegion name="Save status" message={status} />
    </>
  );
}

export function SellerReturnsPage(): ReactNode {
  const [returns, setReturns] = useState<ReturnView[]>([]);
  const [declineFor, setDeclineFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');

  const load = async (): Promise<void> => {
    const response = await api<{ returns: ReturnView[] }>('/api/seller/returns');
    setReturns(response.returns);
  };

  useEffect(() => {
    void load().catch(() => setReturns([]));
  }, []);

  return (
    <>
      <h1>returns</h1>
      <ul className="plain grid grid-2 grid-3">
        {returns.map((entry) => (
          <li key={entry.return_id} className="panel">
            <h4>{entry.return_id}</h4>
            <p className="chip">{entry.state}</p>
            <p>{`${entry.quantity} unit(s)`}</p>
            <p>
              refund <Amount paise={entry.refund_paise} />
            </p>
            {entry.decline_reason === null ? null : <p>{entry.decline_reason}</p>}
            {entry.state === 'requested' ? (
              <div className="row">
                <PendingButton
                  label="Approve pickup"
                  onPress={async () => {
                    try {
                      await api(`/api/seller/returns/${entry.return_id}/pickup`, {
                        method: 'POST',
                        body: {},
                      });
                      await load();
                    } catch (error) {
                      if (error instanceof ApiFailure) setStatus(error.body.message);
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn btn-pink"
                  onClick={() => setDeclineFor(entry.return_id)}
                >
                  Decline return
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <StatusRegion name="Save status" message={status} />
      <Dialog name="Decline return" open={declineFor !== null} onClose={() => setDeclineFor(null)}>
        <label htmlFor="decline-reason">Reason</label>
        <textarea
          id="decline-reason"
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <PendingButton
          label="Decline return"
          className="btn btn-pink"
          onPress={async () => {
            if (declineFor === null) return;
            try {
              await api(`/api/seller/returns/${declineFor}/decline`, {
                method: 'POST',
                body: { reason },
              });
              setDeclineFor(null);
              setReason('');
              await load();
            } catch (error) {
              if (error instanceof ApiFailure) {
                setStatus(error.field('reason') ?? error.body.message);
              }
            }
          }}
        />
      </Dialog>
    </>
  );
}

export function SellerStatementPage(): ReactNode {
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<SettlementLine[]>([]);
  const [totals, setTotals] = useState<SettlementTotals | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void api<{ lines: SettlementLine[]; totals: SettlementTotals }>('/api/seller/settlements')
      .then((response) => {
        setLines(response.lines);
        setTotals(response.totals);
      })
      .catch(() => setLines([]));
  }, []);

  useEffect(() => {
    const onScroll = (): void => {
      setProgress(Math.min(1, window.scrollY / 900));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const rolled = (value: number, index: number, count: number): number => {
    if (reduced) return value;
    const threshold = (index + 1) / (count + 1);
    return progress >= threshold ? value : 0;
  };

  const rows: { label: string; value: number }[] =
    totals === null
      ? []
      : [
          { label: 'gross', value: totals.gross_paise },
          { label: 'commission', value: -totals.commission_paise },
          { label: 'gst on commission', value: -totals.commission_gst_paise },
          { label: 'tax collected at source', value: -totals.tcs_paise },
          { label: 'tax deducted at source', value: -totals.tds_paise },
          { label: 'net', value: totals.net_paise },
        ];

  return (
    <>
      <h1>statement</h1>
      <div className="grid statement-layout">
        <div className="panel table-scroll">
          <table aria-label="Settlement statement">
            <caption className="sr-only">Settlement statement</caption>
            <thead>
              <tr>
                <th scope="col">Posted</th>
                <th scope="col">Kind</th>
                <th scope="col">Gross</th>
                <th scope="col">Commission</th>
                <th scope="col">GST on commission</th>
                <th scope="col">TCS</th>
                <th scope="col">TDS</th>
                <th scope="col">EMI subvention</th>
                <th scope="col">Net</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.settlement_line_id}>
                  <td>{line.posted_on}</td>
                  <td>{line.kind}</td>
                  <td>
                    <Amount paise={line.gross_paise} />
                  </td>
                  <td>
                    <Amount paise={line.commission_paise} />
                  </td>
                  <td>
                    <Amount paise={line.commission_gst_paise} />
                  </td>
                  <td>
                    <Amount paise={line.tcs_paise} />
                  </td>
                  <td>
                    <Amount paise={line.tds_paise} />
                  </td>
                  <td>
                    <Amount paise={line.emi_subvention_paise} />
                  </td>
                  <td>
                    <Amount paise={line.net_paise} />
                  </td>
                  <td>{line.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel panel-black">
          {rows.map((row, index) => (
            <div className="bill-line" key={row.label}>
              <span>{row.label}</span>
              <span>
                <Reel paise={rolled(row.value, index, rows.length)} />
              </span>
            </div>
          ))}
          <div role="group" aria-label="Net payout" className="price">
            <Reel paise={totals?.net_paise ?? 0} />
          </div>
        </div>
      </div>
      <div style={{ height: 900 }} aria-hidden="true" />
    </>
  );
}
