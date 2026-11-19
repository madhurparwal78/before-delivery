// The console session token, kept in this browser between visits.
const KEY = "wayline.session";

export const session = {
  get: () => window.localStorage.getItem(KEY),
  set: (token) => window.localStorage.setItem(KEY, token),
  clear: () => window.localStorage.removeItem(KEY),
};
