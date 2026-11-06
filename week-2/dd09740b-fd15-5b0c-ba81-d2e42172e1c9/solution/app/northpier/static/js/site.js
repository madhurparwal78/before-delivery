// Shared motion and chrome: letter reveals, label rises, hero line, link underlines, menu sheet, cookie card.
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const MOTION_MS = 450;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Statement enter: letters settle upright from a slight lean, 12ms apart in reading order.
function splitLetters(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const letters = [];
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    for (const part of node.data.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { fragment.append(part); continue; }
      const word = document.createElement('span');
      word.className = 'w';
      for (const char of part) {
        const letter = document.createElement('span');
        letter.className = 'ch';
        letter.textContent = char;
        word.append(letter);
        letters.push(letter);
      }
      fragment.append(word);
    }
    node.replaceWith(fragment);
  }
  return letters;
}

function revealLetters(element) {
  element.classList.add('revealed');
  if (reduced()) return;
  const letters = splitLetters(element);
  letters.forEach((letter, index) => letter.animate(
    [{ filter: 'opacity(0)', top: '0.25em' }, { filter: 'opacity(1)', top: '0em' }],
    { duration: MOTION_MS, delay: index * 12, easing: EASE, fill: 'backwards' }));
  for (const word of element.querySelectorAll('.w')) {
    const first = letters.indexOf(word.firstElementChild);
    word.animate([{ transform: 'skewX(-10deg)' }, { transform: 'none' }],
      { duration: MOTION_MS + 12 * (word.children.length - 1), delay: first * 12, easing: EASE, fill: 'backwards' });
  }
}

// Label enter: fade in and rise a short way, siblings 60ms apart.
function rise(element) {
  element.classList.add('risen');
  if (reduced()) return;
  const siblings = [...element.parentElement.children].filter((child) => child.classList.contains('rise'));
  element.animate([{ filter: 'opacity(0)', transform: 'translateY(18px)' }, { filter: 'opacity(1)', transform: 'none' }],
    { duration: MOTION_MS, delay: Math.max(0, siblings.indexOf(element)) * 60, easing: EASE, fill: 'backwards' });
}

function onEnter(selector, play) {
  const pending = [...document.querySelectorAll(selector)];
  const inView = (element) => {
    const box = element.getBoundingClientRect();
    return box.top < innerHeight && box.bottom > 0;
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      play(entry.target);
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  for (const element of pending) {
    if (reduced() || inView(element)) play(element);
    else observer.observe(element);
  }
}

// Hero line: the phrase swaps every 3 seconds; reduced motion keeps the first.
function rotateHero() {
  const phrases = [...document.querySelectorAll('.phrase')];
  if (phrases.length < 2 || reduced()) return;
  let current = 0;
  setInterval(() => {
    const out = phrases[current];
    current = (current + 1) % phrases.length;
    const next = phrases[current];
    next.classList.add('on');
    next.removeAttribute('aria-hidden');
    out.setAttribute('aria-hidden', 'true');
    out.animate([{ opacity: 1, transform: 'none', visibility: 'visible' }, { opacity: 0, transform: 'translateY(-60%)', visibility: 'visible' }],
      { duration: MOTION_MS, easing: EASE });
    out.classList.remove('on');
    next.animate([{ opacity: 0, transform: 'translateY(60%)' }, { opacity: 1, transform: 'none' }],
      { duration: MOTION_MS, easing: EASE });
  }, 3000);
}

// Link hover: the underline draws from the left and wipes off to the right.
function underlines() {
  document.addEventListener('pointerover', (event) => {
    const link = event.target.closest?.('.link');
    if (!link || event.pointerType !== 'mouse' || link.contains(event.relatedTarget)) return;
    link.classList.remove('undraw');
    link.classList.add('draw');
  });
  document.addEventListener('pointerout', (event) => {
    const link = event.target.closest?.('.link');
    if (!link || event.pointerType !== 'mouse' || link.contains(event.relatedTarget)) return;
    if (!link.classList.contains('draw')) return;
    link.classList.remove('draw');
    link.classList.add('undraw');
  });
}

// Menu sheet: a modal dialog that keeps Tab inside, fades in and out, and returns focus to Menu.
function menu() {
  const sheet = document.getElementById('sheet');
  const opener = document.querySelector('.menu-open');
  if (!sheet || !opener) return;
  const focusables = () => [...sheet.querySelectorAll('a, button')];
  const fade = (from, to) => (reduced() ? null : sheet.animate([{ opacity: from }, { opacity: to }], { duration: MOTION_MS, easing: EASE }));
  const close = () => {
    const animation = fade(1, 0);
    const done = () => { sheet.close(); opener.focus(); };
    if (animation) animation.finished.then(done); else done();
  };
  opener.addEventListener('click', () => {
    sheet.showModal();
    fade(0, 1);
    sheet.querySelector('ul a').focus();
  });
  sheet.querySelector('.menu-close').addEventListener('click', close);
  sheet.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusables();
    const index = items.indexOf(document.activeElement);
    const next = event.shiftKey ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
    event.preventDefault();
    items[next].focus();
  });
}

// Cookie card: glides in from the right one second after load; the choice is kept for a year.
function cookieCard() {
  const card = document.querySelector('.cookie');
  if (!card) return;
  setTimeout(() => {
    card.removeAttribute('data-wait');
    if (!reduced()) {
      card.animate([{ opacity: 0, transform: 'translateX(16px)', clipPath: 'inset(0 0 0 100%)' },
        { opacity: 1, transform: 'none', clipPath: 'inset(0 0 0 0)' }], { duration: MOTION_MS, easing: EASE });
    }
  }, 1000);
  card.addEventListener('click', (event) => {
    const button = event.target.closest('button[name="choice"]');
    if (!button) return;
    event.preventDefault();
    document.cookie = `np_consent=${button.value}; max-age=${365 * 86400}; path=/; samesite=lax`;
    card.remove();
  });
}

onEnter('[data-reveal]', revealLetters);
onEnter('.rise', rise);
rotateHero();
underlines();
menu();
cookieCard();
