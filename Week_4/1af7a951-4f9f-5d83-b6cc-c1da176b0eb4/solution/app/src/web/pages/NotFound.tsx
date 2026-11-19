import { follow } from "../router";
import { EmptyNightDrawing } from "../ui/icons";

export function NotFound() {
  return (
    <main className="column">
      <div className="empty">
        <EmptyNightDrawing />
        <h1>Page not found</h1>
        <p className="lede">We couldn't find that page.</p>
        <a href="/" onClick={follow}>
          See open cohorts
        </a>
      </div>
    </main>
  );
}
