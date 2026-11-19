// Membership: the Checkout dialog, keyboard-complete, charging once per press.

import { api, encodeNext, token } from './api.js';

const dialog = document.getElementById('checkout-dialog');
const backdrop = document.getElementById('checkout-backdrop');
const tierLine = document.getElementById('checkout-tier');
const cardNumber = document.getElementById('card-number');
const pay = document.getElementById('pay');
const tryAgain = document.getElementById('try-again');
const spinner = document.getElementById('checkout-spinner');
const status = document.getElementById('payment-status');
const main = document.getElementById('main');
const TIER_NAMES = { free: 'Free', basic: 'Basic', max: 'Max' };
const PRICES = { basic: '$2.99 / month', max: '$9.99 / month' };

let openedBy = null;
let currentTier = 'basic';
let running = false;
let idempotencyKey = null;
let heldTier = 'Free';

function newKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function focusable() {
  return Array.from(dialog.querySelectorAll('input, button'))
    .filter((node) => !node.disabled && !node.hidden);
}

function open(button, tier) {
  openedBy = button;
  currentTier = tier;
  idempotencyKey = null;
  tierLine.textContent = TIER_NAMES[tier] + ', ' + PRICES[tier];
  dialog.hidden = false;
  backdrop.hidden = false;
  main.inert = true;
  tryAgain.hidden = true;
  pay.disabled = false;
  spinner.hidden = true;
  cardNumber.focus();
}

function close() {
  if (running) return;
  dialog.hidden = true;
  backdrop.hidden = true;
  main.inert = false;
  if (openedBy) openedBy.focus();
  openedBy = null;
}

async function loadTier() {
  if (!token()) return;
  const answer = await api('/api/users/@me');
  if (answer.ok) heldTier = TIER_NAMES[answer.data.tier];
}

async function submitPayment() {
  if (running) return;
  running = true;
  pay.disabled = true;
  spinner.hidden = false;
  status.textContent = 'Processing payment';
  if (!idempotencyKey) idempotencyKey = newKey();
  let answer;
  try {
    answer = await api('/api/membership/checkout', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: { tier: currentTier, card_number: cardNumber.value.replace(/\s+/g, '') },
    });
  } catch (error) {
    running = false;
    spinner.hidden = true;
    status.textContent =
      'Payment could not be completed. Check your connection and try again.';
    tryAgain.hidden = false;
    return;
  }
  running = false;
  spinner.hidden = true;
  if (answer.status === 200) {
    heldTier = TIER_NAMES[answer.data.tier];
    status.textContent = 'You are now on ' + heldTier + '.';
    dialog.classList.add('paid');
    return;
  }
  if (answer.status === 402) {
    status.textContent = 'Your card was declined. You are still on ' + heldTier + '.';
  } else {
    status.textContent =
      'Payment could not be completed. Check your connection and try again.';
  }
  tryAgain.hidden = false;
  pay.disabled = false;
}

for (const button of document.querySelectorAll('[data-tier]')) {
  button.addEventListener('click', () => {
    if (!token()) {
      window.location.href = '/login?next=' + encodeNext('/membership');
      return;
    }
    open(button, button.dataset.tier);
  });
}

pay.addEventListener('click', submitPayment);
cardNumber.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitPayment();
  }
});
tryAgain.addEventListener('click', () => {
  idempotencyKey = null;
  tryAgain.hidden = true;
  pay.disabled = false;
  dialog.classList.remove('paid');
  cardNumber.focus();
});

dialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const nodes = focusable();
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

for (const question of document.querySelectorAll('.question')) {
  question.addEventListener('click', () => {
    const answerId = question.getAttribute('aria-controls');
    const answer = document.getElementById(answerId);
    const open = question.getAttribute('aria-expanded') === 'true';
    question.setAttribute('aria-expanded', open ? 'false' : 'true');
    answer.hidden = open;
  });
}

loadTier();
