import { get } from "../api";
import { ReviewArticle } from "../components/ReviewArticle";
import { useLoad } from "../hooks";
import { Link } from "../router";
import { useSession } from "../session";
import { Loading, NotFound, Screen } from "../shell/Page";
import type { Review } from "../../shared/api";

export function ReviewLink({ slug, id }: { slug: string; id: string }) {
  const { me } = useSession();
  const review = useLoad(() => get<Review>(`/api/companies/${slug}/reviews/${id}`), [slug, id, me?.id]);
  if (review.failure?.status === 404) return <NotFound />;
  if (!review.data) return <Loading />;
  return (
    <Screen title={review.data.title} narrow>
      <p>
        <Link to={`/companies/${slug}`}>Back to the company page</Link>
      </p>
      <div className="reviews">
        <ReviewArticle review={review.data} />
      </div>
    </Screen>
  );
}
