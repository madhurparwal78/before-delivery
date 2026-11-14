import { EmptyState } from "../components/Feedback";
import { Link } from "../router";

export function NotFound() {
  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">We could not find that page.</h1>
        <EmptyState>Nothing lives at this address.</EmptyState>
        <p className="page__back">
          <Link className="pill pill--cobalt" to="/courts">
            Back to Courts
          </Link>
        </p>
      </div>
    </div>
  );
}

export function WrongRole() {
  return (
    <div className="page">
      <div className="column">
        <h1 className="page__title">This page is not for your role.</h1>
        <EmptyState>Ask the club desk if you need access.</EmptyState>
        <p className="page__back">
          <Link className="pill pill--cobalt" to="/">
            Back to the club home
          </Link>
        </p>
      </div>
    </div>
  );
}
