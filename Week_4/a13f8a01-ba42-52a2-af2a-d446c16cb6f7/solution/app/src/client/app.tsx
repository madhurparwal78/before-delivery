import { AccountProvider } from "./account.js";
import { CollectionPage, CollectionsPage } from "./pages/collections.js";
import { SigninPage, SignupPage, VerifyPage } from "./pages/accounts.js";
import { DashboardPage } from "./pages/dashboard.js";
import { EditorPage } from "./pages/editor.js";
import { EmbedPage } from "./pages/embed.js";
import { ExplorePage } from "./pages/explore.js";
import { HistoryPage } from "./pages/history.js";
import { LandingPage } from "./pages/landing.js";
import { NotFound } from "./pages/not-found.js";
import { ShelfPage } from "./pages/shelf.js";
import { usePath } from "./router.js";

const ID = "([a-z0-9]{10})";

function page(path: string): React.JSX.Element {
  const match = (pattern: string): RegExpExecArray | null => new RegExp(`^${pattern}$`).exec(path);
  const simple: Record<string, () => React.JSX.Element> = {
    "/": LandingPage,
    "/signup": SignupPage,
    "/signin": SigninPage,
    "/verify": VerifyPage,
    "/dashboard": DashboardPage,
    "/explore": ExplorePage,
    "/collections": CollectionsPage,
    "/shelf": ShelfPage,
  };
  const Simple = simple[path];
  if (Simple) return <Simple />;
  const collection = match(`/collections/${ID}`)?.[1];
  if (collection) return <CollectionPage key={collection} id={collection} />;
  const history = match(`/pen/${ID}/history`)?.[1];
  if (history) return <HistoryPage key={history} id={history} />;
  const pen = match(`/pen/${ID}`)?.[1];
  if (pen) return <EditorPage key={pen} id={pen} />;
  const embed = match(`/embed/${ID}`)?.[1];
  if (embed) return <EmbedPage key={embed} id={embed} />;
  return <NotFound />;
}

export function App(): React.JSX.Element {
  const path = usePath();
  return <AccountProvider>{page(path)}</AccountProvider>;
}
