import { Outlet, useLocation } from "react-router-dom";
import Consent from "./Consent.jsx";
import Footer from "./Footer.jsx";
import Header from "./Header.jsx";

// Every marketing route renders the same header, footer and consent card from here; the sign-in chooser
// sets them on its near-black ground.
export default function MarketingLayout() {
  const { pathname } = useLocation();
  return (
    <div className={pathname === "/signin" ? "site site-dark" : "site"}>
      <Header />
      <main id="main">
        <Outlet />
      </main>
      <Footer />
      <Consent />
    </div>
  );
}
