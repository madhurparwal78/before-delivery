// The gallery (DP-46, DP-47): categories, sort, stable pages, skeletons of the exact card size, live like counts.
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryJson, GalleryPart } from "../shared/api";
import { bboxText, display, volumeText } from "../shared/numbers";
import { api, get } from "./api";
import { useEpoch } from "./epoch";
import { Icon } from "./icons";
import { useLiveEvents } from "./live";
import { navigate, useLocation } from "./router";
import { useSession } from "./session";
import { Link } from "./shell";

const SORTS = [
  { id: "featured", label: "Featured" },
  { id: "liked", label: "Most liked" },
  { id: "newest", label: "Newest" },
  { id: "name", label: "Name A–Z" },
];
const PAGE = 12;

function likeText(n: number): string {
  return n === 1 ? "1 like" : `${display(n, 0)} likes`;
}

export function Gallery() {
  const { search } = useLocation();
  const query = new URLSearchParams(search);
  const category = query.get("category") ?? "";
  const sort = SORTS.some((s) => s.id === query.get("sort")) ? (query.get("sort") as string) : "featured";
  const { me, ready } = useSession();
  const [data, setData] = useState<GalleryJson | null>(null);
  const [parts, setParts] = useState<GalleryPart[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [epoch, bumpEpoch] = useEpoch("tinework:epoch:gallery:home");
  const loaded = useRef(false);

  const load = useCallback(
    async (after: string | null) => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      params.set("sort", sort);
      if (after) params.set("cursor", after);
      const reply = await get<GalleryJson>(`/api/parts?${params}`);
      if (!reply.ok) return;
      setData(reply.data);
      setCursor(reply.data.nextCursor);
      setParts((current) => {
        const next = after ? [...current, ...reply.data.parts.filter((p) => !current.some((c) => c.slug === p.slug))] : reply.data.parts;
        if (loaded.current) setAnnounce(`Showing ${next.length} parts.`);
        return next;
      });
      loaded.current = true;
      bumpEpoch();
    },
    [category, sort, bumpEpoch],
  );

  useEffect(() => {
    if (!ready) return;
    setParts([]);
    setCursor(null);
    void load(null);
  }, [load, ready]);

  useLiveEvents("*", (event) => {
    if (event.type === "like") setParts((list) => list.map((p) => (p.slug === event.partSlug ? { ...p, likes: event.likes } : p)));
  });

  const go = (next: { category?: string; sort?: string }) => {
    const c = next.category ?? category;
    const s = next.sort ?? sort;
    const params = new URLSearchParams();
    if (c) params.set("category", c);
    if (s !== "featured") params.set("sort", s);
    navigate(`/${params.size ? `?${params}` : ""}`);
  };

  const toggleLike = async (part: GalleryPart) => {
    if (!me) return;
    const reply = await api<{ liked: boolean; likes: number }>(part.liked ? "DELETE" : "PUT", `/api/parts/${part.slug}/like`);
    if (reply.ok) setParts((list) => list.map((p) => (p.slug === part.slug ? { ...p, liked: reply.data.liked, likes: reply.data.likes } : p)));
  };

  const total = data ? data.categories.reduce((n, c) => n + c.count, 0) : 0;
  return (
    <section className="gallery" role="region" aria-label="Gallery" id="gallery">
      <div className="gallery-head">
        <h2>Gallery</h2>
        <label className="sort">
          <span>Sort by</span>
          <select aria-label="Sort by" value={sort} onChange={(event) => go({ sort: event.target.value })}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="muted small gallery-count" role="status" aria-label="Gallery">
        {announce}
      </p>
      <div className="gallery-body">
        <nav aria-label="Categories" className="categories">
          <a
            href="/"
            aria-current={category === "" ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              go({ category: "" });
            }}
          >
            {`All parts (${total})`}
          </a>
          {(data?.categories ?? []).map((c) => (
            <a
              key={c.slug}
              href={`/?category=${c.slug}`}
              aria-current={category === c.slug ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                go({ category: c.slug });
              }}
            >
              {`${c.name} (${c.count})`}
            </a>
          ))}
        </nav>
        <div className="gallery-main">
          {data && parts.length === 0 ? (
            <div className="empty">
              <Icon name="dimension" size={40} />
              <p>No parts in this category yet.</p>
              <Link to="/" className="button">
                Show all parts
              </Link>
            </div>
          ) : (
            <ul className="grid" aria-label="Parts" data-ui="gallery-grid" data-epoch={epoch}>
              {data
                ? parts.map((part) => (
                    <Card key={part.slug} part={part} category={data.categories.find((c) => c.slug === part.category)?.name ?? part.category} signedIn={me !== null} onLike={() => toggleLike(part)} />
                  ))
                : Array.from({ length: PAGE }, (_, i) => <li key={i} className="card skeleton" data-ui="card-skeleton" aria-hidden="true" />)}
            </ul>
          )}
          {cursor ? (
            <button type="button" className="button more" onClick={() => void load(cursor)}>
              Show more parts
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function Card({ part, category, signedIn, onLike }: { part: GalleryPart; category: string; signedIn: boolean; onLike: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <li className="card" data-ui="part-card">
      <div className="thumb">
        {broken ? (
          <span className="thumb-missing">Preview unavailable</span>
        ) : (
          <img src={`/api/solids/${part.head.geometryDigest}/thumbnail.svg`} alt={`${part.title}, ${part.head.label}`} loading="lazy" onError={() => setBroken(true)} />
        )}
      </div>
      <div className="card-text">
        <Link to={`/parts/${part.slug}`} className="card-title">
          {part.title}
        </Link>
        <p className="muted">{`${part.author.displayName} · ${category}`}</p>
        <p className="muted small">{`${volumeText(part.head.volume)} · ${bboxText(part.head.bbox)}`}</p>
      </div>
      <span className="like-group like-row">
        <button type="button" className="like-toggle" aria-pressed={part.liked} aria-label={`Like ${part.title}`} aria-disabled={signedIn ? undefined : true} aria-describedby={signedIn ? undefined : `like-hint-${part.slug}`} onClick={onLike}>
          <Icon name="heart" size={16} filled={part.liked} />
        </button>
        <span data-ui="like-count">{likeText(part.likes)}</span>
        {signedIn ? null : (
          <span role="tooltip" id={`like-hint-${part.slug}`} className="tooltip">
            Sign in to like parts
          </span>
        )}
      </span>
    </li>
  );
}
