// Runs before first paint: reflect the stored session and consent choice so the header never flickers.
(function () {
  var root = document.documentElement;
  try {
    if (localStorage.getItem("downtime.session")) root.setAttribute("data-session", "");
    var consent = localStorage.getItem("downtime.consent");
    if (consent) root.setAttribute("data-consent", consent);
  } catch (error) {
    root.removeAttribute("data-session");
  }
})();
