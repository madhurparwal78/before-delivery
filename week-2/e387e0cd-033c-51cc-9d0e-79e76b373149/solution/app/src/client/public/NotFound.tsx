// Any unknown page: the server answers 404 with this screen.
import { Heading, Link } from "../router";
import { Icon } from "../ui/Icon";
import { PublicPage } from "./chrome";

export function NotFoundContent() {
  return (
    <section class="public-section notice">
      <Icon name="ring" size={28} />
      <Heading>Page not found</Heading>
      <p class="muted">We couldn't find that page.</p>
      <Link href="/" class="button button-quiet">Go to the directory</Link>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <PublicPage>
      <NotFoundContent />
    </PublicPage>
  );
}
