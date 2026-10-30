/* Plays the intro cover on the first page of a browsing session only. */
(function () {
  var cover = document.querySelector('[data-intro-cover]');
  var played = true;
  try {
    played = window.sessionStorage.getItem('ivo-intro') === 'played';
    window.sessionStorage.setItem('ivo-intro', 'played');
  } catch (error) {
    /* Storage is walled off in some browsing modes; the cover is skipped. */
  }
  var settled =
    document.documentElement.dataset.motion === 'off' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (played || settled) {
    return;
  }
  cover.hidden = false;
  window.setTimeout(function () {
    cover.dataset.lifting = 'true';
  }, 900);
  window.setTimeout(function () {
    cover.hidden = true;
  }, 1800);
})();
