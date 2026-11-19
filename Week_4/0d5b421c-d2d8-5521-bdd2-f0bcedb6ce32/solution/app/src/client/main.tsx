import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BookingPage } from "./pages/BookingPage.js";
import { HomePage, NotFoundPage } from "./pages/HomePage.js";
import { HostFloorPage } from "./pages/HostFloorPage.js";
import { HostSignInPage } from "./pages/HostSignInPage.js";
import { ManagePage } from "./pages/ManagePage.js";
import { OfferPage } from "./pages/OfferPage.js";
import { WaitlistPage } from "./pages/WaitlistPage.js";
import { useLocation } from "./router.js";
import { StatusProvider } from "./status.js";
import "./styles.css";

function App() {
  const { path, search } = useLocation();
  const manage = /^\/manage\/([^/]+)$/.exec(path);
  const offer = /^\/offer\/([^/]+)$/.exec(path);
  if (path === "/") return <HomePage />;
  if (path === "/book") return <BookingPage />;
  if (path === "/waitlist") return <WaitlistPage search={search} />;
  if (manage?.[1] !== undefined) return <ManagePage key={manage[1]} token={manage[1]} />;
  if (offer?.[1] !== undefined) return <OfferPage key={offer[1]} token={offer[1]} />;
  if (path === "/host/sign-in") return <HostSignInPage search={search} />;
  if (path === "/host") return <HostFloorPage search={search} />;
  return <NotFoundPage />;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StatusProvider>
      <App />
    </StatusProvider>
  </StrictMode>,
);
