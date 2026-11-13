// What the server told the page at first paint: {page, user, seq, now, params, zones}.
export const boot = JSON.parse(document.getElementById('boot').textContent);
export const me = boot.user ?? null;
