/**
 * Home, comparison, favourites, cart, sign-in, sign-up, the account banner and the
 * newsletter confirmation page.
 */

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { AUTH, CATALOGUE, NEWSLETTER, OCCUPATION_OPTIONS, PRODUCT } from "../../shared/copy.js";
import { MONEY_LABELS } from "../../shared/gst.js";
import { formatMoney } from "../../shared/money.js";
import { PRODUCT_PAGE_CEILING_MM } from "../../shared/lightpool.js";
import { tierPriceCents } from "../../shared/projection.js";
import type { ComparisonItem, FavouriteItem, Order, Product } from "../../shared/types.js";
import { useAnnouncer, useCart, useRouter, useSession, useTray } from "../state/app.js";
import { AppLink } from "../components/Shell.js";
import { PriceLine, StockBadge } from "../components/ProductCard.js";
import { ProductViewer, sceneAmbient } from "../three/ProductViewer.js";

/* ---------- home ---------- */

export function HomePage() {
  const { lightState } = useSession();
  const [featured, setFeatured] = useState<Product | null>(null);

  useEffect(() => {
    void api
      .product("kauri-downlight")
      .then(({ product }) => setFeatured(product))
      .catch(() => setFeatured(null));
  }, []);

  const variant = featured
    ? (featured.variants.find((v) => v.code === featured.default_variant) ?? featured.variants[0])
    : null;

  return (
    <>
      <section className="hero">
        <div className="hero-stage">
          {featured && variant && (
            <ProductViewer
              productName={featured.name}
              family={featured.family}
              slug={featured.slug}
              finish={variant.finish}
              beamDeg={variant.beam_deg}
              cctK={variant.cct_k}
              ambient={sceneAmbient(lightState)}
            />
          )}
        </div>
        <div className="hero-overlay">
          <div className="wrap">
            <h1>Specify the light, not the fitting</h1>
            <p>
              {"Architectural luminaires made in \u014ctautahi, with every beam, finish and colour "}
              {"temperature tested in a room before it reaches the ceiling."}
            </p>
            <div className="row">
              <AppLink to="/catalogue" className="button button-primary">
                Browse the catalogue
              </AppLink>
              <AppLink to="/signup" className="button">
                Apply for a trade account
              </AppLink>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------- comparison ---------- */

export function ComparePage() {
  const { search } = useRouter();
  const [items, setItems] = useState<ComparisonItem[] | null>(null);

  useEffect(() => {
    const codes = (new URLSearchParams(search).get("codes") ?? "")
      .split(",")
      .map((code) => code.trim())
      .filter(Boolean);
    if (codes.length === 0) {
      setItems([]);
      return;
    }
    void api
      .compare(codes)
      .then(({ items: loaded }) => setItems(loaded))
      .catch(() => setItems([]));
  }, [search]);

  const rows: ReadonlyArray<{ label: string; render: (item: ComparisonItem) => string }> = [
    { label: "Product", render: (item) => item.product_name },
    { label: "Code", render: (item) => item.code },
    { label: "Finish", render: (item) => item.finish_name },
    { label: "Beam", render: (item) => `${item.beam_deg}\u00b0` },
    { label: "Colour temperature", render: (item) => `${item.cct_k}K` },
    { label: "Lumens", render: (item) => `${item.lumens} lumens` },
    { label: "Candela", render: (item) => `${item.candela} cd` },
    { label: "Watts", render: (item) => `${item.watts} W` },
    { label: "CRI", render: (item) => String(item.cri) },
    { label: "IP rating", render: (item) => item.ip_rating },
    { label: "Price", render: (item) => CATALOGUE.priceLine(tierPriceCents(item)) },
    { label: `Pool at 2.7 m`, render: (item) => `${item.pool_diameter_mm_at_2700} mm` },
    { label: `Centre at 2.7 m`, render: (item) => `${item.centre_lux_at_2700} lux` },
  ];

  return (
    <div className="wrap section">
      <h1>Comparison</h1>
      {items && items.length === 0 ? (
        <p className="muted">Add fittings to the comparison tray to compare them side by side.</p>
      ) : (
        <div className="table-frame">
          <table aria-label="Comparison">
            <thead>
              <tr>
                <th scope="col">Spec</th>
                {(items ?? []).map((item) => (
                  <th scope="col" key={item.code}>
                    {item.product_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  {(items ?? []).map((item) => (
                    <td key={item.code} className="numeric">
                      {row.render(item)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ marginTop: 12 }}>
        {`Pool and centre figures are measured at a ${PRODUCT_PAGE_CEILING_MM / 1000} m ceiling height.`}
      </p>
    </div>
  );
}

/* ---------- favourites ---------- */

export function FavouritesPage() {
  const { user } = useSession();
  const tray = useTray();
  const { message, announce } = useAnnouncer();
  const [items, setItems] = useState<FavouriteItem[] | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setItems([]);
      return;
    }
    const { items: loaded } = await api.favourites();
    setItems(loaded);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <div className="wrap section">
        <h1>Favourites</h1>
        <p className="muted">{PRODUCT.signInToSave}</p>
        <AppLink to="/signin" className="button">
          Sign in
        </AppLink>
      </div>
    );
  }

  return (
    <div className="wrap section">
      <h1>Favourites</h1>
      <p role="status" aria-label="Product updates" className="small muted">
        {message}
      </p>
      {items && items.length === 0 && <p className="muted">Nothing saved yet.</p>}
      <div className="card-grid">
        {(items ?? []).map((item) => (
          <article className="card" key={item.code} aria-label={item.product_name}>
            <div className="card-body">
              <AppLink to={`/products/${item.product_slug}?variant=${item.code}`} className="card-title">
                {item.product_name}
              </AppLink>
              <span className="small numeric muted">{item.code}</span>
              <PriceLine variant={item} />
              <StockBadge variant={item} />
              <div className="card-actions">
                <button
                  type="button"
                  className="button button-quiet small"
                  aria-pressed={tray.has(item.code)}
                  onClick={() => {
                    const accepted = tray.add({
                      code: item.code,
                      productName: item.product_name,
                      productSlug: item.product_slug,
                    });
                    announce(accepted ? PRODUCT.addedToComparison : PRODUCT.comparisonFull);
                  }}
                >
                  {`Compare ${item.product_name}`}
                </button>
                <button
                  type="button"
                  className="button button-quiet small"
                  aria-pressed
                  onClick={() => {
                    void api.removeFavourite(item.code).then(() => {
                      announce(PRODUCT.removedFromFavourites);
                      return load();
                    });
                  }}
                >
                  {`Save ${item.product_name}`}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- cart ---------- */

export function OrderTotals({ order }: { order: Pick<Order, "subtotal_cents" | "gst_cents" | "total_cents"> }) {
  return (
    <div className="totals">
      <div className="totals-row">
        <span>{MONEY_LABELS.subtotal}</span>
        <span>{formatMoney(order.subtotal_cents)}</span>
      </div>
      <div className="totals-row">
        <span>{MONEY_LABELS.gst}</span>
        <span>{formatMoney(order.gst_cents)}</span>
      </div>
      <div className="totals-row total">
        <span>{MONEY_LABELS.total}</span>
        <span>{formatMoney(order.total_cents)}</span>
      </div>
    </div>
  );
}

export function CartPage() {
  const { user } = useSession();
  const cart = useCart();
  const { message, announce } = useAnnouncer();

  if (!user) {
    return (
      <div className="wrap section">
        <h1>Cart</h1>
        <p className="muted">Sign in to start a cart.</p>
        <AppLink to="/signin" className="button">
          Sign in
        </AppLink>
      </div>
    );
  }

  const order = cart.order;

  const setQuantity = async (code: string, quantity: number): Promise<void> => {
    try {
      const { order: updated } = await api.setCartLine(code, quantity);
      cart.setOrder(updated);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === "insufficient_stock") {
        announce(PRODUCT.onlyNLeft(Number(error.failure.extra.available ?? 0)));
      }
    }
  };

  return (
    <div className="wrap section">
      <h1>Cart</h1>
      <p role="status" className="small muted">
        {message}
      </p>

      {!order || order.lines.length === 0 ? (
        <p className="muted">Your cart is empty.</p>
      ) : (
        <>
          <div className="table-frame">
            <table aria-label="Cart">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Fitting</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Line total</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => (
                  <tr key={line.variant_code}>
                    <td className="numeric">{line.variant_code}</td>
                    <td>{line.product_name}</td>
                    <td>
                      <label className="visually-hidden" htmlFor={`qty-${line.variant_code}`}>
                        {`Quantity for ${line.variant_code}`}
                      </label>
                      <input
                        id={`qty-${line.variant_code}`}
                        type="number"
                        min={0}
                        max={999}
                        value={line.quantity}
                        style={{ maxWidth: 90 }}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next) && next >= 0) void setQuantity(line.variant_code, next);
                        }}
                      />
                    </td>
                    <td className="numeric">{formatMoney(line.line_total_cents)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-quiet small"
                        onClick={() => void setQuantity(line.variant_code, 0)}
                      >
                        {`Remove ${line.variant_code}`}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="framed" style={{ marginTop: 20, maxWidth: 420 }}>
            <OrderTotals order={order} />
            <div className="dialog-actions">
              <AppLink to="/checkout" className="button button-primary">
                Checkout
              </AppLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- sign in ---------- */

export function SignInPage() {
  const { setUser } = useSession();
  const { navigate } = useRouter();
  const cart = useCart();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api.signin({ email: email.trim(), password });
      setUser(user);
      await cart.refresh();
      // Sign-in goes back to the previous page.
      if (history.length > 1) history.back();
      else navigate("/");
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(AUTH.signInFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap section">
      <div className="grid">
        <div style={{ gridColumn: "span 5" }}>
          <h1>Sign in</h1>
          <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
            <div className="field">
              <label htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="signin-password">Password</label>
              <input
                id="signin-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error !== "" && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? AUTH.signingIn : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------- sign up ---------- */

export function SignUpPage() {
  const { setUser } = useSession();
  const { navigate } = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"retail" | "trade">("retail");
  const [businessName, setBusinessName] = useState("");
  const [nzbn, setNzbn] = useState("");
  const [occupation, setOccupation] = useState("electrician");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api.signup({
        email: email.trim(),
        password,
        name: name.trim(),
        account_type: accountType,
        ...(accountType === "trade"
          ? { trade: { business_name: businessName.trim(), nzbn: nzbn.trim(), occupation } }
          : {}),
      });
      setUser(user);
      navigate("/account");
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.failure.code === "email_taken") setError(AUTH.emailTaken);
      else if (failure.field("nzbn")) setError(AUTH.nzbnInvalid);
      else if (failure.field("password")) setError(AUTH.passwordTooShort);
      else setError(AUTH.emailTaken);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap section">
      <div className="grid">
        <div style={{ gridColumn: "span 5" }}>
          <h1>Create an account</h1>
          <form className="stack" onSubmit={(event) => void submit(event)} noValidate>
            <div className="field">
              <label htmlFor="signup-name">Name</label>
              <input id="signup-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="signup-email">Email</label>
              <input id="signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="signup-password">Password</label>
              <input
                id="signup-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <fieldset className="radio-set" role="radiogroup" aria-label="Account type">
              <legend>Account type</legend>
              <label className="chip">
                <input
                  type="radio"
                  name="account_type"
                  checked={accountType === "retail"}
                  onChange={() => setAccountType("retail")}
                />
                <span>Retail customer</span>
              </label>
              <label className="chip">
                <input
                  type="radio"
                  name="account_type"
                  checked={accountType === "trade"}
                  onChange={() => setAccountType("trade")}
                />
                <span>Trade</span>
              </label>
            </fieldset>

            {/* Trade fields are shown only for Trade. */}
            {accountType === "trade" && (
              <>
                <div className="field">
                  <label htmlFor="signup-business">Business name</label>
                  <input
                    id="signup-business"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="signup-nzbn">NZBN</label>
                  <input
                    id="signup-nzbn"
                    type="text"
                    inputMode="numeric"
                    value={nzbn}
                    onChange={(e) => setNzbn(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="signup-occupation">Occupation</label>
                  <select
                    id="signup-occupation"
                    value={occupation}
                    onChange={(e) => setOccupation(e.target.value)}
                  >
                    {OCCUPATION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            {error !== "" && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? AUTH.creatingAccount : "Create account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------- account ---------- */

export function AccountPage() {
  const { user } = useSession();
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    if (!user) return;
    void api
      .orders()
      .then(({ orders: loaded }) => setOrders(loaded))
      .catch(() => setOrders([]));
  }, [user]);

  if (!user) {
    return (
      <div className="wrap section">
        <h1>Account</h1>
        <AppLink to="/signin" className="button">
          Sign in
        </AppLink>
      </div>
    );
  }

  const banner =
    user.trade_status === "submitted"
      ? AUTH.tradePending
      : user.trade_status === "declined"
        ? AUTH.tradeDeclined
        : "";

  return (
    <div className="wrap section">
      <h1>{user.name}</h1>
      <p className="muted">{user.email}</p>

      {banner !== "" && (
        <p role="status" aria-label="Trade application" className="framed">
          {banner}
        </p>
      )}

      <h2 style={{ marginTop: 24 }}>Orders</h2>
      {orders.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <div className="table-frame">
          <table aria-label="Your orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.order_key}>
                  <td className="numeric">
                    <AppLink to={`/orders/${order.order_key}`}>{order.order_key}</AppLink>
                  </td>
                  <td>{order.display_status}</td>
                  <td className="numeric">{formatMoney(order.total_cents)}</td>
                  <td className="numeric">{order.invoice?.due_date ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------- newsletter confirmation ---------- */

export function NewsletterConfirmPage() {
  const { search } = useRouter();
  const [heading, setHeading] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(search).get("token") ?? "";
    void api
      .confirmNewsletter(token)
      .then(() => setHeading(NEWSLETTER.confirmedHeading))
      .catch(() => setHeading(NEWSLETTER.invalidTokenHeading));
  }, [search]);

  return (
    <div className="wrap section">
      <h1>{heading}</h1>
      <p className="muted">
        {heading === NEWSLETTER.confirmedHeading
          ? "We will send you new fittings and photometric data as they are released."
          : "Ask for a new confirmation link from the newsletter form in the footer."}
      </p>
    </div>
  );
}
