/** The route table and the shell every screen sits in. */

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Header } from './components/Header.tsx';
import { FallingChips, MagneticCursor } from './effects/decor.tsx';
import { currentAddress, useRouter } from './router.tsx';
import { useCart, useSession } from './state.tsx';
import { HomePage } from './pages/Home.tsx';
import { SearchPage } from './pages/Search.tsx';
import { ProductPage } from './pages/Product.tsx';
import { OffersPage } from './pages/Offers.tsx';
import { ComparePage } from './pages/Compare.tsx';
import { CartPage } from './pages/Cart.tsx';
import { CheckoutPage } from './pages/Checkout.tsx';
import { PlacedPage } from './pages/Placed.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { OrderPage } from './pages/Order.tsx';
import { WishlistPage } from './pages/Wishlist.tsx';
import { SharedPage } from './pages/Shared.tsx';
import { SignInPage, SignUpPage, CodePage, ForgotPage } from './pages/SignIn.tsx';
import { AccountPage } from './pages/Account.tsx';
import {
  SellerListingsPage,
  SellerListingFormPage,
  SellerStockPage,
  SellerShipmentsPage,
  SellerReturnsPage,
  SellerStatementPage,
} from './pages/Seller.tsx';
import { SupportPage, SupportOrderPage } from './pages/Support.tsx';
import { NotFoundPage } from './pages/NotFound.tsx';

function match(path: string, pattern: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = path.replace(/\/$/, '').split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const expected = patternParts[index];
    if (expected.startsWith(':')) {
      if (pathParts[index] === '') return null;
      params[expected.slice(1)] = decodeURIComponent(pathParts[index]);
      continue;
    }
    if (expected !== pathParts[index]) return null;
  }
  return params;
}

function RedirectToSignIn(): ReactNode {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(`/signin?next=${encodeURIComponent(currentAddress())}`, { replace: true });
  }, [navigate]);
  return <p className="muted">signing in</p>;
}

function Screen(): ReactNode {
  const { path } = useRouter();
  const { account, loading } = useSession();
  const clean = path === '/' ? '/' : path.replace(/\/$/, '');

  const guard = (role: 'shopper' | 'seller' | 'support', screen: ReactNode): ReactNode => {
    if (loading) return <p className="muted">loading</p>;
    if (account === null || account.role !== role) return <RedirectToSignIn />;
    return screen;
  };

  if (clean === '/') return <HomePage />;
  if (clean === '/search') return <SearchPage />;
  if (clean === '/compare') return <ComparePage />;
  if (clean === '/cart') return <CartPage />;
  if (clean === '/wishlist') return guard('shopper', <WishlistPage />);
  if (clean === '/orders') return guard('shopper', <OrdersPage />);
  if (clean === '/account') return account === null ? <RedirectToSignIn /> : <AccountPage />;
  if (clean === '/signin') return <SignInPage />;
  if (clean === '/signin/code') return <CodePage kind="signin" />;
  if (clean === '/signup') return <SignUpPage />;
  if (clean === '/signup/code') return <CodePage kind="signup" />;
  if (clean === '/forgot') return <ForgotPage />;
  if (clean === '/seller/listings') return guard('seller', <SellerListingsPage />);
  if (clean === '/seller/listings/new') return guard('seller', <SellerListingFormPage listingId={null} />);
  if (clean === '/seller/stock') return guard('seller', <SellerStockPage />);
  if (clean === '/seller/shipments') return guard('seller', <SellerShipmentsPage />);
  if (clean === '/seller/returns') return guard('seller', <SellerReturnsPage />);
  if (clean === '/seller/statement') return guard('seller', <SellerStatementPage />);
  if (clean === '/support') return guard('support', <SupportPage />);
  if (clean.startsWith('/checkout/')) {
    const step = clean.slice('/checkout/'.length);
    if (step === 'address' || step === 'payment' || step === 'review') {
      return account === null ? <RedirectToSignIn /> : <CheckoutPage step={step} />;
    }
    return <NotFoundPage />;
  }

  let params = match(clean, '/p/:productId/offers');
  if (params !== null) return <OffersPage productId={params.productId} />;
  params = match(clean, '/p/:productId');
  if (params !== null) return <ProductPage productId={params.productId} />;
  params = match(clean, '/orders/:orderId/placed');
  if (params !== null) return guard('shopper', <PlacedPage orderId={params.orderId} />);
  params = match(clean, '/orders/:orderId');
  if (params !== null) return guard('shopper', <OrderPage orderId={params.orderId} />);
  params = match(clean, '/s/:token');
  if (params !== null) return <SharedPage token={params.token} />;
  params = match(clean, '/seller/listings/:listingId');
  if (params !== null) return guard('seller', <SellerListingFormPage listingId={params.listingId} />);
  params = match(clean, '/support/orders/:orderId');
  if (params !== null) return guard('support', <SupportOrderPage orderId={params.orderId} />);
  return <NotFoundPage />;
}

export function App(): ReactNode {
  const { path } = useRouter();
  const { chipTrigger } = useCart();

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading === null) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }, [path]);

  return (
    <>
      <MagneticCursor />
      <FallingChips trigger={chipTrigger} />
      <Header />
      <main className="wrap">
        <Screen />
      </main>
    </>
  );
}
