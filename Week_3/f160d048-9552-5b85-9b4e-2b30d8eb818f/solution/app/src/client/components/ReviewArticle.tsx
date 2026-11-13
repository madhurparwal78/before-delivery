import type { ReactNode } from "react";
import { monthYear, PREVIEW_CHARS } from "../../shared/reference";
import type { Review } from "../../shared/api";

const rating = (value: number): string => value.toFixed(1);

function cutText(text: string, truncated: boolean): string {
  return truncated && Array.from(text).length >= PREVIEW_CHARS ? `${text}…` : text;
}

/** One review, set as a plain quote: title, ratings, month, anonymous label, pros, cons and any employer reply. */
export function ReviewArticle({ review, children }: { review: Review; children?: ReactNode }) {
  return (
    <article className="review" data-id={review.id}>
      <h3 className="title">{review.title}</h3>
      <p className="scores figure">
        Overall {rating(review.overall)} · Work-life balance {rating(review.work_life)} · Pay {rating(review.pay)} · Management {rating(review.management)}
      </p>
      <p className="meta">
        {review.author_label} · {monthYear(review.posted_month)}
      </p>
      <p className="body">
        <span className="label">Pros </span>
        {cutText(review.pros, review.truncated)}
      </p>
      <p className="body">
        <span className="label">Cons </span>
        {cutText(review.cons, review.truncated)}
      </p>
      {review.reply ? (
        <section className="reply" aria-label={`Response from ${review.reply.company_name}`}>
          <p className="meta">
            {review.reply.company_name} replied in {monthYear(review.reply.posted_month)}
          </p>
          <p>{review.reply.body}</p>
        </section>
      ) : null}
      {children}
    </article>
  );
}
