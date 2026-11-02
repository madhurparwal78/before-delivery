import { Check, Star, X } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { FLAVOUR_NAMES, longDateTime } from "../../shared/format";
import { EmptyCrate, failureOf, Loading, PageFailure, useOfficeData } from "./shared";

// Reviews waiting for the owner's decision; each is approved or rejected once.

interface PendingReview {
  id: string;
  flavour: string;
  rating: number;
  body: string;
  author_first_name: string;
  created_at: string;
}

export function Reviews() {
  const { data, setData, failure } = useOfficeData<{ reviews: PendingReview[] }>("/api/owner/reviews?status=pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const decide = async (review: PendingReview, decision: "approved" | "rejected") => {
    setBusy(review.id);
    try {
      await api<{ review: { id: string } }>("POST", `/api/owner/reviews/${review.id}/decision`, { decision });
      setData((prev) => prev && { reviews: prev.reviews.filter((r) => r.id !== review.id) });
      setStatus(`Review by ${review.author_first_name}: ${decision === "approved" ? "Approved" : "Rejected"}.`);
    } catch (error) {
      setStatus(failureOf(error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="office-page">
      <h1>Reviews</h1>
      <p role="status" aria-label="Review decisions" className="status-line">
        {status}
      </p>
      {failure && !data && <PageFailure failure={failure} />}
      {!data && !failure && <Loading />}
      {data && data.reviews.length === 0 && (
        <div className="empty">
          <EmptyCrate />
          <p>No reviews are waiting.</p>
        </div>
      )}
      {data && data.reviews.length > 0 && (
        <ul className="card-list">
          {data.reviews.map((review) => (
            <li key={review.id}>
              <article aria-labelledby={`review-${review.id}`} className="office-card">
                <div className="office-card-head">
                  <h2 id={`review-${review.id}`}>{FLAVOUR_NAMES[review.flavour] ?? review.flavour}</h2>
                  <span className="badge rating">
                    <Star size={14} aria-hidden="true" />
                    <span className="num">{review.rating}</span> of 5
                  </span>
                </div>
                <blockquote className="review-body">{review.body}</blockquote>
                <p className="muted">
                  {review.author_first_name}, <span className="num">{longDateTime(new Date(review.created_at))}</span>
                </p>
                <div className="card-actions" aria-busy={busy === review.id}>
                  <button type="button" className="btn btn-primary" disabled={busy === review.id} onClick={() => void decide(review, "approved")}>
                    <Check size={18} aria-hidden="true" />
                    Approve review
                  </button>
                  <button type="button" className="btn btn-secondary" disabled={busy === review.id} onClick={() => void decide(review, "rejected")}>
                    <X size={18} aria-hidden="true" />
                    Reject review
                  </button>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
