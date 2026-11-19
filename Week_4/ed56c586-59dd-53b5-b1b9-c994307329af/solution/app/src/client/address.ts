import { addressQuery } from "../shared/filter.js";

/** Reading and rewriting the page address. */

export function currentParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function addressWith(change: (params: URLSearchParams) => void, hash: string): string {
  const params = currentParams();
  change(params);
  return `${window.location.pathname}${addressQuery(params)}${hash}`;
}

export function replaceAddress(change: (params: URLSearchParams) => void, hash: string = window.location.hash): void {
  window.history.replaceState(window.history.state, "", addressWith(change, hash));
}

export function pushAddress(change: (params: URLSearchParams) => void, hash: string): void {
  window.history.pushState(null, "", addressWith(change, hash));
}
