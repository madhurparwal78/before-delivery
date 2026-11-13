// Tallyslate browser app: renders server results, never re-derives them.
// Shared core: api client, formatting, notices, day strip, catalogue, booking page.

(() => {
  'use strict';

  function money(cents) {
    const sign = cents < 0 ? '-' : '';
    const abs = Math.abs(Math.round(cents));
    const dollars = Math.floor(abs / 100);
    const rest = abs % 100;
    return `${sign}$${dollars.toLocaleString('en-US')}.${`${rest}`.padStart(2, '0')}`;
  }

  function pad(value) {
    return `${value}`.padStart(2, '0');
  }

  function countdownLabel(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `Hold ends in ${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }

  function weekdayShort(date) {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return names[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? '';
  }

  function addDays(date, days) {
    const utc = new Date(`${date}T00:00:00.000Z`);
    utc.setUTCDate(utc.getUTCDate() + days);
    return utc.toISOString().slice(0, 10);
  }

  async function api(path, init) {
    const response = await fetch(path, {
      ...init,
      headers: { ...(init && init.headers ? init.headers : undefined) },
    });
    const text = await response.text();
    let body = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch (error) {
        body = null;
      }
    }
    return { status: response.status, body };
  }

  function errorMessage(body) {
    if (body !== null && typeof body === 'object' && 'error' in body) {
      const error = body.error;
      if (typeof error.message === 'string') {
        return error.message;
      }
    }
    return null;
  }

  function errorFields(body) {
    if (body !== null && typeof body === 'object' && 'fields' in body) {
      const fields = body.fields;
      if (typeof fields === 'object' && fields !== null) {
        return fields;
      }
    }
    return {};
  }

  function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className !== undefined) {
      node.className = options.className;
    }
    if (options.text !== undefined) {
      node.textContent = options.text;
    }
    if (options.attrs !== undefined) {
      for (const [name, value] of Object.entries(options.attrs)) {
        if (value === true) {
          node.setAttribute(name, '');
        } else if (value !== false) {
          node.setAttribute(name, String(value));
        }
      }
    }
    return node;
  }

  // ---------- service notices ----------

  class ServiceNotices {
    constructor(container) {
      this.container = container;
      this.last = null;
    }

    async refresh() {
      const result = await api('/api/status');
      if (result.status === 200 && result.body !== null) {
        this.render(result.body);
      }
    }

    mark(provider) {
      const next = this.last ? { ...this.last } : { payments: 'up', storage: 'up' };
      next[provider] = 'down';
      this.render(next);
    }

    render(status) {
      this.last = status;
      this.container.replaceChildren();
      if (status.payments === 'down') {
        this.container.append(this.notice('Payments are offline', "We can't take or refund payments right now, so bookings can't be confirmed, cancelled or closed. Holds keep running on their own timers."));
      }
      if (status.storage === 'down') {
        this.container.append(this.notice('Photo storage is offline', "Certificates and condition photos can't be saved right now. Anything already stored is safe."));
      }
    }

    notice(heading, copy) {
      const notice = el('section', { className: 'service-notice' });
      notice.setAttribute('role', 'region');
      notice.setAttribute('aria-label', 'Service notice');
      notice.append(el('h2', { text: heading }), el('p', { text: copy }));
      return notice;
    }
  }

  // ---------- day strip (DP-03) ----------

  class DayStrip {
    constructor(root, state, kitId, onSettled) {
      this.root = root;
      this.state = state;
      this.kitId = kitId;
      this.onSettled = onSettled;
      this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.list = root.querySelector('[role="list"][aria-label="Hire days"]');
      this.slider = root.querySelector('input[type="range"]');
      this.total = root.querySelector('[role="status"][aria-label="Hire total"]');
      this.numerals = root.querySelector('.strip-hire-price');
      this.rollTimer = null;
      this.settledTimer = null;
      this.pendingToken = 0;
      this.slider.addEventListener('input', () => {
        this.state.dayCount = Number(this.slider.value);
        this.render();
        this.requestPrice();
      });
      this.render();
    }

    setPickup(pickupDate) {
      this.state.pickupDate = pickupDate;
      this.render();
      this.requestPrice();
    }

    async requestPrice() {
      const pickupDate = this.state.pickupDate;
      const dayCount = this.state.dayCount;
      const token = ++this.pendingToken;
      if (pickupDate === '') {
        this.state.price = null;
        this.render();
        this.onSettled('', dayCount);
        return;
      }
      const params = new URLSearchParams({
        kitId: this.kitId,
        pickupDate,
        returnDate: addDays(pickupDate, dayCount),
      });
      const result = await api(`/api/price?${params.toString()}`);
      if (token !== this.pendingToken) {
        return;
      }
      if (result.status === 200 && result.body !== null) {
        this.state.price = result.body;
        this.render(true);
        this.onSettled(pickupDate, dayCount);
      }
    }

    render(announce) {
      const price = this.state.price;
      this.list.replaceChildren();
      if (price === null) {
        this.total.textContent = '';
        this.numerals.textContent = '—';
        return;
      }
      const weekend = price.days.length > 0 && price.days.every((day) => day.kind === 'weekend');
      if (weekend) {
        this.list.append(el('li', { className: 'day-cell kind-weekend', text: 'weekend · 1 day' }));
      } else {
        let bandOpen = false;
        for (const day of price.days) {
          if (day.kind === 'free') {
            if (!bandOpen) {
              const band = el('li', { className: 'day-cell kind-free band-open', text: 'free' });
              this.list.append(band);
              bandOpen = true;
            }
            continue;
          }
          bandOpen = false;
          const cell = el('li', {
            className: `day-cell kind-${day.kind}`,
            text: `${day.day} ${weekdayShort(day.date)}`,
          });
          this.list.append(cell);
        }
      }
      for (let extra = price.days.length + 1; extra <= 14; extra += 1) {
        this.list.append(el('li', { className: 'day-cell kind-empty', text: `${extra}` }));
      }
      const amount = money(price.hirePriceCents);
      if (this.reduceMotion) {
        this.numerals.textContent = amount;
      } else {
        this.rollNumerals(amount);
      }
      this.settleAnnouncement(announce);
    }

    rollNumerals(amount) {
      if (this.numerals.textContent === amount) {
        return;
      }
      const roll = el('span', { className: 'numerals-roll', text: amount });
      this.numerals.replaceChildren(roll);
      const from = this.numerals.textContent === '' ? amount : this.numerals.textContent;
      const frames = 15;
      let frame = 0;
      if (this.rollTimer !== null) {
        window.clearInterval(this.rollTimer);
      }
      this.rollTimer = window.setInterval(() => {
        frame += 1;
        const width = Math.max(from.length, amount.length);
        const keep = Math.floor((width * frame) / frames);
        const shown = amount.slice(0, Math.min(amount.length, keep));
        roll.textContent = shown;
        if (frame >= frames) {
          roll.textContent = amount;
          window.clearInterval(this.rollTimer);
          this.rollTimer = null;
        }
      }, 24);
    }

    settleAnnouncement(announce) {
      if (!announce || this.state.price === null) {
        return;
      }
      const price = this.state.price;
      if (this.settledTimer !== null) {
        window.clearTimeout(this.settledTimer);
      }
      const delay = this.reduceMotion ? 0 : 360;
      this.settledTimer = window.setTimeout(() => {
        const days = price.billableDays === 1 ? '1 billable day' : `${price.billableDays} billable days`;
        this.total.textContent = `Hire total ${money(price.hirePriceCents)} for ${days}`;
      }, delay);
    }
  }

  // ---------- dialog helpers ----------

  const dialogs = [];
  let dialogOpener = null;

  function openDialog(dialog) {
    dialogOpener = document.activeElement;
    dialog.showModal();
    dialogs.push(dialog);
    const focusable = dialog.querySelector('input, select, textarea, button, a[href]');
    if (focusable !== null) {
      focusable.focus();
    }
    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(dialog);
      } else if (event.key === 'Tab') {
        const focusables = Array.from(
          dialog.querySelectorAll('input, select, textarea, button, a[href]'),
        ).filter((node) => !node.hasAttribute('disabled'));
        if (focusables.length === 0) {
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  function closeDialog(dialog) {
    dialog.close();
    const index = dialogs.indexOf(dialog);
    if (index !== -1) {
      dialogs.splice(index, 1);
    }
    if (dialogOpener !== null && dialogOpener.isConnected) {
      dialogOpener.focus();
    }
  }

  // ---------- address dates ----------

  function readAddressDates() {
    const params = new URLSearchParams(window.location.search);
    const pickup = params.get('pickup') ?? '';
    const ret = params.get('return') ?? '';
    if (pickup === '' || ret === '') {
      return { pickup: '', dayCount: 3 };
    }
    const dayCount = Math.max(1, Math.min(14, Math.round(
      (new Date(`${ret}T00:00:00.000Z`) - new Date(`${pickup}T00:00:00.000Z`)) / 86400000,
    )));
    return { pickup, dayCount };
  }

  function writeAddressDates(pickup, dayCount) {
    const params = new URLSearchParams(window.location.search);
    if (pickup === '') {
      params.delete('pickup');
      params.delete('return');
    } else {
      params.set('pickup', pickup);
      params.set('return', addDays(pickup, dayCount));
    }
    const query = params.toString();
    window.history.replaceState(null, '', query === '' ? window.location.pathname : `${window.location.pathname}?${query}`);
  }

  // ---------- catalogue and kit sheet ----------

  function initCatalogue(notices) {
    const pickup = document.getElementById('pickup-date');
    const handle = document.getElementById('return-day');
    const stripRoot = document.getElementById('day-strip');
    const kitId = document.body.dataset.kitId ?? 'kestrel-lf';
    const initial = readAddressDates();
    pickup.value = initial.pickup;
    handle.value = `${initial.dayCount}`;
    handle.setAttribute('aria-valuetext', `Day ${initial.dayCount}, return ${initial.pickup === '' ? '' : addDays(initial.pickup, initial.dayCount)}`);

    const strip = new DayStrip(
      stripRoot,
      { pickupDate: initial.pickup, dayCount: initial.dayCount, price: null },
      kitId,
      (pickupDate, dayCount) => {
        writeAddressDates(pickupDate, dayCount);
        refreshSheets();
        refreshUnitTables();
      },
    );

    pickup.addEventListener('change', () => {
      strip.setPickup(pickup.value);
    });

    if (initial.pickup !== '') {
      strip.setPickup(initial.pickup);
    }

    async function refreshSheets() {
      const params = new URLSearchParams(window.location.search);
      const query = params.get('pickup') !== null ? `?${params.toString()}` : '';
      const result = await api(`/api/kits${query}`);
      if (result.status !== 200 || result.body === null) {
        return;
      }
      renderSheets((result.body).kits);
    }

    function renderSheets(kits) {
      const holder = document.getElementById('kit-sheets');
      if (holder === null) {
        return;
      }
      holder.replaceChildren();
      const noDates = document.getElementById('no-dates');
      const nothingFree = document.getElementById('nothing-free');
      const datesSet = new URLSearchParams(window.location.search).get('pickup') !== null;
      const anyFree = kits.some((kit) => (kit.freeForDates ?? 0) > 0);
      noDates.hidden = datesSet;
      nothingFree.hidden = !(datesSet && !anyFree);
      let category = '';
      let section = null;
      for (const kit of kits) {
        if (kit.category !== category) {
          category = kit.category;
          holder.append(el('h2', { className: 'section-heading', text: category }));
          section = el('div', { className: 'catalogue-sheets' });
          holder.append(section);
        }
        const sheet = el('article', { className: 'rental-sheet' });
        sheet.setAttribute('aria-label', kit.name);
        const band = el('div', { className: 'rental-band' });
        const headingBlock = el('div', { className: 'kit-heading' });
        headingBlock.append(el('h2', { text: kit.name }));
        const meta = el('div', { className: 'band-meta' });
        const numerals = el('div', { className: 'numerals' });
        numerals.textContent = kit.price !== null
          ? money(kit.price.hirePriceCents)
          : money(kit.dayRateCents ?? 0);
        const countNote = el('div', {
          className: 'count-note',
          text: kit.price !== null
            ? (kit.price.billableDays === 1 ? '1 billable day' : `${kit.price.billableDays} billable days`)
            : 'day rate',
        });
        meta.append(numerals, countNote);
        if (kit.freeForDates !== null) {
          meta.append(el('div', { className: 'free-note', text: `${kit.freeForDates} free for these dates` }));
        }
        band.append(headingBlock, meta);
        sheet.append(band);
        const components = el('ul', { className: 'components-list' });
        for (const component of kit.components) {
          const li = el('li');
          li.append(
            el('span', { text: component.name }),
            el('span', { className: 'component-value', text: money(component.replacementValueCents) }),
          );
          components.append(li);
        }
        sheet.append(components);
        const openRow = el('div', { className: 'btn-row' });
        const search = window.location.search;
        openRow.append(el('a', {
          className: 'btn btn-ghost',
          text: `Open ${kit.name}`,
          attrs: { href: `/kits/${kit.id}${search}` },
        }));
        sheet.append(openRow);
        section.append(sheet);
      }
    }

    async function refreshUnitTables() {
      if (document.body.dataset.page !== 'kit') {
        return;
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('pickup') === null) {
        return;
      }
      const result = await api(`/api/kits/${kitId}?${params.toString()}`);
      if (result.status !== 200 || result.body === null) {
        return;
      }
      renderUnitTables(result.body.units);
    }

    function renderUnitTables(units) {
      const tables = document.querySelectorAll('table.units-table');
      for (const table of tables) {
        for (const row of Array.from(table.tBodies[0].rows)) {
          const serial = row.dataset.serial ?? '';
          const unit = units.find((candidate) => candidate.serial === serial);
          if (unit === undefined) {
            continue;
          }
          const statusCell = row.cells[1];
          const pickCell = row.cells[2];
          const label = unit.status === 'booked' ? 'Booked' : unit.status === 'repair' ? 'In repair' : 'Free';
          statusCell.textContent = label;
          row.classList.toggle('greyed', unit.status === 'booked' || unit.status === 'repair');
          const radio = pickCell.querySelector('input[type="radio"]');
          if (radio !== null) {
            radio.disabled = unit.status !== 'free';
          }
        }
      }
    }

    refreshSheets();
    refreshUnitTables();

    // Hold form (kit sheet only)
    const holdForm = document.getElementById('hold-form');
    if (holdForm !== null) {
      const holdButton = document.getElementById('hold-button');
      const alertBox = document.getElementById('unit-taken');
      const syncButton = () => {
        const datesSet = strip.state.pickupDate !== '';
        holdButton.disabled = !datesSet;
      };
      syncButton();
      pickup.addEventListener('change', syncButton);

      holdForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (holdButton.textContent === 'Holding your units') {
          return;
        }
        const name = document.getElementById('renter-name').value.trim();
        const email = document.getElementById('renter-email').value.trim();
        const units = {};
        for (const radio of Array.from(holdForm.querySelectorAll('input[type="radio"]:checked'))) {
          if (radio.value !== 'any' && radio.dataset.classId !== undefined) {
            units[radio.dataset.classId] = radio.value;
          }
        }
        holdButton.textContent = 'Holding your units';
        const body = {
          kitId,
          pickupDate: strip.state.pickupDate,
          returnDate: addDays(strip.state.pickupDate, strip.state.dayCount),
          renter: { name, email },
        };
        if (Object.keys(units).length > 0) {
          body.units = units;
        }
        const result = await api('/api/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `hold-${Date.now()}-${Math.random().toString(36).slice(2)}` },
          body: JSON.stringify(body),
        });
        if (result.status === 201) {
          const renterKey = result.body.renterKey;
          const ref = result.body.booking.ref;
          window.location.href = `/bookings/${ref}?key=${encodeURIComponent(renterKey)}`;
          return;
        }
        holdButton.textContent = 'Hold this kit';
        if (result.status === 409 && (result.body.error?.code ?? '') === 'unit_taken') {
          alertBox.hidden = false;
          const serial = result.body.error.serial;
          const nextFreeSerial = result.body.error.nextFreeSerial;
          alertBox.replaceChildren();
          const heading = el('h3', { text: 'This unit was just booked' });
          const copy = el('p', {
            text: serial === null
              ? 'The last free unit was taken by another booking a moment ago.'
              : `${serial} was taken by another booking a moment ago.`,
          });
          alertBox.append(heading, copy);
          if (nextFreeSerial !== null) {
            const instead = el('button', { className: 'btn btn-secondary', text: `Book ${nextFreeSerial} instead` });
            instead.addEventListener('click', () => {
              const radio = Array.from(holdForm.querySelectorAll('input[type="radio"]'))
                .find((node) => node.value === nextFreeSerial);
              if (radio !== undefined) {
                radio.checked = true;
                holdForm.requestSubmit();
              }
            });
            alertBox.append(instead);
            instead.focus();
          } else {
            const choose = el('button', { className: 'btn btn-secondary', text: 'Choose new dates' });
            choose.addEventListener('click', () => {
              handle.focus();
            });
            alertBox.append(choose);
            choose.focus();
          }
          return;
        }
        const fields = errorFields(result.body);
        const fieldKeys = Object.keys(fields);
        if (fieldKeys.length > 0) {
          const errorNode = document.getElementById('hold-error');
          const firstKey = fieldKeys[0];
          errorNode.textContent = fields[firstKey];
          const target = firstKey === 'renter.name'
            ? document.getElementById('renter-name')
            : firstKey === 'renter.email'
              ? document.getElementById('renter-email')
              : firstKey === 'pickupDate'
                ? document.getElementById('pickup-date')
                : document.getElementById('return-day');
          target?.focus();
          return;
        }
        const errorNode = document.getElementById('hold-error');
        errorNode.textContent = errorMessage(result.body) ?? 'We could not hold this kit.';
      });
    }
  }

  // ---------- booking page ----------

  async function initBooking(notices) {
    const ref = window.location.pathname.split('/bookings/')[1] ?? '';
    const key = new URLSearchParams(window.location.search).get('key') ?? '';
    const statusLine = document.getElementById('booking-status');
    const holdRegion = document.getElementById('hold-region');
    const holdLabel = document.getElementById('hold-label');
    const confirmButton = document.getElementById('confirm-button');
    const cancelButton = document.getElementById('cancel-button');
    const headingArea = document.getElementById('booking-heading-area');
    const certificateForm = document.getElementById('certificate-form');
    const cancelDialog = document.getElementById('cancel-dialog');
    let booking = null;
    let confirming = false;
    let remaining = null;
    let lastTick = null;

    async function load() {
      const result = await api(`/api/bookings/${ref}`, { headers: { 'X-Renter-Key': key } });
      if (result.status !== 200 || result.body === null) {
        statusLine.textContent = 'We could not load this booking.';
        return;
      }
      booking = result.body;
      remaining = booking.holdSecondsRemaining;
      lastTick = Date.now();
      render();
    }

    function render() {
      if (booking === null) {
        return;
      }
      const view = booking;
      const stateLabels = {
        quote: 'On hold',
        expired: 'Hold ended',
        confirmed: 'Confirmed',
        cancelled: 'Cancelled',
        prepped: 'Prepped',
        out: 'Out on hire',
        returned: 'Returned',
        closed: 'Closed',
      };
      statusLine.textContent = stateLabels[view.state] ?? view.state;
      headingArea.replaceChildren();
      if (view.state === 'quote') {
        headingArea.append(
          el('h2', { text: 'Held for you' }),
          el('p', { text: `Booking ${view.ref} is on hold. Upload your certificate and confirm before the hold ends.` }),
        );
      } else if (view.state === 'confirmed' || view.state === 'prepped' || view.state === 'out' || view.state === 'returned') {
        headingArea.append(
          el('h2', { text: "You're booked" }),
          el('p', { text: `Booking ${view.ref} is confirmed. We've emailed your serial list to ${view.renter.email}.` }),
        );
      } else if (view.state === 'expired') {
        headingArea.append(
          el('h2', { text: 'This hold has ended' }),
          el('p', { text: 'The units have been released. Pick dates again to make a new hold.' }),
        );
      } else if (view.state === 'cancelled') {
        headingArea.append(
          el('h2', { text: 'Booking cancelled' }),
          el('p', { text: `We've refunded ${money(view.totalCents)} to your card.` }),
        );
      }
      holdRegion.hidden = view.state !== 'quote';
      const depositLabel = {
        none: 'Not taken',
        pending: 'Pending',
        paid: 'Paid',
        failed: 'Failed',
        refunded: 'Refunded',
      }[view.paymentStatus] ?? 'Not taken';
      setText('deposit-label', `Deposit: ${depositLabel}`);
      setText('rate-card-label', `Rate card v${view.rateCardVersion}`);
      setText('booking-numerals', money(view.hirePriceCents));
      setText('booking-pickup', view.pickupDate);
      setText('booking-return', view.returnDate);
      setText('booking-billable', view.billableDays === 1 ? '1 billable day' : `${view.billableDays} billable days`);
      setText('booking-day-rate', money(view.dayRateCents));
      setText('booking-hire', money(view.hirePriceCents));
      setText('booking-deposit', money(view.depositCents));
      setText('booking-total', money(view.totalCents));
      const serialList = document.getElementById('serial-list');
      serialList.replaceChildren();
      for (const unit of view.units) {
        serialList.append(el('li', { text: `${unit.serial} · ${unit.className}` }));
      }
      const certStatus = document.getElementById('certificate-status');
      if (view.certificate === null) {
        certStatus.textContent = 'No certificate yet';
      } else if (view.certificate.status === 'approved') {
        certStatus.textContent = 'Certificate approved';
      } else if (view.certificate.status === 'rejected') {
        certStatus.textContent = `Certificate not accepted: ${view.certificate.reason ?? ''}`;
      } else {
        certStatus.textContent = 'Certificate under review';
      }
      confirmButton.disabled = !view.confirmable || confirming;
      cancelButton.hidden = view.state !== 'confirmed';
    }

    function setText(id, value) {
      const node = document.getElementById(id);
      if (node !== null) {
        node.textContent = value;
      }
    }

    window.setInterval(() => {
      if (remaining !== null && lastTick !== null && !holdRegion.hidden) {
        const elapsed = Math.floor((Date.now() - lastTick) / 1000);
        const left = Math.max(0, remaining - elapsed);
        holdLabel.textContent = countdownLabel(left);
        if (left === 0) {
          load();
        }
      }
    }, 1000);

    window.setInterval(() => {
      load();
    }, 30000);

    certificateForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('certificate-file');
      const file = input.files && input.files[0];
      if (file === undefined) {
        return;
      }
      const certStatus = document.getElementById('certificate-status');
      certStatus.textContent = 'Uploading certificate';
      const body = new FormData();
      body.append('file', file);
      const result = await api(`/api/bookings/${ref}/certificate`, {
        method: 'POST',
        headers: { 'X-Renter-Key': key },
        body,
      });
      if (result.status === 201) {
        certStatus.textContent = 'Certificate received. The owner will review it before you can confirm.';
        load();
      } else if (result.status === 503) {
        notices.mark('storage');
        certStatus.textContent = errorMessage(result.body) ?? 'Storage service unreachable';
      } else {
        const fields = errorFields(result.body);
        certStatus.textContent = fields.file ?? errorMessage(result.body) ?? 'Upload the certificate as a PDF';
      }
    });

    confirmButton.addEventListener('click', async () => {
      if (booking === null || confirming) {
        return;
      }
      confirming = true;
      confirmButton.disabled = true;
      confirmButton.textContent = 'Taking payment';
      setText('deposit-label', 'Deposit: Pending');
      const result = await api(`/api/bookings/${ref}/confirm`, {
        method: 'POST',
        headers: {
          'X-Renter-Key': key,
          'Idempotency-Key': `confirm-${ref}-${Date.now()}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      confirming = false;
      confirmButton.textContent = 'Confirm and pay';
      if (result.status === 200) {
        load();
        return;
      }
      if (result.status === 409) {
        const error = result.body.error ?? {};
        if (error.code === 'quote_repriced' && error.booking !== undefined) {
          booking = error.booking;
          render();
          const repriceNote = document.getElementById('reprice-note');
          repriceNote.textContent = `Prices changed on ${error.booking.pickupDate}. Check the new total and confirm again.`;
          repriceNote.hidden = false;
          return;
        }
      }
      if (result.status === 503) {
        const code = (result.body.error ?? {}).code;
        if (code === 'payments_unavailable') {
          notices.mark('payments');
        } else {
          notices.mark('storage');
        }
      }
      statusLine.textContent = errorMessage(result.body) ?? 'We could not confirm this booking.';
      load();
    });

    cancelButton.addEventListener('click', () => {
      openDialog(cancelDialog);
    });

    document.getElementById('cancel-confirm').addEventListener('click', async () => {
      closeDialog(cancelDialog);
      const result = await api(`/api/bookings/${ref}/cancel`, {
        method: 'POST',
        headers: { 'X-Renter-Key': key, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (result.status === 503) {
        notices.mark('payments');
      }
      load();
    });

    document.getElementById('cancel-keep').addEventListener('click', () => {
      closeDialog(cancelDialog);
    });

    await load();
  }

  // ---------- desk sign-in ----------

  function initDeskSignIn() {
    const form = document.getElementById('signin-form');
    const error = document.getElementById('signin-error');
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const passcode = document.getElementById('passcode').value;
      const result = await api('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      if (result.status === 200) {
        const role = result.body.role;
        window.location.href = role === 'owner' ? '/desk/owner' : '/desk/counter';
        return;
      }
      error.textContent = errorMessage(result.body) ?? "That passcode isn't recognised";
    });
  }

  // ---------- boot ----------

  document.addEventListener('DOMContentLoaded', () => {
    const page = document.body.dataset.page ?? '';
    const noticesContainer = document.getElementById('service-notices');
    const notices = new ServiceNotices(noticesContainer);
    notices.refresh();
    window.setInterval(() => {
      notices.refresh();
    }, 30000);

    if (page === 'catalogue' || page === 'kit') {
      initCatalogue(notices);
    } else if (page === 'booking') {
      initBooking(notices);
    } else if (page === 'desk-signin') {
      initDeskSignIn();
    } else if (page === 'counter') {
      window.TallyslateDesk.initCounter(notices, api, el, money, errorMessage, errorFields, openDialog, closeDialog);
    } else if (page === 'owner-desk') {
      window.TallyslateDesk.initOwnerDesk(notices, api, el, money, errorMessage, errorFields, openDialog, closeDialog);
    }
  });
})();
