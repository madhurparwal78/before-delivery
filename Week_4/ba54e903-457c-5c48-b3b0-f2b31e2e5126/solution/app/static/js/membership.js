/* Membership page: FAQ, subscribe buttons and the modal Checkout dialog. */
(function () {
  'use strict';
  Array.prototype.forEach.call(document.querySelectorAll('.faq-q button'), function (button) {
    button.addEventListener('click', function () {
      var open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', open ? 'false' : 'true');
      document.getElementById(button.getAttribute('aria-controls')).hidden = open;
    });
  });

  var TIERS = { basic: { name: 'Basic', price: '$2.99 / MONTH' }, max: { name: 'Max', price: '$9.99 / MONTH' } };
  var dialog = document.getElementById('checkout');
  var form = document.getElementById('checkout-form');
  var tierLine = document.getElementById('checkout-tier');
  var card = document.getElementById('card-number');
  var pay = document.getElementById('checkout-pay');
  var retry = document.getElementById('checkout-retry');
  var close = document.getElementById('checkout-close');
  var status = document.getElementById('checkout-status');
  var tierNow = document.getElementById('tier-now');
  var page = [document.querySelector('.site-header'), document.getElementById('main'), document.querySelector('.site-footer'), document.getElementById('consent')];
  var opener = null;
  var tier = null;
  var busy = false;

  function currentTier() { var user = Hub.user(); return user ? user.tier : 'free'; }
  function showTier() {
    var user = Hub.user();
    tierNow.textContent = user ? 'Current tier: ' + ({ free: 'Free', basic: 'Basic', max: 'Max' })[user.tier] : '';
  }
  function say(text, kind, spinner) {
    status.textContent = '';
    status.className = 'checkout-busy' + (kind ? ' ' + kind : '');
    if (spinner === 'spin') {
      var wheel = document.createElement('span');
      wheel.className = 'spinner';
      wheel.setAttribute('aria-hidden', 'true');
      status.appendChild(wheel);
    } else if (spinner === 'check') {
      status.insertAdjacentHTML('beforeend', '<svg class="check-mark" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7"/></svg>');
    }
    status.appendChild(document.createTextNode(text));
  }
  function setInert(on) { page.forEach(function (node) { if (node) node.inert = on; }); }
  function stop() {
    if (busy) return;
    dialog.close();
    setInert(false);
    if (opener) opener.focus();
  }
  function begin(button) {
    opener = button;
    tier = button.dataset.subscribe;
    tierLine.textContent = TIERS[tier].name + ' — ' + TIERS[tier].price;
    card.value = '';
    card.disabled = false;
    pay.hidden = false;
    pay.disabled = false;
    retry.hidden = true;
    status.textContent = '';
    status.className = 'checkout-busy';
    dialog.showModal();
    setInert(true);
    card.focus();
  }
  function attempt() {
    if (busy) return;
    busy = true;
    pay.disabled = true;
    retry.disabled = true;
    card.disabled = true;
    say('Processing payment', '', 'spin');
    dialog.setAttribute('tabindex', '-1');
    dialog.focus();
    var key = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
    var failure = function (text) {
      busy = false;
      card.disabled = false;
      pay.hidden = true;
      retry.hidden = false;
      retry.disabled = false;
      say(text, 'bad');
      retry.focus();
    };
    Hub.api('POST', '/api/membership/checkout', {
      body: { tier: tier, card_number: card.value.replace(/\s+/g, '') },
      headers: { 'Idempotency-Key': key }
    }).then(function (result) {
      if (result.ok) {
        busy = false;
        var user = Hub.user();
        if (user) { user.tier = result.data.tier; user.entitlements = result.data.entitlements; Hub.setSession(Hub.token(), user); }
        pay.hidden = true;
        retry.hidden = true;
        say('You are now on ' + TIERS[tier].name + '.', 'ok', 'check');
        showTier();
        close.focus();
      } else if (result.status === 402) {
        failure('Your card was declined. You are still on ' + ({ free: 'Free', basic: 'Basic', max: 'Max' })[currentTier()] + '.');
      } else {
        failure('Payment could not be completed. Check your connection and try again.');
      }
    }).catch(function () {
      failure('Payment could not be completed. Check your connection and try again.');
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-subscribe]'), function (button) {
    button.addEventListener('click', function () {
      if (!Hub.token()) { location.assign(Hub.loginUrl('/membership')); return; }
      begin(button);
    });
  });
  form.addEventListener('submit', function (event) { event.preventDefault(); if (!pay.hidden) attempt(); });
  retry.addEventListener('click', attempt);
  close.addEventListener('click', stop);
  dialog.addEventListener('cancel', function (event) { event.preventDefault(); stop(); });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); stop(); return; }
    if (event.key !== 'Tab') return;
    var controls = Array.prototype.filter.call(dialog.querySelectorAll('input, button'), function (c) { return !c.disabled && !c.hidden; });
    if (!controls.length) { event.preventDefault(); return; }
    var first = controls[0];
    var last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && dialog.open) { event.preventDefault(); stop(); }
  });
  showTier();
})();
