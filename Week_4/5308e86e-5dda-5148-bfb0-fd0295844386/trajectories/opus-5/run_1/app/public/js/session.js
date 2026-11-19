// The browser stores at most the session token and the id of the last opened
// account. Everything else about a company lives only in memory.

const TOKEN_KEY = 'tallwind.token';
const ACCOUNT_KEY = 'tallwind.last_account';

let cachedUser = null;

export function token() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch (error) {
    return null;
  }
}

export function signedIn() {
  return Boolean(token());
}

export function setToken(value) {
  try {
    window.localStorage.setItem(TOKEN_KEY, value);
  } catch (error) {
    /* storage is unavailable */
  }
}

export function user() {
  return cachedUser;
}

export function setUser(value) {
  cachedUser = value;
}

export function lastAccount() {
  try {
    return window.localStorage.getItem(ACCOUNT_KEY);
  } catch (error) {
    return null;
  }
}

export function setLastAccount(id) {
  try {
    window.localStorage.setItem(ACCOUNT_KEY, id);
  } catch (error) {
    /* storage is unavailable */
  }
}

// Signing out, and a revoked session, discard every company-scoped value.
export function clear() {
  cachedUser = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ACCOUNT_KEY);
  } catch (error) {
    /* storage is unavailable */
  }
}
