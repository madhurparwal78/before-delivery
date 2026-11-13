import { Check, ImageOff, Plus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { Empty } from "../../components/Empty";
import { failureMessage, get } from "../../lib/api";
import { useTitle } from "../../lib/hooks";
import { Failure, Loading, StaffGate, type ListingItem } from "./staff";

interface ListingsReply {
  listings: ListingItem[];
  facets: { category: Record<string, number> };
  next_cursor: string | null;
}

interface Shown {
  items: ListingItem[];
  facets: Record<string, number>;
  next: string | null;
}

type Phase = { kind: "loading" } | { kind: "ready"; shown: Shown } | { kind: "failed"; message: string };

const PAGE = 24;

function endpoint(q: string, category: string | null, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE) });
  if (q !== "") params.set("q", q);
  if (category) params.set("category", category);
  if (cursor) params.set("cursor", cursor);
  return `/api/seller/listings?${params}`;
}

function Thumbnail({ item }: { item: ListingItem }): ReactNode {
  const first = item.photos[0];
  return first ? (
    <img className="thumb" src={first.url} alt="" width={64} height={64} loading="lazy" />
  ) : (
    <span className="thumb thumb--none" aria-hidden="true">
      <ImageOff size={24} />
    </span>
  );
}

function ListingsPage(): ReactNode {
  useTitle("my listings");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState("");
  const newest = useRef(0);
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setQ(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const mine = ++newest.current;
    setMoreFailed("");
    setLoadingMore(false);
    get<ListingsReply>(endpoint(q, category, null)).then(
      (reply) => {
        if (mine === newest.current) setPhase({ kind: "ready", shown: { items: reply.listings, facets: reply.facets.category, next: reply.next_cursor } });
      },
      (error: unknown) => {
        if (mine === newest.current) setPhase({ kind: "failed", message: failureMessage(error) });
      },
    );
  }, [q, category]);

  useEffect(() => {
    if (focusAfter.current === null) return;
    document.getElementById(`edit-${focusAfter.current}`)?.focus();
    focusAfter.current = null;
  });

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    setQ(text.trim());
  };

  const loadMore = (next: string): void => {
    const mine = ++newest.current;
    setLoadingMore(true);
    setMoreFailed("");
    get<ListingsReply>(endpoint(q, category, next)).then(
      (reply) => {
        if (mine !== newest.current) return;
        focusAfter.current = reply.listings[0]?.listing_id ?? null;
        setPhase((current) =>
          current.kind === "ready" ? { kind: "ready", shown: { items: [...current.shown.items, ...reply.listings], facets: reply.facets.category, next: reply.next_cursor } } : current,
        );
        setLoadingMore(false);
      },
      (error: unknown) => {
        if (mine !== newest.current) return;
        setMoreFailed(failureMessage(error));
        setLoadingMore(false);
      },
    );
  };

  if (phase.kind === "failed") return <Failure status={0} message={phase.message} />;
  const shown = phase.kind === "ready" ? phase.shown : null;
  const total = shown ? Object.values(shown.facets).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <>
      <section className="panel panel--ground staff-head">
        <div className="staff-head__row">
          <h1>my listings</h1>
          <Link to="/seller/listings/new" className="btn btn--yellow">
            <Plus size={22} aria-hidden="true" />
            New listing
          </Link>
        </div>
        <form className="staff-search" role="search" onSubmit={submit}>
          <input type="search" aria-label="Search my listings" placeholder="search my listings" value={text} onChange={(event) => setText(event.target.value)} />
        </form>
      </section>
      {shown && Object.keys(shown.facets).length > 0 && (
        <section className="panel panel--yellow staff-facets" aria-label="Categories">
          <div className="row">
            <button type="button" className="chip-button" aria-pressed={category === null} onClick={() => setCategory(null)}>
              {category === null && <Check size={18} aria-hidden="true" />}
              all <span className="chip-button__count">{total}</span>
            </button>
            {Object.entries(shown.facets).map(([name, count]) => (
              <button key={name} type="button" className="chip-button" aria-pressed={category === name} onClick={() => setCategory(category === name ? null : name)}>
                {category === name && <Check size={18} aria-hidden="true" />}
                {name} <span className="chip-button__count">{count}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {!shown && <Loading />}
      {shown && shown.items.length === 0 && (
        <Empty tone="pink" sign="search">
          {q === "" && category === null ? "no listings yet." : "no match. loosen a filter."}
        </Empty>
      )}
      {shown && shown.items.length > 0 && (
        <section className="panel panel--black staff-results">
          <table role="table" className="rtable rtable--listings" aria-label="Listings">
            <thead role="rowgroup">
              <tr role="row">
                <th role="columnheader" scope="col">Photo</th>
                <th role="columnheader" scope="col">Title</th>
                <th role="columnheader" scope="col">Category</th>
                <th role="columnheader" scope="col">Price</th>
                <th role="columnheader" scope="col">Cost price</th>
                <th role="columnheader" scope="col">Stock</th>
                <th role="columnheader" scope="col">Status</th>
                <th role="columnheader" scope="col">Photos</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {shown.items.map((item) => (
                <tr role="row" key={item.listing_id}>
                  <td role="cell" data-label="Photo" className="rtable__photo">
                    <Thumbnail item={item} />
                  </td>
                  <td role="cell" data-label="Title" className="rtable__title">
                    <Link id={`edit-${item.listing_id}`} to={`/seller/listings/${item.listing_id}`}>
                      {item.title}
                    </Link>
                  </td>
                  <td role="cell" data-label="Category">{item.category}</td>
                  <td role="cell" data-label="Price" className="amount">
                    {rupees(item.price_paise)}
                  </td>
                  <td role="cell" data-label="Cost price" className="amount">
                    {rupees(item.cost_price_paise)}
                  </td>
                  <td role="cell" data-label="Stock">{item.stock}</td>
                  <td role="cell" data-label="Status">
                    <span className={`chip${item.status === "live" ? " chip--accent" : " chip--yellow"}`}>{item.status}</span>
                  </td>
                  <td role="cell" data-label="Photos">{item.photo_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {moreFailed && (
            <p className="field-error" role="alert">
              {moreFailed}
            </p>
          )}
          {shown.next && (
            <div className="staff-more">
              <Button variant="primary" busy={loadingMore} onClick={() => loadMore(shown.next as string)}>
                Load more
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export default function Listings(): ReactNode {
  return (
    <StaffGate role="seller">
      <ListingsPage />
    </StaffGate>
  );
}
