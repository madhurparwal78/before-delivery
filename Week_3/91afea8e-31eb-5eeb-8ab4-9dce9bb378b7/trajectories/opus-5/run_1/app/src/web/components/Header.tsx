/** The header: search, the pincode dialog, the cart link and the account control. */

import { MapPin, Search, ShoppingCart } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { useCart, usePincode, useSession } from '../state.tsx';
import { Dialog, PendingButton } from './ui.tsx';
import { FIELD, pincodeNotServiceable } from '../../shared/messages.js';
import type { PincodeInfo } from '../../shared/types.js';

export function Header(): ReactNode {
  const { navigate } = useRouter();
  const { account } = useSession();
  const { count } = useCart();
  const [pincode, setPincode] = usePincode();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [entry, setEntry] = useState(pincode ?? '');
  const searchBox = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      searchBox.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const checkPincode = async (): Promise<void> => {
    if (!/^[1-9][0-9]{5}$/.test(entry)) {
      setMessage(FIELD.badPincode);
      return;
    }
    try {
      const info = await api<PincodeInfo>(`/api/pincodes/${entry}`);
      setPincode(info.pincode);
      setMessage(info.serviceable ? '' : pincodeNotServiceable(info.pincode));
      if (info.serviceable) setOpen(false);
    } catch {
      setMessage(pincodeNotServiceable(entry));
    }
  };

  return (
    <header className="site-header">
      <Link to="/" className="wordmark">
        chauraha
      </Link>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(`/search?q=${encodeURIComponent(query)}`);
        }}
      >
        <input
          ref={searchBox}
          type="text"
          role="searchbox"
          aria-label="Search Chauraha"
          placeholder="search the bazaar"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="submit" className="btn">
          <Search size={18} aria-hidden="true" />
          Search
        </button>
      </form>
      <button
        type="button"
        className="btn btn-quiet"
        aria-label="Deliver to"
        onClick={() => setOpen(true)}
      >
        <MapPin size={18} aria-hidden="true" />
        {pincode === null ? 'set pincode' : `deliver to ${pincode}`}
      </button>
      <Link to="/cart" className="btn btn-quiet" ariaLabel="Cart">
        <ShoppingCart size={18} aria-hidden="true" />
        <span aria-hidden="true">cart</span>
        <span className="badge" aria-hidden="true">
          {count}
        </span>
      </Link>
      {account !== null && account.role === 'shopper' ? (
        <>
          <Link to="/orders" className="btn btn-quiet">
            Orders
          </Link>
          <Link to="/wishlist" className="btn btn-quiet">
            Wishlist
          </Link>
        </>
      ) : null}
      {account !== null && account.role === 'seller' ? (
        <>
          <Link to="/seller/shipments" className="btn btn-quiet">
            Shipments
          </Link>
          <Link to="/seller/listings" className="btn btn-quiet">
            Listings
          </Link>
          <Link to="/seller/returns" className="btn btn-quiet">
            Returns
          </Link>
          <Link to="/seller/statement" className="btn btn-quiet">
            Statement
          </Link>
        </>
      ) : null}
      {account === null ? (
        <Link to={`/signin?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`} className="btn btn-yellow">
          Sign in
        </Link>
      ) : (
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() =>
            navigate(
              account.role === 'seller'
                ? '/seller/shipments'
                : account.role === 'support'
                  ? '/support'
                  : '/account',
            )
          }
        >
          Account
        </button>
      )}
      {account === null ? null : (
        <PendingButton
          label="Sign out"
          className="btn btn-pink"
          onPress={async () => {
            await api('/api/auth/signout', { method: 'POST', body: {} });
            window.location.assign('/');
          }}
        />
      )}
      <Dialog name="Delivery pincode" open={open} onClose={() => setOpen(false)}>
        <label htmlFor="header-pincode">Pincode</label>
        <input
          id="header-pincode"
          type="text"
          aria-label="Pincode"
          inputMode="numeric"
          value={entry}
          onChange={(event) => setEntry(event.target.value)}
        />
        {message === '' ? null : <p className="panel panel-pink">{message}</p>}
        <div className="row">
          <PendingButton label="Check pincode" onPress={checkPincode} />
          <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </Dialog>
    </header>
  );
}
