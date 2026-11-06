import { useEffect, useState, type ReactElement } from 'react';
import { Star } from 'lucide-react';
import { findFlavour, type FlavourSlug } from '../../../shared/catalogue.js';
import { reviewCopy } from '../../../shared/copy.js';
import { ApiCallError, api, type ReviewPayload } from '../api.js';
import { CrateRail } from '../components/CrateRail.js';
import { FlavourCard } from '../components/FlavourCard.js';
import { NotFound } from './NotFound.js';
import { useShop } from '../state/shop.js';
import { useViewport } from '../state/useViewport.js';

const TASTING_NOTES: Readonly<Record<FlavourSlug, { description: string; ingredients: string }>> = {
  'guava-lime': {
    description:
      'Pink guava pressed against a squeeze of Key lime, over cold-brewed mate from shade-grown leaves. The finish is bright and clean, with the faint green hum of the canopy behind it.',
    ingredients:
      'Carbonated water, organic yerba mate infusion, organic guava juice, organic lime juice, organic cane sugar, citric acid, sea salt.',
  },
  'yuzu-ginger': {
    description:
      'Yuzu peel and young ginger, steeped slowly so the heat arrives late. The mate holds the middle, grassy and faintly smoky, and the bubbles stay fine to the last mouthful.',
    ingredients:
      'Carbonated water, organic yerba mate infusion, organic yuzu juice, organic ginger extract, organic cane sugar, ascorbic acid, sea salt.',
  },
  'passionfruit-basil': {
    description:
      'Passionfruit pulp with a handful of sweet basil torn in at the end. Floral at the top, tart underneath, and the mate keeps it from tipping into dessert.',
    ingredients:
      'Carbonated water, organic yerba mate infusion, organic passionfruit juice, organic basil extract, organic cane sugar, citric acid, sea salt.',
  },
  'cacao-orange': {
    description:
      'A limited winter drop: roasted cacao husk steeped with blood-orange peel. Dry, bittersweet and closer to a cold mate chocolate than a soda. Released in small batches.',
    ingredients:
      'Carbonated water, organic yerba mate infusion, organic cacao husk infusion, organic blood-orange juice, organic cane sugar, sea salt.',
  },
};

function Stars({ rating }: { rating: number }): ReactElement {
  return (
    <span className="stars" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden="true"
          size={14}
          fill={step <= rating ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  );
}

export function Flavour({ slug }: { slug: string }): ReactElement {
  const flavour = findFlavour(slug);
  const { user, reviewFeed } = useShop();
  const viewport = useViewport();
  const [reviews, setReviews] = useState<ReviewPayload[]>([]);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (flavour === undefined) return;
    void api
      .get<{ reviews: ReviewPayload[] }>(`/api/flavours/${flavour.slug}/reviews`)
      .then((payload) => setReviews(payload.reviews))
      .catch(() => setReviews([]));
  }, [flavour]);

  if (flavour === undefined) return <NotFound />;

  const live = reviewFeed[flavour.slug] ?? [];
  const known = new Set(reviews.map((review) => review.id));
  const shown = [...live.filter((review) => !known.has(review.id)), ...reviews];
  const notes = TASTING_NOTES[flavour.slug];

  const submit = async () => {
    setStatus('');
    setErrors({});
    try {
      await api.post(`/api/flavours/${flavour.slug}/reviews`, { rating, body });
      setStatus(reviewCopy.success);
      setBody('');
    } catch (error) {
      if (!(error instanceof ApiCallError)) throw error;
      if (error.failure.error === 'not_a_buyer') setStatus(reviewCopy.notBuyer);
      else if (error.failure.error === 'already_reviewed') setStatus(reviewCopy.alreadyReviewed);
      else if (error.failure.fields !== undefined) setErrors(error.failure.fields);
      else setStatus(error.failure.message);
    }
  };

  return (
    <div className="box-page" data-viewport={viewport}>
      <div className="box-page__main">
        <article className="reading">
          <h1>{flavour.name}</h1>
          <p className="reading__lede">{notes.description}</p>

          <h2>Ingredients</h2>
          <p>{notes.ingredients}</p>

          <h2>Add it to your crate</h2>
          <div className="reading__card">
            <FlavourCard slug={flavour.slug} />
          </div>

          <h2>Reviews</h2>
          {shown.length === 0 ? (
            <p>No approved reviews yet.</p>
          ) : (
            <ul className="reviews" aria-label="Reviews">
              {shown.map((review) => (
                <li key={review.id}>
                  <Stars rating={review.rating} />
                  <p className="reviews__body">{review.body}</p>
                  <p className="reviews__author mono">{review.author_first_name}</p>
                </li>
              ))}
            </ul>
          )}

          {user !== null && user.role === 'customer' ? (
            <form
              className="review-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset className="radiogroup">
                <legend>Rating</legend>
                {[1, 2, 3, 4, 5].map((step) => (
                  <label key={step}>
                    <input
                      type="radio"
                      name="rating"
                      value={step}
                      checked={rating === step}
                      onChange={() => setRating(step)}
                    />
                    {step}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="review-body">Your review</label>
                <textarea
                  id="review-body"
                  rows={4}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  aria-describedby={errors.body === undefined ? undefined : 'review-body-error'}
                />
                {errors.body === undefined ? null : (
                  <p className="field__error" id="review-body-error">
                    {errors.body}
                  </p>
                )}
              </div>
              <button type="submit" className="button button--primary">
                Post review
              </button>
              <p role="status" aria-live="polite" aria-label="Review status" className="live-region">
                {status}
              </p>
            </form>
          ) : (
            <p role="status" aria-live="polite" aria-label="Review status" className="live-region">
              {status}
            </p>
          )}
        </article>
      </div>

      <CrateRail />
    </div>
  );
}
