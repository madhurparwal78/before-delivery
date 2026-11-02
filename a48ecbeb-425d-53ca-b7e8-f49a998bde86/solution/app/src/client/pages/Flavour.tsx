import { Star } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { CanArt } from "../can/CanArt";
import { FLAVOUR_COPY } from "../can/flavours";
import { Crate } from "../crate/Crate";
import { api, ApiFailure } from "../lib/api";
import { Link } from "../lib/router";
import { FLAVOUR_NAMES, money } from "../../shared/format";
import { useCrateDrop } from "../state/crate";
import { useShop, type LiveReview } from "../state/shop";
import { StockNotices } from "./Box";

type Review = LiveReview["review"];

const REVIEW_COPY: Record<string, string> = {
  not_a_buyer: "Only customers who bought this flavour can review it.",
  already_reviewed: "You've already reviewed this flavour.",
};

function ReviewForm({ slug }: { slug: string }) {
  const { user } = useShop();
  const id = useId();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!user || user.role !== "customer") {
    return (
      <p className="muted">
        <Link href={`/sign-in?next=/flavours/${slug}`}>Sign in</Link> to review a flavour you've bought.
      </p>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api("POST", `/api/flavours/${slug}/reviews`, { rating, body });
      setStatus("Thanks. Your review will appear once it's approved.");
      setBody("");
      setRating(0);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "validation") {
        setErrors(error.body.fields ?? {});
        setStatus("");
      } else if (error instanceof ApiFailure) setStatus(REVIEW_COPY[error.code] ?? error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="review-form" onSubmit={submit} noValidate>
      <h3>Write a review</h3>
      <div role="radiogroup" aria-label="Rating" className="rating-group" aria-describedby={errors.rating ? `${id}-rating-error` : undefined}>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="rating-star">
            <input type="radio" name={`${id}-rating`} value={n} checked={rating === n} onChange={() => setRating(n)} />
            <Star size={22} aria-hidden="true" fill={n <= rating ? "currentColor" : "none"} />
            <span className="sr-only">{n === 1 ? "1 star" : `${n} stars`}</span>
          </label>
        ))}
      </div>
      {errors.rating && (
        <p className="field-error" id={`${id}-rating-error`}>
          {errors.rating}
        </p>
      )}
      <div className="field">
        <label htmlFor={`${id}-body`}>Your review</label>
        <textarea
          id={`${id}-body`}
          value={body}
          maxLength={1000}
          onChange={(event) => setBody(event.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? `${id}-body-error` : undefined}
        />
        {errors.body && (
          <p className="field-error" id={`${id}-body-error`}>
            {errors.body}
          </p>
        )}
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Post review
      </button>
      <p className="status-line" role="status" aria-label="Review status">
        {status}
      </p>
    </form>
  );
}

export function FlavourPage({ slug }: { slug: string }) {
  const { flavours, onReview, watchLive, liveOpened } = useShop();
  useEffect(watchLive, [watchLive]);
  const { add } = useCrateDrop();
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const flavour = flavours?.find((f) => f.slug === slug);
  const copy = FLAVOUR_COPY[slug];
  const name = FLAVOUR_NAMES[slug];

  // Read on arrival and again each time the live feed (re)opens, keeping any review that arrived live meanwhile.
  useEffect(() => {
    let current = true;
    api<{ reviews: Review[] }>("GET", `/api/flavours/${slug}/reviews`)
      .then((body) => {
        if (!current) return;
        setReviews((list) => [...(list ?? []).filter((r) => !body.reviews.some((b) => b.id === r.id)), ...body.reviews]);
      })
      .catch(() => {
        if (current) setReviews((list) => list ?? []);
      });
    return () => {
      current = false;
    };
  }, [slug, liveOpened]);

  useEffect(() => {
    setReviews(null);
    return onReview((event) => {
      if (event.flavour !== slug) return;
      setReviews((list) => (list?.some((r) => r.id === event.review.id) ? list : [event.review, ...(list ?? [])]));
    });
  }, [slug, onReview]);

  return (
    <div className="shop-layout">
      <div className="shop-main">
        <nav className="flavour-tabs" aria-label="Flavours">
          {Object.entries(FLAVOUR_NAMES).map(([s, n]) => (
            <Link key={s} href={`/flavours/${s}`} aria-current={s === slug ? "page" : undefined} className={`flavour-tab flavour-${s}`}>
              {n}
            </Link>
          ))}
        </nav>
        <article className={`reading flavour-${slug}`}>
          <div className="reading-hero">
            <CanArt flavour={slug} className="reading-can" />
            <div>
              <h1>{name}</h1>
              <p className="lede">{copy.tagline}</p>
              {flavour && (
                <p className="card-figures">
                  <span className="num card-price">{money(flavour.can_price_cents)}</span>
                  <span className="card-per">per can</span>
                  <span className="num card-left">{`${flavour.stock_left} left`}</span>
                </p>
              )}
              <StockNotices />
              <div className="card-actions">
                <button type="button" className="btn btn-primary" aria-label={`Add ${name}`} onClick={(e) => add(slug, e.currentTarget)}>
                  Add
                </button>
                <button type="button" className="btn btn-cream" aria-label={`Fill crate with ${name}`} onClick={(e) => add(slug, e.currentTarget, true)}>
                  Fill crate
                </button>
              </div>
            </div>
          </div>
          <div className="reading-column panel">
            {copy.description.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <h2 className="reading-sub">Ingredients</h2>
            <p>{copy.ingredients}</p>
            <p className="muted">About 80 mg of caffeine from mate leaves and 30 calories or fewer per can.</p>
            <h2 className="reading-sub">Reviews</h2>
            {reviews === null && <div className="skeleton" style={{ height: 64 }} aria-hidden="true" />}
            <ul className="reviews" aria-label="Reviews">
              {(reviews ?? []).map((r) => (
                <li key={r.id} className="review">
                  <span className="review-stars" role="img" aria-label={`${r.rating} out of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={16} aria-hidden="true" fill={n <= r.rating ? "currentColor" : "none"} />
                    ))}
                  </span>
                  <p>{r.body}</p>
                  <p className="muted">{r.author_first_name}</p>
                </li>
              ))}
            </ul>
            {reviews !== null && reviews.length === 0 && <p className="muted">No reviews yet. Bought this flavour? Tell others what you think.</p>}
            <ReviewForm slug={slug} />
          </div>
        </article>
      </div>
      <Crate />
    </div>
  );
}
