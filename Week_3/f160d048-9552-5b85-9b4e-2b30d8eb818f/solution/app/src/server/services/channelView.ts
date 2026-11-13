import { rows } from "../db/pool";
import { excerptOf, postedMonth } from "../domain/anonymity";
import { reviewPathIn } from "../domain/contact";
import { ANONYMOUS_LABEL } from "../../shared/reference";
import type { ChannelPost } from "../../shared/api";

export type ChannelPostRow = { id: string; channel_slug: string; body: string; created_at: Date };

type Quoted = { id: string; title: string; pros: string; state: string; deleted: boolean; slug: string };

/** Channel posts as members see them: anonymous, with a quote of any review the body links to. */
export async function viewChannelPosts(posts: ChannelPostRow[]): Promise<ChannelPost[]> {
  const paths = posts.map((post) => reviewPathIn(post.body));
  const ids = paths.flatMap((path) => (path ? [path.id] : []));
  const quoted =
    ids.length === 0
      ? []
      : await rows<Quoted>(
          `SELECT p.id, p.title, p.pros, p.state, (p.deleted_at IS NOT NULL) AS deleted, c.slug
             FROM posts p JOIN companies c ON c.id = p.company_id WHERE p.kind = 'review' AND p.id = ANY($1)`,
          [ids],
        );
  return posts.map((post, index) => {
    const path = paths[index];
    const review = path ? quoted.find((entry) => entry.id === path.id && entry.slug === path.slug) : undefined;
    return {
      id: post.id,
      channel_slug: post.channel_slug,
      body: post.body,
      posted_month: postedMonth(post.created_at),
      author_label: ANONYMOUS_LABEL,
      quote: !review
        ? null
        : review.deleted || review.state !== "approved"
          ? { removed: true }
          : { review_id: review.id, company_slug: review.slug, title: review.title, excerpt: excerptOf(review.pros) },
    };
  });
}
