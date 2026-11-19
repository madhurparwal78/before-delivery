import { render } from "preact";
import "./main.css";
import { boot } from "./lib";
import { live } from "./live";
import { NotFoundPage, NotYourDeskPage, ServerErrorPage, SignInErrorPage, SignInOutagePage } from "./errors";
import { CataloguePage, HomePage, LotPage } from "./pages-public";
import { BidderPage, ConsignLotPage, ConsignNewPage, ConsignPage, InvoicePage, RegisterPage, StatementPage } from "./pages-member";
import { AdminPage, CashierPage, SpecialistPage } from "./pages-staff";

function route(path: string) {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const seg = trimmed.split("/").filter(Boolean);
  const id = seg[1] ?? "";
  switch (seg[0]) {
    case undefined:
      return <HomePage />;
    case "catalogue":
      return <CataloguePage saleId={seg[1] ?? null} />;
    case "lots":
      return <LotPage id={id} />;
    case "register":
      return <RegisterPage />;
    case "bidder":
      return seg[1] === "invoices" ? <InvoicePage id={seg[2] ?? ""} /> : <BidderPage />;
    case "consign":
      if (seg[1] === "new") return <ConsignNewPage />;
      if (seg[1] === "lots") return <ConsignLotPage id={seg[2] ?? ""} />;
      if (seg[1] === "statements") return <StatementPage id={seg[2] ?? ""} />;
      return <ConsignPage />;
    case "desk":
      if (seg[1] === "specialist") return <SpecialistPage />;
      if (seg[1] === "cashier") return <CashierPage />;
      return <AdminPage />;
    default:
      return <NotFoundPage />;
  }
}

function app() {
  switch (boot.page) {
    case "signin-outage":
      return <SignInOutagePage />;
    case "signin-error":
      return <SignInErrorPage />;
    case "forbidden":
      return <NotYourDeskPage />;
    case "not-found":
      return <NotFoundPage />;
    case "error":
      return <ServerErrorPage />;
    default:
      return route(window.location.pathname);
  }
}

// Pages that fetch no data of their own still hold one live socket.
if (boot.page !== "app" || ["/register", "/consign/new"].includes(window.location.pathname)) live.start(null);

render(app(), document.getElementById("root") as HTMLElement);
