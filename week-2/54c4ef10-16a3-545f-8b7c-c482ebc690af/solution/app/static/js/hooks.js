// Callbacks the shell installs so that api.js and pages can reach it without importing it.
export const hooks = {
  unauthenticated() {},
  storageRefused() {},
  navigate() {},
};
