// The not-found page (brief: Feedback states).
import { copy } from "../../shared/copy";
import { Icon } from "../icons";

export function NotFound() {
  return (
    <main class="plain-page">
      <div class="plain-card">
        <Icon name="compass" size={28} />
        <h1>{copy.notFoundHeading}</h1>
        <p>{copy.notFoundText}</p>
        <a class="text-link" href="/">Your diagrams</a>
      </div>
    </main>
  );
}
