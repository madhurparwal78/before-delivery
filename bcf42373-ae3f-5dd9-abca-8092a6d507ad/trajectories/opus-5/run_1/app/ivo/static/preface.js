/* Applies the remembered motion choice before the first paint. */
(function () {
  try {
    if (window.localStorage.getItem('ivo-motion') === 'off') {
      document.documentElement.dataset.motion = 'off';
    }
  } catch (error) {
    /* Storage is walled off in some browsing modes; motion stays on. */
  }
})();
