import { MapPin, Search, ShoppingCart, User } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signInHref, useAuth } from "../lib/auth";
import { useCart } from "../lib/cart";
import { usePincode } from "../lib/pincode";
import { PincodeDialog } from "./PincodeDialog";

const STAFF_LINKS: Record<"seller" | "support", { to: string; label: string }[]> = {
  seller: [
    { to: "/seller/listings", label: "Listings" },
    { to: "/seller/stock", label: "Stock" },
    { to: "/seller/shipments", label: "Shipments" },
    { to: "/seller/returns", label: "Returns" },
    { to: "/seller/statement", label: "Statement" },
  ],
  support: [{ to: "/support", label: "Order lookup" }],
};

export function Header(): ReactNode {
  const auth = useAuth();
  const cart = useCart();
  const { pin } = usePincode();
  const location = useLocation();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(false);
  const onSearch = location.pathname === "/search";
  const [text, setText] = useState(() => (onSearch ? (new URLSearchParams(location.search).get("q") ?? "") : ""));

  useEffect(() => {
    if (onSearch) setText(new URLSearchParams(location.search).get("q") ?? "");
  }, [onSearch, location.search]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const params = new URLSearchParams(onSearch ? location.search : "");
    params.delete("cursor");
    if (text.trim() === "") params.delete("q");
    else params.set("q", text.trim());
    navigate(`/search${params.size > 0 ? `?${params}` : ""}`);
  };

  const role = auth.account?.role;
  const here = `${location.pathname}${location.search}`;

  return (
    <header className="header">
      <Link to="/" className="header__logo">
        chauraha bazaar
      </Link>
      <form className="header__search" role="search" onSubmit={submit}>
        <input type="search" aria-label="Search Chauraha" placeholder="search the bazaar" value={text} onChange={(event) => setText(event.target.value)} id="site-search" />
        <button type="submit" className="btn btn--yellow btn--icon" aria-label="Search">
          <Search size={22} aria-hidden="true" />
        </button>
      </form>
      <div className="header__actions">
        <button type="button" className="btn btn--small" aria-label={pin ? `Deliver to ${pin}` : "Deliver to: set pincode"} onClick={() => setDialog(true)}>
          <MapPin size={20} aria-hidden="true" />
          {pin ? `deliver to ${pin}` : "set pincode"}
        </button>
        {role !== "seller" && role !== "support" && (
          <Link to="/cart" className="btn btn--small">
            <ShoppingCart size={20} aria-hidden="true" />
            cart
            {cart.count > 0 && <span className="badge">{cart.count}</span>}
          </Link>
        )}
        {auth.status === "signedIn" ? (
          <button type="button" className="btn btn--small" onClick={() => navigate("/account")}>
            <User size={20} aria-hidden="true" />
            Account
          </button>
        ) : (
          auth.status === "signedOut" && (
            <>
              <Link to={signInHref(here)} className="btn btn--small btn--yellow">
                Sign in
              </Link>
              <Link to="/signup" className="btn btn--small">
                Sign up
              </Link>
            </>
          )
        )}
      </div>
      {(role === "seller" || role === "support") && (
        <nav className="header__nav" aria-label="Console">
          {STAFF_LINKS[role].map((link) => (
            <Link key={link.to} to={link.to} className="btn btn--small">
              {link.label}
            </Link>
          ))}
        </nav>
      )}
      {dialog && <PincodeDialog onClose={() => setDialog(false)} />}
    </header>
  );
}
