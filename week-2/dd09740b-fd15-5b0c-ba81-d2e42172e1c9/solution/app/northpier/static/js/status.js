// Status page: recheck every 15 seconds and show a studio change in place, without a reload.
const page = document.querySelector('.status-page');

async function recheck() {
  let fresh;
  try {
    const response = await fetch(location.pathname, { headers: { Accept: 'text/html' }, cache: 'no-store' });
    if (!response.ok) return;
    fresh = new DOMParser().parseFromString(await response.text(), 'text/html').querySelector('.status-page');
  } catch {
    return;
  }
  if (!fresh || fresh.dataset.version === page.dataset.version) return;
  page.dataset.version = fresh.dataset.version;
  const label = page.querySelector('.status-label');
  label.textContent = fresh.querySelector('.status-label').textContent;
  label.classList.remove('revealed');
  revealLetters(label);
  const line = page.querySelector('.status-line');
  line.textContent = fresh.querySelector('.status-line').textContent;
  page.querySelector('#status-pill').replaceChildren(...fresh.querySelector('#status-pill').childNodes);
  const history = page.querySelector('#status-history');
  const known = history.children.length;
  history.replaceChildren(...fresh.querySelector('#status-history').children);
  for (const item of history.children) item.classList.add('risen');
  if (!reduced()) {
    line.animate([{ filter: 'opacity(0)' }, { filter: 'opacity(1)' }], { duration: MOTION_MS, easing: EASE });
    [...history.children].slice(known).forEach((item) => item.animate(
      [{ filter: 'opacity(0)', transform: 'translateY(18px)' }, { filter: 'opacity(1)', transform: 'none' }], { duration: MOTION_MS, easing: EASE }));
  }
}

setInterval(recheck, 15000);
