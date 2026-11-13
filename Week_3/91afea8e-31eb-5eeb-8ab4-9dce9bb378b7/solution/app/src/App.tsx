import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { NotFound } from "./components/NotFound";
import Home from "./pages/Home";
import Search from "./pages/Search";
import Product from "./pages/Product";
import Offers from "./pages/Offers";
import Compare from "./pages/Compare";
import Cart from "./pages/Cart";
import CheckoutAddress from "./pages/checkout/Address";
import CheckoutPayment from "./pages/checkout/Payment";
import CheckoutReview from "./pages/checkout/Review";
import Placed from "./pages/Placed";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Wishlist from "./pages/Wishlist";
import Shared from "./pages/Shared";
import Signin from "./pages/auth/Signin";
import SigninCode from "./pages/auth/SigninCode";
import Signup from "./pages/auth/Signup";
import SignupCode from "./pages/auth/SignupCode";
import Forgot from "./pages/auth/Forgot";
import Account from "./pages/Account";
import SellerListings from "./pages/seller/Listings";
import SellerListingForm from "./pages/seller/ListingForm";
import SellerStock from "./pages/seller/Stock";
import SellerShipments from "./pages/seller/Shipments";
import SellerReturns from "./pages/seller/Returns";
import SellerStatement from "./pages/seller/Statement";
import Support from "./pages/support/Lookup";
import SupportOrder from "./pages/support/Order";

export function App(): ReactNode {
  return (
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="p/:id" element={<Product />} />
          <Route path="p/:id/offers" element={<Offers />} />
          <Route path="compare" element={<Compare />} />
          <Route path="cart" element={<Cart />} />
          <Route path="checkout/address" element={<CheckoutAddress />} />
          <Route path="checkout/payment" element={<CheckoutPayment />} />
          <Route path="checkout/review" element={<CheckoutReview />} />
          <Route path="orders/:id/placed" element={<Placed />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="wishlist" element={<Wishlist />} />
          <Route path="s/:token" element={<Shared />} />
          <Route path="signin" element={<Signin />} />
          <Route path="signin/code" element={<SigninCode />} />
          <Route path="signup" element={<Signup />} />
          <Route path="signup/code" element={<SignupCode />} />
          <Route path="forgot" element={<Forgot />} />
          <Route path="account" element={<Account />} />
          <Route path="seller/listings" element={<SellerListings />} />
          <Route path="seller/listings/new" element={<SellerListingForm />} />
          <Route path="seller/listings/:id" element={<SellerListingForm />} />
          <Route path="seller/stock" element={<SellerStock />} />
          <Route path="seller/shipments" element={<SellerShipments />} />
          <Route path="seller/returns" element={<SellerReturns />} />
          <Route path="seller/statement" element={<SellerStatement />} />
          <Route path="support" element={<Support />} />
          <Route path="support/orders/:id" element={<SupportOrder />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
  );
}
