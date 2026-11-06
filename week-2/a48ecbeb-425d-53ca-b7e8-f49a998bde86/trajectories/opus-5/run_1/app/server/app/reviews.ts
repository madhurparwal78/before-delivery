import { flavourName, type FlavourSlug } from '../../shared/catalogue.js';
import { isoTimestamp } from '../../shared/time.js';
import { getUser, listReviews, type PocketBaseReview } from '../services/pocketbase.js';

export interface ReviewPayload {
  id: string;
  rating: number;
  body: string;
  author_first_name: string;
  created_at: string;
}

/** Reviews show the author's first name only. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

function toTimestamp(created: string): string {
  return isoTimestamp(new Date(created.replace(' ', 'T').replace(/Z?$/, 'Z')));
}

async function presentReviews(reviews: readonly PocketBaseReview[]): Promise<ReviewPayload[]> {
  const authors = new Map<string, string>();
  for (const review of reviews) {
    if (authors.has(review.user)) continue;
    authors.set(review.user, firstName((await getUser(review.user))?.name ?? ''));
  }
  return reviews.map((review) => ({
    id: review.id,
    rating: review.rating,
    body: review.body,
    author_first_name: authors.get(review.user) ?? '',
    created_at: toTimestamp(review.created),
  }));
}

export async function approvedReviews(flavour: FlavourSlug): Promise<ReviewPayload[]> {
  return presentReviews(await listReviews({ flavour, status: 'approved' }));
}

export interface PendingReviewPayload extends ReviewPayload {
  flavour: FlavourSlug;
  flavour_name: string;
  status: string;
}

export async function pendingReviews(): Promise<PendingReviewPayload[]> {
  const reviews = await listReviews({ status: 'pending' });
  const presented = await presentReviews(reviews);
  return presented.map((review, index) => ({
    ...review,
    flavour: reviews[index]!.flavour as FlavourSlug,
    flavour_name: flavourName(reviews[index]!.flavour as FlavourSlug),
    status: reviews[index]!.status,
  }));
}
