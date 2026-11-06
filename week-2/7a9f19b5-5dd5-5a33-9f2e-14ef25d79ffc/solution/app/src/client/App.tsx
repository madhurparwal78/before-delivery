import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { LightingDial } from "./components/LightingDial";
import { useLocation } from "./lib/router";
import { Account } from "./pages/Account";
import { Admin } from "./pages/Admin";
import { Cart } from "./pages/Cart";
import { Catalogue } from "./pages/Catalogue";
import { Checkout } from "./pages/Checkout";
import { Compare } from "./pages/Compare";
import { Favourites } from "./pages/Favourites";
import { Home } from "./pages/Home";
import { NewsletterConfirm } from "./pages/NewsletterConfirm";
import { NotFound } from "./pages/NotFound";
import { OrderPage } from "./pages/OrderPage";
import { Product } from "./pages/Product";
import { Projects } from "./pages/Projects";

const ProjectPage = lazy(() => import("./pages/Project").then((module) => ({ default: module.ProjectPage })));
const SignIn = lazy(() => import("./pages/Auth").then((module) => ({ default: module.SignIn })));
const SignUp = lazy(() => import("./pages/Auth").then((module) => ({ default: module.SignUp })));

function route(path: string): ReactNode {
  const [, first, second] = path.split("/");
  switch (first) {
    case "":
      return <Home />;
    case "catalogue":
      return <Catalogue />;
    case "compare":
      return <Compare />;
    case "products":
      return second ? <Product key={second} slug={decodeURIComponent(second)} /> : <NotFound />;
    case "favourites":
      return <Favourites />;
    case "cart":
      return <Cart />;
    case "checkout":
      return <Checkout />;
    case "orders":
      return second ? <OrderPage key={second} orderKey={decodeURIComponent(second)} /> : <NotFound />;
    case "signin":
      return <SignIn />;
    case "signup":
      return <SignUp />;
    case "account":
      return <Account />;
    case "projects":
      return second ? <ProjectPage key={second} id={decodeURIComponent(second)} /> : <Projects />;
    case "admin":
      return <Admin />;
    case "newsletter":
      return second === "confirm" ? <NewsletterConfirm /> : <NotFound />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const { path } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // After an in-app navigation, focus moves to the new page so keyboard and screen-reader users start there.
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
  }, [path]);
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="grid-overlay" aria-hidden="true" />
      <Header />
      <main id="main" ref={main} tabIndex={-1} className="site-main">
        <Suspense fallback={<div className="page-loading" />}>{route(path)}</Suspense>
      </main>
      <Footer />
      <LightingDial />
      <div id="docks" />
    </>
  );
}
