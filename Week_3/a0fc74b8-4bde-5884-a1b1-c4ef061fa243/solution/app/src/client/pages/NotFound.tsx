import { NOT_FOUND } from "../../shared/copy";
import { Link } from "../lib/router";

export function NotFound() {
  return (
    <div className="notice-page">
      <h1>{NOT_FOUND.heading}</h1>
      <p>{NOT_FOUND.body}</p>
      <p>
        <Link to="/documents" className="textlink">
          Back to documents
        </Link>
      </p>
    </div>
  );
}
