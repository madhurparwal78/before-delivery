import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders, useRouter } from "./state/app.js";
import { CompareTray, Footer, Header, LightingDial } from "./components/Shell.js";
import { CataloguePage } from "./pages/Catalogue.js";
import { ProductPage } from "./pages/Product.js";
import { CheckoutPage, OrderPage } from "./pages/Checkout.js";
import { ProjectsPage } from "./pages/Projects.js";
import { ProjectPage } from "./pages/Project.js";
import { AdminPage } from "./pages/Admin.js";
import {
  AccountPage,
  CartPage,
  ComparePage,
  FavouritesPage,
  HomePage,
  NewsletterConfirmPage,
  SignInPage,
  SignUpPage,
} from "./pages/Simple.js";
import "./styles.css";

function Routes() {
  const { path } = useRouter();

  if (path === "/") return <HomePage />;
  if (path === "/catalogue") return <CataloguePage />;
  if (path === "/compare") return <ComparePage />;
  if (path === "/favourites") return <FavouritesPage />;
  if (path === "/cart") return <CartPage />;
  if (path === "/checkout") return <CheckoutPage />;
  if (path === "/signin") return <SignInPage />;
  if (path === "/signup") return <SignUpPage />;
  if (path === "/account") return <AccountPage />;
  if (path === "/projects") return <ProjectsPage />;
  if (path === "/admin") return <AdminPage />;
  if (path === "/newsletter/confirm") return <NewsletterConfirmPage />;

  const product = /^\/products\/([^/]+)$/.exec(path);
  if (product) return <ProductPage slug={decodeURIComponent(product[1] as string)} />;

  const order = /^\/orders\/([^/]+)$/.exec(path);
  if (order) return <OrderPage orderKey={decodeURIComponent(order[1] as string)} />;

  const project = /^\/projects\/([^/]+)$/.exec(path);
  if (project) return <ProjectPage id={decodeURIComponent(project[1] as string)} />;

  return (
    <div className="wrap section">
      <h1>Page not found</h1>
      <p className="muted">That page is not part of Lightfall.</p>
    </div>
  );
}

function App() {
  return (
    <div className="shell">
      <Header />
      <main className="page">
        <Routes />
      </main>
      <Footer />
      <CompareTray />
      <LightingDial />
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("the application root is missing");

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
