// Tallyslate desk: counter and owner desk screens.

(() => {
  'use strict';

  function billableNote(days) {
    return days === 1 ? '1 billable day' : `${days} billable days`;
  }

  async function initCounter(notices, api, el, money, errorMessage, errorFields, openDialog, closeDialog) {
    const statusLine = document.getElementById('counter-status');
    const list = document.getElementById('bookings-list');
    const detail = document.getElementById('booking-detail');
    let bookings = [];
    let selectedRef = null;
    let lastDetailBooking = null;

    async function loadList() {
      const result = await api('/api/bookings');
      if (result.status !== 200 || result.body === null) {
        return;
      }
      const all = result.body.bookings;
      bookings = all.filter((booking) => !['closed', 'expired', 'cancelled'].includes(booking.state));
      renderList();
      if (window.innerWidth >= 1280 && bookings.length > 0) {
        if (selectedRef === null || !bookings.some((booking) => booking.ref === selectedRef)) {
          await selectBooking(bookings[0].ref);
        }
      } else if (bookings.length === 0) {
        detail.hidden = true;
      }
    }

    function renderList() {
      list.replaceChildren();
      const ul = el('ul');
      ul.setAttribute('role', 'list');
      ul.setAttribute('aria-label', 'Bookings');
      for (const booking of bookings) {
        const li = el('li');
        const button = el('button', {
          text: `${booking.ref} · ${booking.kit.name}`,
          attrs: { type: 'button' },
        });
        if (booking.ref === selectedRef) {
          button.setAttribute('aria-current', 'true');
        }
        button.addEventListener('click', () => {
          selectBooking(booking.ref);
        });
        li.append(button);
        ul.append(li);
      }
      if (bookings.length === 0) {
        ul.append(el('li', { text: 'No bookings to work on.' }));
      }
      list.append(ul);
    }

    async function selectBooking(ref) {
      selectedRef = ref;
      const result = await api(`/api/bookings/${ref}`);
      if (result.status !== 200 || result.body === null) {
        return;
      }
      lastDetailBooking = result.body;
      if (window.innerWidth < 1280) {
        list.hidden = true;
      }
      detail.hidden = false;
      renderDetail(lastDetailBooking);
      renderList();
    }

    async function refreshDetail() {
      if (selectedRef === null) {
        return;
      }
      const result = await api(`/api/bookings/${selectedRef}`);
      if (result.status === 200 && result.body !== null) {
        lastDetailBooking = result.body;
        renderDetail(lastDetailBooking);
      }
      await loadList();
    }

    function renderDetail(booking) {
      detail.replaceChildren();
      const back = el('button', { className: 'btn btn-ghost back-button', text: 'Back to bookings', attrs: { type: 'button' } });
      back.addEventListener('click', () => {
        detail.hidden = true;
        list.hidden = false;
        const button = list.querySelector(`button[aria-current="true"]`);
        if (button !== null) {
          button.focus();
        }
      });
      const heading = el('h2', { text: `${booking.ref} · ${booking.kit.name}` });
      heading.id = 'booking-detail-heading';
      heading.tabIndex = -1;
      const state = el('p', { className: 'state-line', text: booking.state });
      const rate = el('p', { text: `Rate card v${booking.rateCardVersion}` });
      const depositLabels = {
        none: 'Not taken',
        pending: 'Pending',
        paid: 'Paid',
        failed: 'Failed',
        refunded: 'Refunded',
      };
      const deposit = el('p', { text: `Deposit: ${depositLabels[booking.paymentStatus] ?? 'Not taken'}` });
      detail.append(back, heading, state, rate, deposit);

      const serialTable = el('table', { className: 'unit-table' });
      const headRow = el('tr');
      headRow.append(
        el('th', { text: 'Serial' }),
        el('th', { text: 'Location' }),
        el('th', { text: 'Photo' }),
        el('th', { text: 'Condition' }),
      );
      const head = el('thead');
      head.append(headRow);
      const body = el('tbody');
      for (const unit of booking.units) {
        const photos = booking.photos.filter((photo) => photo.serial === unit.serial && photo.phase === (booking.state === 'prepped' ? 'checkout' : 'checkin'));
        const latest = photos.length > 0 ? photos[photos.length - 1] : null;
        const statusText = latest === null ? '—' : latest.status === 'stored' ? 'Stored' : latest.status === 'failed' ? 'Failed' : 'Pending';
        const row = el('tr');
        row.append(
          el('td', { text: unit.serial }),
          el('td', { text: unit.location }),
          el('td', { className: `serial-photo-status ${latest?.status ?? ''}`, text: statusText }),
          el('td', { text: unit.condition ?? '' }),
        );
        body.append(row);
      }
      serialTable.append(head, body);
      detail.append(serialTable);

      if (booking.state === 'confirmed') {
        const prepRow = el('div', { className: 'btn-row' });
        const prepButton = el('button', { className: 'btn', text: 'Prep kit', attrs: { type: 'button' } });
        prepButton.addEventListener('click', async () => {
          const result = await api(`/api/bookings/${booking.ref}/prep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          if (result.status === 200) {
            statusLine.textContent = `Kit prepped · ${booking.ref}`;
            await refreshDetail();
          } else {
            const serials = (result.body.error ?? {}).serials;
            if (serials !== undefined) {
              statusLine.textContent = `${serials.join(', ')} not on the shelf`;
            } else {
              statusLine.textContent = errorMessage(result.body) ?? 'We could not prep this kit.';
            }
          }
        });
        prepRow.append(prepButton);
        detail.append(prepRow);
      }

      if (booking.state === 'quote' || booking.state === 'confirmed') {
        const swapRow = el('div', { className: 'btn-row' });
        for (const unit of booking.units) {
          const swapButton = el('button', { className: 'btn btn-secondary', text: `Swap ${unit.serial}`, attrs: { type: 'button' } });
          swapButton.addEventListener('click', () => {
            openSwapDialog(booking, unit.serial);
          });
          swapRow.append(swapButton);
        }
        detail.append(swapRow);
      }

      if (booking.state === 'prepped') {
        const blockers = el('ul', { className: 'blocker-list' });
        blockers.setAttribute('role', 'list');
        blockers.setAttribute('aria-label', 'Checkout blockers');
        for (const blocker of booking.checkout.blockers) {
          blockers.append(el('li', { text: blocker.message }));
        }
        const startButton = el('button', { className: 'btn', text: 'Start checkout', attrs: { type: 'button' } });
        startButton.disabled = !booking.checkout.allowed;
        startButton.addEventListener('click', () => {
          startCheckout(booking);
        });
        detail.append(blockers, startButton);
      }

      if (booking.state === 'out' || booking.state === 'returned') {
        const startCheckin = el('button', { className: 'btn', text: 'Start check-in', attrs: { type: 'button' } });
        startCheckin.addEventListener('click', () => {
          startCheckinFlow(booking);
        });
        detail.append(startCheckin);
      }

      if (booking.state === 'returned') {
        const blockers = el('ul', { className: 'blocker-list' });
        blockers.setAttribute('role', 'list');
        blockers.setAttribute('aria-label', 'Close blockers');
        for (const blocker of booking.close.blockers) {
          blockers.append(el('li', { text: blocker.message }));
        }
        const closeButton = el('button', { className: 'btn', text: 'Close check-in', attrs: { type: 'button' } });
        closeButton.disabled = !booking.close.allowed;
        closeButton.addEventListener('click', async () => {
          const result = await api(`/api/bookings/${booking.ref}/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `close-${booking.ref}-${Date.now()}` },
            body: '{}',
          });
          if (result.status === 200) {
            statusLine.textContent = `Check-in closed · ${booking.ref}`;
            selectedRef = null;
            await loadList();
          } else if (result.status === 503) {
            notices.mark('payments');
            statusLine.textContent = errorMessage(result.body) ?? 'Payment service unreachable';
          } else {
            statusLine.textContent = errorMessage(result.body) ?? 'We could not close this check-in.';
          }
        });
        detail.append(blockers, closeButton);
      }
    }

    async function openSwapDialog(booking, serial) {
      const unit = booking.units.find((candidate) => candidate.serial === serial);
      if (unit === undefined) {
        return;
      }
      const kitResult = await api(`/api/kits/${booking.kit.id}`);
      const options = [];
      if (kitResult.status === 200 && kitResult.body !== null) {
        for (const candidate of kitResult.body.units) {
          if (candidate.classId === unit.classId && candidate.serial !== serial) {
            options.push(candidate.serial);
          }
        }
      }
      const dialog = el('dialog');
      const heading = el('h3', { text: 'Swap unit' });
      const select = el('select');
      select.setAttribute('aria-label', 'Replacement serial');
      for (const option of options) {
        const optionNode = el('option', { text: option, attrs: { value: option } });
        select.append(optionNode);
      }
      const swap = el('button', { className: 'btn', text: 'Swap', attrs: { type: 'button' } });
      swap.addEventListener('click', async () => {
        const result = await api(`/api/bookings/${booking.ref}/swap`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: serial, to: select.value }),
        });
        closeDialog(dialog);
        dialog.remove();
        if (result.status === 200) {
          statusLine.textContent = `Swapped ${serial} for ${select.value}`;
          await refreshDetail();
        } else {
          statusLine.textContent = errorMessage(result.body) ?? 'We could not swap that unit.';
        }
      });
      dialog.append(heading, select, swap);
      document.body.append(dialog);
      openDialog(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
      });
    }

    function startCheckout(booking) {
      const region = el('section');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Checkout');
      const scan = el('input');
      scan.setAttribute('type', 'text');
      scan.setAttribute('aria-label', 'Scan serial');
      scan.setAttribute('autocomplete', 'off');
      const scanErrorNode = el('p', { className: 'field-error', text: '' });
      const groups = el('div');
      const review = el('button', { className: 'btn', text: 'Review checkout', attrs: { type: 'button' } });
      review.disabled = true;
      const unitState = new Map();

      for (const unit of booking.units) {
        unitState.set(unit.serial, { powersOn: false, accessories: false, cosmetic: false, notes: '', photo: 'none', done: false });
      }

      function allDone() {
        return booking.units.every((unit) => unitState.get(unit.serial).done);
      }

      function renderGroups() {
        groups.replaceChildren();
        for (const unit of booking.units) {
          const state = unitState.get(unit.serial);
          if (state.done) {
            const doneRow = el('div', { className: 'unit-group done-row' });
            doneRow.setAttribute('role', 'group');
            doneRow.setAttribute('aria-label', unit.serial);
            doneRow.append(el('span', { text: `${unit.serial} · done` }));
            groups.append(doneRow);
            continue;
          }
          const group = el('div', { className: 'unit-group' });
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', unit.serial);
          const heading = el('h4', { text: unit.serial });
          const checks = el('div', { className: 'checks' });
          const powersOn = makeCheck('Powers on');
          const accessories = makeCheck('Accessories present');
          const cosmetic = makeCheck('Cosmetic condition as listed');
          powersOn.checked = state.powersOn;
          accessories.checked = state.accessories;
          cosmetic.checked = state.cosmetic;
          checks.append(powersOn, accessories, cosmetic);
          const notes = el('input');
          notes.setAttribute('type', 'text');
          notes.setAttribute('aria-label', 'Condition notes');
          notes.value = state.notes;
          const photoInput = el('input');
          photoInput.setAttribute('type', 'file');
          photoInput.setAttribute('accept', 'image/jpeg,image/png');
          photoInput.setAttribute('aria-label', 'Condition photo');
          const photoStatus = el('span', { className: `serial-photo-status ${state.photo}`, text: state.photo === 'stored' ? 'Stored' : state.photo === 'failed' ? 'Failed' : '' });
          const done = el('button', { className: 'btn', text: 'Done with unit', attrs: { type: 'button' } });
          done.addEventListener('click', () => {
            if (!(powersOn.checked && accessories.checked && cosmetic.checked && state.photo === 'stored')) {
              scanErrorNode.textContent = 'Tick every check and attach a stored photo first';
              done.focus();
              return;
            }
            state.powersOn = powersOn.checked;
            state.accessories = accessories.checked;
            state.cosmetic = cosmetic.checked;
            state.notes = notes.value;
            state.done = true;
            scanErrorNode.textContent = '';
            renderGroups();
            review.disabled = !allDone();
            scan.focus();
          });
          group.append(heading, checks, notes, photoInput, photoStatus, done);
          groups.append(group);
        }
        review.disabled = !allDone();
      }

      photoUploadHandler(booking, 'checkout', unitState, groups);

      review.addEventListener('click', () => {
        const dialog = el('dialog');
        const heading = el('h3', { text: 'Confirm checkout' });
        const checkoutButton = el('button', { className: 'btn', text: 'Check out kit', attrs: { type: 'button' } });
        checkoutButton.addEventListener('click', async () => {
          const units = booking.units.map((unit) => ({
            serial: unit.serial,
            checklist: { powersOn: true, accessoriesPresent: true, cosmeticOk: true },
            notes: unitState.get(unit.serial).notes,
          }));
          const result = await api(`/api/bookings/${booking.ref}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ units }),
          });
          closeDialog(dialog);
          dialog.remove();
          if (result.status === 200) {
            statusLine.textContent = `Kit out · ${booking.ref}`;
            await refreshDetail();
            const headingNode = detail.querySelector('#booking-detail-heading');
            if (headingNode !== null) {
              headingNode.focus();
            }
          } else {
            statusLine.textContent = errorMessage(result.body) ?? 'We could not check this kit out.';
          }
        });
        const back = el('button', { className: 'btn btn-ghost', text: 'Back', attrs: { type: 'button' } });
        back.addEventListener('click', () => {
          closeDialog(dialog);
          dialog.remove();
          review.focus();
        });
        dialog.append(heading, checkoutButton, back);
        document.body.append(dialog);
        openDialog(dialog);
        dialog.addEventListener('close', () => {
          dialog.remove();
        });
      });

      scan.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        const serial = scan.value.trim();
        scan.value = '';
        const unit = booking.units.find((candidate) => candidate.serial === serial);
        if (unit === undefined) {
          scanErrorNode.textContent = `${serial} is not on this booking`;
          scan.focus();
          return;
        }
        const state = unitState.get(serial);
        state.done = false;
        scanErrorNode.textContent = '';
        renderGroups();
        const group = groups.querySelector(`[aria-label="${serial}"]`);
        const firstInput = group !== null ? group.querySelector('input') : null;
        if (firstInput !== null) {
          firstInput.focus();
        }
      });

      region.append(scan, scanErrorNode, groups, review);
      detail.append(region);
      renderGroups();
      scan.focus();
    }

    function photoUploadHandler(booking, phase, unitState, groups) {
      groups.addEventListener('change', async (event) => {
        const input = event.target;
        if (input.getAttribute('aria-label') !== 'Condition photo') {
          return;
        }
        const group = input.closest('[role="group"]');
        const serial = group.getAttribute('aria-label');
        const state = unitState.get(serial);
        const file = input.files && input.files[0];
        if (file === undefined) {
          return;
        }
        state.photo = 'pending';
        const photoStatus = group.querySelector('.serial-photo-status');
        photoStatus.textContent = 'Uploading photo';
        const body = new FormData();
        body.append('phase', phase);
        body.append('serial', serial);
        body.append('file', file);
        const result = await api(`/api/bookings/${booking.ref}/photos`, { method: 'POST', body });
        if (result.status === 201) {
          const stored = result.body.status === 'stored';
          state.photo = stored ? 'stored' : 'failed';
          photoStatus.textContent = stored ? 'Stored' : 'Failed';
          photoStatus.className = `serial-photo-status ${state.photo}`;
          if (!stored) {
            notices.mark('storage');
          }
        } else {
          state.photo = 'failed';
          photoStatus.textContent = 'Failed';
          photoStatus.className = `serial-photo-status failed`;
          if (result.status === 503) {
            notices.mark('storage');
          }
        }
      });
    }

    function makeCheck(label) {
      const input = el('input', { attrs: { type: 'checkbox' } });
      input.setAttribute('aria-label', label);
      return input;
    }

    function startCheckinFlow(booking) {
      const region = el('section');
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', 'Check-in');
      const scan = el('input');
      scan.setAttribute('type', 'text');
      scan.setAttribute('aria-label', 'Scan serial');
      scan.setAttribute('autocomplete', 'off');
      const scanErrorNode = el('p', { className: 'field-error', text: '' });
      const groups = el('div');
      const unitState = new Map();

      for (const unit of booking.units) {
        if (!unit.checkedIn) {
          unitState.set(unit.serial, { condition: 'ok', charge: '', notes: '', photo: 'none' });
        }
      }

      function renderGroups() {
        groups.replaceChildren();
        for (const [serial, state] of unitState) {
          if (state.submitted) {
            const doneRow = el('div', { className: 'unit-group done-row' });
            doneRow.setAttribute('role', 'group');
            doneRow.setAttribute('aria-label', serial);
            doneRow.append(el('span', { text: `${serial} · checked in` }));
            groups.append(doneRow);
            continue;
          }
          const group = el('div', { className: 'unit-group' });
          group.setAttribute('role', 'group');
          group.setAttribute('aria-label', serial);
          const heading = el('h4', { text: serial });
          const radios = el('div', { className: 'checks' });
          const okLabel = el('label');
          const ok = el('input', { attrs: { type: 'radio', name: `condition-${serial}`, value: 'ok' } });
          ok.checked = state.condition === 'ok';
          okLabel.append(ok, document.createTextNode(' OK'));
          const damagedLabel = el('label');
          const damaged = el('input', { attrs: { type: 'radio', name: `condition-${serial}`, value: 'damaged' } });
          damaged.checked = state.condition === 'damaged';
          damagedLabel.append(damaged, document.createTextNode(' Damaged'));
          radios.append(okLabel, damagedLabel);
          const charge = el('input');
          charge.setAttribute('type', 'text');
          charge.setAttribute('inputmode', 'decimal');
          charge.setAttribute('aria-label', 'Damage charge');
          charge.value = state.charge;
          charge.disabled = state.condition !== 'damaged';
          const notes = el('input');
          notes.setAttribute('type', 'text');
          notes.setAttribute('aria-label', 'Condition notes');
          notes.value = state.notes;
          const photoInput = el('input');
          photoInput.setAttribute('type', 'file');
          photoInput.setAttribute('accept', 'image/jpeg,image/png');
          photoInput.setAttribute('aria-label', 'Condition photo');
          const photoStatus = el('span', { className: `serial-photo-status ${state.photo}`, text: state.photo === 'stored' ? 'Stored' : state.photo === 'failed' ? 'Failed' : '' });
          const submit = el('button', { className: 'btn', text: 'Check in unit', attrs: { type: 'button' } });
          submit.addEventListener('click', async () => {
            const damageChargeCents = state.condition === 'damaged'
              ? Math.round(Number.parseFloat(charge.value || '0') * 100)
              : 0;
            const result = await api(`/api/bookings/${booking.ref}/checkin`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ serial, condition: state.condition, damageChargeCents, notes: notes.value }),
            });
            if (result.status === 200) {
              statusLine.textContent = `${serial} checked in`;
              state.submitted = true;
              scanErrorNode.textContent = '';
              renderGroups();
              scan.focus();
              if (result.body.state === 'returned') {
                await refreshDetail();
              }
              return;
            }
            scanErrorNode.textContent = errorMessage(result.body) ?? 'We could not check that unit in.';
          });
          group.append(heading, radios, charge, notes, photoInput, photoStatus, submit);
          groups.append(group);
        }
      }

      photoUploadHandler(booking, 'checkin', unitState, groups);

      scan.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') {
          return;
        }
        event.preventDefault();
        const serial = scan.value.trim();
        scan.value = '';
        const unit = booking.units.find((candidate) => candidate.serial === serial);
        if (unit === undefined) {
          scanErrorNode.textContent = `${serial} is not on this booking`;
          scan.focus();
          return;
        }
        if (unit.checkedIn) {
          scanErrorNode.textContent = `${serial} is already checked in`;
          scan.focus();
          return;
        }
        if (!unitState.has(serial)) {
          unitState.set(serial, { condition: 'ok', charge: '', notes: '', photo: 'none' });
        }
        scanErrorNode.textContent = '';
        renderGroups();
        const group = groups.querySelector(`[aria-label="${serial}"]`);
        const firstInput = group !== null ? group.querySelector('input') : null;
        if (firstInput !== null) {
          firstInput.focus();
        }
      });

      region.append(scan, scanErrorNode, groups);
      detail.append(region);
      renderGroups();
      scan.focus();
    }

    await loadList();
  }

  async function initOwnerDesk(notices, api, el, money, errorMessage, errorFields, openDialog, closeDialog) {
    const statusLine = document.getElementById('desk-status');
    const session = await api('/api/session');
    if (session.status !== 200) {
      window.location.href = '/desk';
      return;
    }
    if (session.body.role !== 'owner') {
      document.getElementById('owner-only').hidden = false;
      document.getElementById('desk-sections').hidden = true;
      return;
    }

    await refreshUtilisation();
    await refreshCertificates();
    await refreshRateCards();
    await refreshUnits();

    async function refreshUtilisation() {
      const result = await api('/api/utilisation');
      if (result.status !== 200 || result.body === null) {
        return;
      }
      const data = result.body;
      const util = document.getElementById('utilisation-numbers');
      util.replaceChildren();
      util.append(
        el('p', { text: `${data.out} of ${data.totalUnits} units out` }),
        el('p', { text: `${data.onShelf} on the shelf` }),
        el('p', { text: `${data.repair} in repair` }),
        el('div', { className: 'stat-value', text: `${data.utilisationPercent}% utilisation` }),
      );
      const kitsRegion = document.getElementById('kits-region');
      kitsRegion.replaceChildren();
      const kitNames = new Map();
      const kitsResult = await api('/api/kits');
      if (kitsResult.status === 200 && kitsResult.body !== null) {
        for (const kit of kitsResult.body.kits) {
          kitNames.set(kit.id, kit.name);
        }
      }
      for (const kit of data.kits) {
        kitsRegion.append(el('p', {
          text: `${kitNames.get(kit.kitId) ?? kit.kitId} · ${kit.readyToGo} ready to go`,
        }));
      }
    }

    async function refreshCertificates() {
      const result = await api('/api/certificates?status=pending_review');
      if (result.status !== 200 || result.body === null) {
        return;
      }
      const region = document.getElementById('certificates-region');
      region.replaceChildren();
      if (result.body.certificates.length === 0) {
        region.append(el('p', { text: 'No certificates to review.' }));
        return;
      }
      for (const certificate of result.body.certificates) {
        const row = el('p');
        const review = el('button', { className: 'btn btn-secondary', text: `Review ${certificate.bookingRef}`, attrs: { type: 'button' } });
        review.addEventListener('click', () => {
          openReviewDialog(certificate);
        });
        row.append(review);
        region.append(row);
      }
    }

    function openReviewDialog(certificate) {
      const dialog = el('dialog');
      const heading = el('h3', { text: 'Review certificate' });
      const openLink = el('a', { text: 'Open certificate PDF', attrs: { href: `/api/certificates/${certificate.id}/file`, target: '_blank' } });
      const startField = el('input', { attrs: { type: 'date' } });
      startField.setAttribute('aria-label', 'Cover starts');
      const endField = el('input', { attrs: { type: 'date' } });
      endField.setAttribute('aria-label', 'Cover ends');
      const limitField = el('input', { attrs: { type: 'text', inputmode: 'decimal' } });
      limitField.setAttribute('aria-label', 'Limit');
      const payeeLabel = el('label');
      const payee = el('input', { attrs: { type: 'checkbox' } });
      payeeLabel.append(payee, document.createTextNode(' Names Northbar Camera Hire as loss payee'));
      const approve = el('button', { className: 'btn', text: 'Approve', attrs: { type: 'button' } });
      const reasonField = el('input', { attrs: { type: 'text' } });
      reasonField.setAttribute('aria-label', 'Reason');
      const reject = el('button', { className: 'btn btn-danger', text: 'Reject', attrs: { type: 'button' } });
      const error = el('p', { className: 'field-error', text: '' });
      approve.addEventListener('click', async () => {
        const limitCents = Math.round(Number.parseFloat(limitField.value || '0') * 100);
        const result = await api(`/api/certificates/${certificate.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision: 'approve',
            coverageStart: startField.value,
            coverageEnd: endField.value,
            limitCents,
            lossPayeeNamed: payee.checked,
          }),
        });
        if (result.status === 200) {
          statusLine.textContent = `Certificate for ${certificate.bookingRef} approved`;
          closeDialog(dialog);
          dialog.remove();
          await refreshCertificates();
          return;
        }
        const fields = errorFields(result.body);
        error.textContent = Object.values(fields)[0] ?? errorMessage(result.body) ?? 'We could not record that review.';
      });
      reject.addEventListener('click', async () => {
        const result = await api(`/api/certificates/${certificate.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'reject', reason: reasonField.value }),
        });
        if (result.status === 200) {
          statusLine.textContent = `Certificate for ${certificate.bookingRef} rejected`;
          closeDialog(dialog);
          dialog.remove();
          await refreshCertificates();
          return;
        }
        const fields = errorFields(result.body);
        error.textContent = Object.values(fields)[0] ?? errorMessage(result.body) ?? 'We could not record that review.';
      });
      dialog.append(heading, openLink, startField, endField, limitField, payeeLabel, approve, reasonField, reject, error);
      document.body.append(dialog);
      openDialog(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
      });
    }

    async function refreshRateCards() {
      const result = await api('/api/rate-cards');
      if (result.status !== 200 || result.body === null) {
        return;
      }
      const data = result.body;
      const table = document.getElementById('rate-card-table');
      const body = table.tBodies[0];
      body.replaceChildren();
      for (const card of [...data.rateCards].reverse()) {
        const row = el('tr');
        row.append(
          el('td', { text: `v${card.version}` }),
          el('td', { text: card.effectiveDate }),
          el('td', { text: card.rates.map((rate) => `${rate.kitId} ${money(rate.dayRateCents)}/${money(rate.depositCents)}`).join(' · ') }),
        );
        body.append(row);
      }
      document.getElementById('active-rate-card').textContent =
        data.activeVersion === null ? 'No active rate card' : `Active: v${data.activeVersion}`;
    }

    document.getElementById('publish-rate-card').addEventListener('click', async () => {
      const kitsResult = await api('/api/kits');
      if (kitsResult.status !== 200 || kitsResult.body === null) {
        return;
      }
      const kits = kitsResult.body.kits;
      const dialog = el('dialog');
      const heading = el('h3', { text: 'Publish rate card' });
      const effective = el('input', { attrs: { type: 'date' } });
      effective.setAttribute('aria-label', 'Effective date');
      effective.value = new Date().toISOString().slice(0, 10);
      const error = el('p', { className: 'field-error', text: '' });
      const fields = [];
      for (const kit of kits) {
        const dayRate = el('input', { attrs: { type: 'text', inputmode: 'decimal' } });
        dayRate.setAttribute('aria-label', `${kit.name} day rate`);
        dayRate.value = ((kit.dayRateCents ?? 0) / 100).toFixed(2);
        const deposit = el('input', { attrs: { type: 'text', inputmode: 'decimal' } });
        deposit.setAttribute('aria-label', `${kit.name} deposit`);
        deposit.value = ((kit.depositCents ?? 0) / 100).toFixed(2);
        fields.push({ kit, dayRate, deposit });
      }
      const publish = el('button', { className: 'btn', text: 'Publish', attrs: { type: 'button' } });
      publish.addEventListener('click', async () => {
        const rates = fields.map((field) => ({
          kitId: field.kit.id,
          dayRateCents: Math.round(Number.parseFloat(field.dayRate.value || '0') * 100),
          depositCents: Math.round(Number.parseFloat(field.deposit.value || '0') * 100),
        }));
        const result = await api('/api/rate-cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ effectiveDate: effective.value, rates }),
        });
        if (result.status === 201) {
          const card = result.body;
          statusLine.textContent = `Rate card v${card.version} published, effective ${card.effectiveDate}`;
          closeDialog(dialog);
          dialog.remove();
          await refreshRateCards();
          return;
        }
        const fieldsErrors = errorFields(result.body);
        error.textContent = Object.values(fieldsErrors)[0] ?? errorMessage(result.body) ?? 'We could not publish that rate card.';
      });
      dialog.append(heading, effective);
      for (const field of fields) {
        dialog.append(field.dayRate, field.deposit);
      }
      dialog.append(publish, error);
      document.body.append(dialog);
      openDialog(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
      });
    });

    async function refreshUnits() {
      const region = document.getElementById('units-region');
      region.replaceChildren();
      const kitsResult = await api('/api/kits');
      if (kitsResult.status !== 200 || kitsResult.body === null) {
        return;
      }
      const kitIds = kitsResult.body.kits.map((kit) => kit.id);
      const serials = [];
      for (const kitId of kitIds) {
        const result = await api(`/api/kits/${kitId}`);
        if (result.status === 200 && result.body !== null) {
          for (const unit of result.body.units) {
            serials.push(unit.serial);
          }
        }
      }
      for (const serial of serials) {
        const history = await api(`/api/units/${serial}/history`);
        if (history.status !== 200 || history.body === null) {
          continue;
        }
        const data = history.body;
        const row = el('p');
        row.append(el('span', { text: `${serial} · ${data.location}` }));
        const historyButton = el('button', { className: 'btn btn-ghost', text: `History ${serial}`, attrs: { type: 'button' } });
        historyButton.addEventListener('click', () => {
          openHistoryDialog(serial);
        });
        row.append(historyButton);
        if (data.location === 'shelf') {
          const repairButton = el('button', { className: 'btn btn-secondary', text: `Send ${serial} to repair`, attrs: { type: 'button' } });
          repairButton.addEventListener('click', async () => {
            const move = await api(`/api/units/${serial}/moves`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: 'repair' }),
            });
            if (move.status === 201) {
              statusLine.textContent = `${serial} sent to repair`;
              await refreshUnits();
              await refreshUtilisation();
            } else {
              statusLine.textContent = errorMessage(move.body) ?? 'We could not move that unit.';
            }
          });
          row.append(repairButton);
        } else if (data.location === 'repair') {
          const returnButton = el('button', { className: 'btn btn-secondary', text: `Return ${serial} from repair`, attrs: { type: 'button' } });
          returnButton.addEventListener('click', async () => {
            const move = await api(`/api/units/${serial}/moves`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: 'shelf' }),
            });
            if (move.status === 201) {
              statusLine.textContent = `${serial} back on the shelf`;
              await refreshUnits();
              await refreshUtilisation();
            } else {
              statusLine.textContent = errorMessage(move.body) ?? 'We could not move that unit.';
            }
          });
          row.append(returnButton);
        }
        region.append(row);
      }
    }

    async function openHistoryDialog(serial) {
      const history = await api(`/api/units/${serial}/history`);
      if (history.status !== 200 || history.body === null) {
        return;
      }
      const dialog = el('dialog');
      dialog.setAttribute('aria-label', `Unit history ${serial}`);
      const heading = el('h3', { text: `Unit history ${serial}` });
      const list = el('ul');
      for (const movement of history.body.movements) {
        const entry = el('li', {
          text: `${movement.at.slice(0, 10)} · ${movement.reason} · ${movement.from} → ${movement.to}`,
        });
        list.append(entry);
      }
      dialog.append(heading, list);
      document.body.append(dialog);
      openDialog(dialog);
      dialog.addEventListener('close', () => {
        dialog.remove();
      });
    }
  }

  window.TallyslateDesk = { initCounter, initOwnerDesk };
})();
