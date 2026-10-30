// Corvo page script. Every page works as a plain document; this upgrades the delivered HTML in place.
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OUTAGE = "Corvo can't reach its database. Nothing was changed. Try again in a moment.";
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  // ---------------------------------------------------------------- notifications
  let toastTimer = null;
  function toast(note) {
    if (!note) return;
    const region = $('#toasts');
    const p = document.createElement('p');
    p.className = `toast toast--${note.kind || 'success'}`;
    const span = document.createElement('span');
    span.textContent = note.text;
    p.append(span);
    region.replaceChildren(p);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      p.classList.add('toast--leaving');
      setTimeout(() => p.remove(), reduced() ? 0 : 250);
    }, 5000);
  }

  // ---------------------------------------------------------------- header menus, sheets and pricing questions
  function closeMenus(except) {
    $$('[data-menu].is-open').forEach((menu) => {
      if (menu === except) return;
      menu.classList.remove('is-open');
      $('.menu__button', menu).setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('.menu__button');
    if (button) {
      const menu = button.closest('[data-menu]');
      const open = !menu.classList.contains('is-open');
      closeMenus(menu);
      menu.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
      return;
    }
    if (!event.target.closest('[data-menu]')) closeMenus();
    const sheet = event.target.closest('[data-sheet]');
    if (sheet) {
      const open = sheet.getAttribute('aria-expanded') !== 'true';
      sheet.setAttribute('aria-expanded', String(open));
      document.getElementById(sheet.dataset.sheet).classList.toggle('is-open', open);
      document.body.classList.toggle('sheet-open', open && sheet.dataset.sheet === 'site-nav');
    }
    const faq = event.target.closest('.faq__button');
    if (faq) {
      const open = faq.getAttribute('aria-expanded') !== 'true';
      $$('.faq__button').forEach((b) => {
        b.setAttribute('aria-expanded', String(b === faq && open));
        b.closest('[data-faq]').classList.toggle('is-open', b === faq && open);
      });
    }
  });

  // ---------------------------------------------------------------- Escape
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || $('dialog[open]')) return;
    const menu = $('[data-menu].is-open');
    if (menu) {
      closeMenus();
      $('.menu__button', menu).focus();
      return;
    }
    const row = event.target.closest?.('[data-create-row]');
    if (row) {
      closeCreateRow();
      return;
    }
    const reject = event.target.closest?.('.reject-panel.is-open');
    if (reject) {
      const button = $(`[aria-controls="${reject.id}"]`);
      reject.classList.remove('is-open');
      button.setAttribute('aria-expanded', 'false');
      button.focus();
      return;
    }
    const sheet = $('[data-sheet][aria-expanded="true"]');
    if (sheet) {
      sheet.click();
      sheet.focus();
    }
  });

  // ---------------------------------------------------------------- motion: sections, headline words, the hero approval
  // Each headline word sharpens about a twentieth of a second after the one before it.
  function words(root = document) {
    $$('[data-blur]', root).forEach((heading) => {
      $$('.word', heading).forEach((word, i) => { word.style.animationDelay = `${i * 45}ms`; });
    });
  }

  function reveal() {
    const blocks = $$('.reveal');
    if (!blocks.length) return;
    if (reduced() || !('IntersectionObserver' in window)) {
      blocks.forEach((b) => b.classList.add('is-in'));
      return;
    }
    // A section already on screen at first paint rests in place; the others rise as they enter.
    blocks.filter((b) => b.getBoundingClientRect().top < window.innerHeight).forEach((b) => b.classList.add('is-in', 'reveal--rest'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.2 });
    blocks.filter((b) => !b.classList.contains('is-in')).forEach((b) => observer.observe(b));
  }

  // From 0 to 400 pixels of scroll the bar grows from half to full; past 200 the second approver signs.
  function heroScrub() {
    const panel = $('[data-hero-panel]');
    if (!panel || reduced()) return;
    const fill = $('.progress__fill--hero', panel);
    const bar = $('[data-hero-bar]', panel);
    const count = $('[data-hero-count]', panel);
    const badge = $('[data-hero-badge]', panel);
    const signer = $('[data-hero-signer]', panel);
    const update = () => {
      const y = Math.max(0, Math.min(window.scrollY, 400));
      fill.style.width = `${50 + (y / 400) * 50}%`;
      const signed = window.scrollY > 200;
      count.textContent = signed ? '2 of 2 approvals' : '1 of 2 approvals';
      bar.setAttribute('aria-valuenow', signed ? '2' : '1');
      badge.textContent = signed ? 'executed' : 'pending_approval';
      badge.className = `badge badge--${signed ? 'executed' : 'pending_approval'}`;
      signer.classList.toggle('signer--done', signed);
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ---------------------------------------------------------------- busy submitters
  const labels = new WeakMap();
  function busy(button, on) {
    if (!button) return;
    button.disabled = on;
    button.toggleAttribute('aria-busy', on);
    if (on && reduced()) {
      labels.set(button, [...button.childNodes]);
      button.textContent = 'Working';
    } else if (!on && labels.has(button)) {
      button.replaceChildren(...labels.get(button));
      labels.delete(button);
    }
  }

  // ---------------------------------------------------------------- requests
  async function send(form, submitter, extra = {}) {
    const data = new URLSearchParams(new FormData(form, submitter));
    const method = (form.getAttribute('method') || 'get').toUpperCase();
    const action = form.getAttribute('action') || location.pathname;
    const url = method === 'GET' ? `${action}?${data}` : action;
    const res = await fetch(url, { method, body: method === 'GET' ? undefined : data, credentials: 'same-origin',
      headers: { 'X-Corvo-Fetch': '1', Accept: 'application/json, text/html', ...extra } });
    if (res.redirected && new URL(res.url).pathname === '/login') {
      location.assign(res.url);
      return new Promise(() => {});
    }
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) return { res, json: await res.json() };
    return { res, doc: new DOMParser().parseFromString(await res.text(), 'text/html') };
  }

  async function getDoc(url) {
    const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  // Replaces a part of the page with the same part of another document.
  function swap(doc, selector) {
    const next = $(selector, doc);
    const current = $(selector);
    if (!next || !current) return null;
    current.replaceWith(next);
    words(next);
    return next;
  }

  // Draws the current page again: the work surface and the rail (its count), keeping the notifications.
  async function refresh() {
    const doc = await getDoc(location.pathname + location.search.replace(/([?&])(create|confirm|remove|reveal)=[^&]*/g, '$1'));
    swap(doc, '#main');
    swap(doc, '#rail');
    document.title = doc.title;
  }

  function clearMarks(form) {
    $$('[data-client-error]', form).forEach((p) => p.remove());
    $$('[aria-invalid="true"]', form).forEach((el) => {
      el.removeAttribute('aria-invalid');
      const described = (el.getAttribute('aria-describedby') || '').split(' ').filter((id) => id && document.getElementById(id));
      if (described.length) el.setAttribute('aria-describedby', described.join(' '));
      else el.removeAttribute('aria-describedby');
    });
    $$('.field__error[id^="err-"]', form).forEach((p) => p.remove());
  }

  // Marks one field invalid, described by the message under it, and moves focus there.
  function markField(form, name, message, { focus = true } = {}) {
    const el = form.elements.namedItem(name);
    if (!el || !el.focus) return false;
    const id = `client-${name.replace(/[^a-z0-9]/gi, '-')}`;
    document.getElementById(id)?.remove();
    const p = document.createElement('p');
    p.className = 'field__error';
    p.id = id;
    p.dataset.clientError = '';
    p.textContent = message;
    el.insertAdjacentElement('afterend', p);
    el.setAttribute('aria-invalid', 'true');
    el.setAttribute('aria-describedby', [...new Set([...(el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean), id])].join(' '));
    if (focus) el.focus();
    return true;
  }

  function setResult(form, text, kind = 'success') {
    const line = form && $('[data-result]', form);
    if (!line) return false;
    line.textContent = text;
    line.classList.toggle('form-result--error', kind === 'error');
    return true;
  }

  // A refused console write: outage toast, the field marked, the form's result line, or a toast.
  function showRefusal(form, json, status) {
    if (status === 503) {
      toast({ text: OUTAGE, kind: 'error' });
      return;
    }
    const { error, result } = json;
    if (error.details?.path !== undefined && form.dataset.fetch === 'policy') {
      showPolicyRefusal(form, error);
      return;
    }
    if (error.details?.field && markField(form, error.details.field, error.message)) {
      toast({ text: error.message, kind: 'error' });
      return;
    }
    if (setResult(form, result?.text || error.message, 'error')) return;
    toast({ text: error.message, kind: 'error' });
  }

  // A refused save keeps every edit, names the path and focuses the field that matches it.
  function showPolicyRefusal(form, error) {
    let alert = $('[data-save-error]', form);
    if (!alert) {
      alert = document.createElement('p');
      alert.className = 'form-alert';
      alert.id = 'save-error';
      alert.setAttribute('role', 'alert');
      alert.dataset.saveError = '';
      $('.editor__foot', form).before(alert);
    }
    alert.textContent = `${error.message} at ${error.details.path}`;
    const field = $(`[data-path="${CSS.escape(error.details.path)}"]`, form);
    if (field) {
      field.setAttribute('aria-invalid', 'true');
      field.setAttribute('aria-describedby', alert.id);
      field.focus();
    }
    toast({ text: alert.textContent, kind: 'error' });
  }

  // ---------------------------------------------------------------- what each enhanced form does
  const after = {
    // A write that worked: the page is drawn again, then the form's result line and the toast.
    async default(form, json) {
      const name = form.dataset.fetch;
      await refresh();
      const fresh = $(`[data-fetch="${name}"]`);
      if (json.result) setResult(fresh, json.result.text);
      toast(json.toast);
      const button = fresh && $('[type=submit]', fresh);
      if (button) button.focus();
    },
    async 'create-wallet'(form, json) {
      await refresh();
      toast(json.toast);
      $('[data-create-toggle]')?.focus();
    },
    async approve(form, json) {
      const group = form.closest('[data-intent]');
      const groups = $$('[data-intent]');
      const at = groups.indexOf(group);
      const target = groups[at + 1] || groups[at - 1];
      const bar = $('.progress', group);
      if (bar && !reduced()) {
        const pct = json.required ? Math.min(100, (json.approved / json.required) * 100) : 0;
        $('.progress__text', group).textContent = `${json.approved} of ${json.required} approvals`;
        bar.setAttribute('aria-valuenow', String(json.approved));
        const fill = $('.progress__fill', bar);
        await fill.animate([{ width: getComputedStyle(fill).width }, { width: `${pct}%` }],
          { duration: 400, easing: 'cubic-bezier(.34,1.56,.64,1)', fill: 'forwards' }).finished.catch(() => {});
      }
      await settleInbox(json, target?.dataset.intent);
    },
    async reject(form, json) {
      const group = form.closest('[data-intent]');
      const groups = $$('[data-intent]');
      const at = groups.indexOf(group);
      const target = groups[at + 1] || groups[at - 1];
      await settleInbox(json, target?.dataset.intent);
    },
    async freeze(form, json) {
      await refresh();
      toast(json.toast);
      $('[data-fetch="unfreeze"] button')?.focus();
    },
    async unfreeze(form, json) {
      await refresh();
      toast(json.toast);
      $('[data-dialog-opener] button')?.focus();
    },
    async cancel(form, json) {
      const id = form.closest('[data-details-row]')?.id;
      await refresh();
      toast(json.toast);
      $(`[aria-controls="${id}"]`)?.focus();
    },
    async role(form, json) {
      const id = form.closest('[data-member]')?.dataset.member;
      await refresh();
      toast(json.toast);
      document.getElementById(`role-${id}`)?.focus();
    },
    async 'remove-member'(form, json) {
      await refresh();
      toast(json.toast);
      $('#members-heading')?.closest('.panel')?.querySelector('[data-toggle]')?.focus();
    },
    async verify(form, json) {
      const status = $('[data-chain-status]');
      status.textContent = json.chain.text;
      status.classList.toggle('chain-status--broken', !json.chain.valid);
      form.querySelector('button').focus();
    },
    async reveal(form, json) {
      $('[data-secret]').textContent = json.secret;
      form.querySelector('button').focus();
    },
  };

  // After a decision the row leaves; focus goes to the next row's Approve, else the previous one, else the empty state.
  async function settleInbox(json, targetId) {
    await refresh();
    toast(json.toast);
    const target = targetId && document.getElementById(`row-${targetId}`);
    const approve = target ? $('[data-fetch="approve"] button', target) : $('[data-fetch="approve"] button');
    if (approve) approve.focus();
    else $('[data-empty]')?.focus();
  }

  // Forms that answer with a page: the named part is swapped in place.
  const SWAPS = { contact: '#contact-card', simulate: '#simulate', policy: '#rules', key: '#main' };

  function focusAfterSwap(name, part, submitter) {
    const invalid = $('[aria-invalid="true"]', part);
    if (invalid) return invalid.focus();
    const landing = $('[data-focus-on-load]', part);
    if (landing) return landing.focus();
    if (name === 'policy' && submitter?.value) {
      const [op, i] = submitter.value.split(':');
      if (op === 'add-rule') return $$('input[name$="_name"]', part).pop()?.focus();
      if (op === 'add-cond') return $$(`input[name^="r${i}_c"][name$="_field"]`, part).pop()?.focus();
      const same = $(`button[name=op][value="${submitter.value}"]:not([disabled])`, part);
      if (same) return same.focus();
    }
    return $('[type=submit]', part)?.focus();
  }

  document.addEventListener('submit', async (event) => {
    const form = event.target;
    const submitter = event.submitter;
    if (submitter?.hasAttribute('aria-busy') || form.querySelector('[aria-busy]')) {
      event.preventDefault();
      return;
    }
    if (form.matches('[data-dialog-opener]')) return openDialog(event, form, submitter);
    if (submitter?.hasAttribute('data-dialog-close')) {
      event.preventDefault();
      submitter.closest('dialog').close();
      return;
    }
    if (form.matches('[data-fetch="batch"]') && submitter && submitter.value !== 'submit') {
      event.preventDefault();
      if (submitter.value === 'add') addLine(form);
      else removeLine(form, submitter);
      return;
    }
    if (form.matches('[data-create-open]')) {
      event.preventDefault();
      openCreateRow();
      return;
    }
    if (form.matches('[data-filter]')) {
      event.preventDefault();
      filterIntents(form);
      return;
    }
    if (form.matches('[data-load-more]')) {
      event.preventDefault();
      loadMore(form, submitter);
      return;
    }
    const name = form.dataset.fetch;
    if (!name) {
      busy(submitter || $('[type=submit]', form), true);
      return;
    }
    event.preventDefault();
    if (name === 'reject' && !rejectReady(form)) return;
    const button = submitter || $('[type=submit]', form);
    const hadFocus = document.activeElement === button;
    clearMarks(form);
    busy(button, true);
    try {
      const { res, json, doc } = await send(form, submitter);
      if (doc) {
        const part = swap(doc, SWAPS[name] || '#main');
        if (!part) throw new Error('nothing to swap');
        const toasts = $('#toasts', doc);
        if (toasts?.children.length) $('#toasts').replaceChildren(...toasts.childNodes);
        if (res.status >= 500 && res.status !== 503) throw new Error('server error');
        focusAfterSwap(name, part, submitter);
        return;
      }
      if (json.ok) await (after[name] || after.default)(form, json, submitter);
      else showRefusal(form, json, res.status);
      if (!json.ok && ['approve', 'reject'].includes(name)) {
        $('[data-row-error]', form.closest('[data-intent]')).textContent = json.error.message;
      }
    } catch {
      HTMLFormElement.prototype.submit.call(form);
    } finally {
      // A disabled submitter drops focus; a refused form gives it back to the pressed button.
      if (button.isConnected) {
        busy(button, false);
        if (hadFocus && (document.activeElement === document.body || !document.activeElement)) button.focus();
      }
    }
  });

  // ---------------------------------------------------------------- inline create row
  function openCreateRow() {
    const template = $('#create-row-template');
    let row = $('[data-create-row]');
    if (!row && template) {
      row = template.content.firstElementChild.cloneNode(true);
      template.after(row);
    }
    $('[data-create-toggle]')?.setAttribute('aria-expanded', 'true');
    $('input[name=name]', row)?.focus();
  }

  function closeCreateRow() {
    $('[data-create-row]')?.remove();
    const toggle = $('[data-create-toggle]');
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.focus();
  }

  document.addEventListener('click', (event) => {
    const discard = event.target.closest('[data-discard]');
    if (discard) {
      event.preventDefault();
      closeCreateRow();
    }
  });

  // ---------------------------------------------------------------- dialogs
  function openDialog(event, form, submitter) {
    const dialog = document.getElementById(form.dataset.dialogOpener);
    if (!dialog?.showModal) return;
    event.preventDefault();
    dialog.opener = submitter;
    dialog.showModal();
    $('[data-dialog-close]', dialog).focus();
  }

  document.addEventListener('close', (event) => {
    if (event.target.matches?.('dialog') && event.target.opener?.isConnected) event.target.opener.focus();
  }, true);

  // Tab and Shift+Tab stay inside an open dialog; Escape closes it without acting.
  document.addEventListener('keydown', (event) => {
    const dialog = $('dialog[open]');
    if (!dialog) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = $$(FOCUSABLE, dialog);
    const at = items.indexOf(document.activeElement);
    event.preventDefault();
    const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at + 1) % items.length;
    items[next].focus();
  });

  // ---------------------------------------------------------------- approvals inbox
  document.addEventListener('click', (event) => {
    const reject = event.target.closest('[data-reject]');
    if (!reject) return;
    const panel = document.getElementById(reject.getAttribute('aria-controls'));
    const open = !panel.classList.contains('is-open');
    panel.classList.toggle('is-open', open);
    reject.setAttribute('aria-expanded', String(open));
    if (open) $('input[name=reason]', panel).focus();
  });

  function rejectReady(form) {
    const reason = $('input[name=reason]', form);
    const message = $('[data-reason-error]', form);
    if (reason.value.trim()) {
      message.hidden = true;
      reason.removeAttribute('aria-invalid');
      return true;
    }
    message.hidden = false;
    reason.setAttribute('aria-invalid', 'true');
    reason.setAttribute('aria-describedby', message.id);
    reason.focus();
    return false;
  }

  // ---------------------------------------------------------------- intents list
  async function filterIntents(form) {
    const status = form.elements.status.value;
    const url = `/console/intents${status ? `?status=${encodeURIComponent(status)}` : ''}`;
    const doc = await getDoc(url);
    swap(doc, '[data-intents-list]');
    const csv = $('[data-csv]');
    csv.href = $('[data-csv]', doc).getAttribute('href');
    history.replaceState(null, '', url);
  }

  async function loadMore(form, submitter) {
    const button = submitter || $('button', form);
    busy(button, true);
    try {
      const doc = await getDoc(`/console/intents?${new URLSearchParams(new FormData(form))}`);
      const rows = [...$('#intent-rows', doc).children];
      $('#intent-rows').append(...rows);
      const next = $('[data-load-more]', doc);
      if (next) {
        $$('input', next).forEach((input) => { form.elements[input.name].value = input.value; });
        busy(button, false);
        button.focus();
      } else {
        form.remove();
        $('[data-details]', rows[0])?.focus();
      }
    } catch {
      busy(button, false);
      HTMLFormElement.prototype.submit.call(form);
    }
  }

  document.addEventListener('change', (event) => {
    const filter = event.target.closest('[data-filter] select');
    if (filter) filterIntents(filter.form);
    const role = event.target.closest('select[data-autosubmit]');
    if (role) role.form.requestSubmit();
  });

  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-details]');
    if (!toggle) return;
    const row = document.getElementById(toggle.getAttribute('aria-controls'));
    const open = !row.classList.contains('is-open');
    row.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  });

  // ---------------------------------------------------------------- payroll batch builder
  const AMOUNT = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;
  const PLACES = { usdc: 6, eth: 18 };

  function rawOf(value, asset) {
    if (!AMOUNT.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > PLACES[asset]) return null;
    const raw = BigInt(whole) * 10n ** BigInt(PLACES[asset]) + BigInt(fraction.padEnd(PLACES[asset], '0') || '0');
    return raw > 0n ? raw : null;
  }

  function display(raw, asset) {
    const unit = 10n ** BigInt(PLACES[asset]);
    const fraction = raw % unit;
    if (fraction === 0n) return (raw / unit).toString();
    return `${raw / unit}.${fraction.toString().padStart(PLACES[asset], '0').replace(/0+$/, '')}`;
  }

  function updateTotal(form) {
    const { asset } = form.dataset;
    const total = $$('input[data-part="amount"]', form).reduce((sum, input) => sum + (rawOf(input.value.trim(), asset) ?? 0n), 0n);
    $('[data-total]', form).textContent = `Total: ${display(total, asset)} ${asset.toUpperCase()}`;
  }

  const PART_LABELS = { destination_address: 'destination', amount: 'amount', memo: 'memo' };

  function renumber(form) {
    const lines = $$('[data-line]', form);
    lines.forEach((line, i) => {
      const k = i + 1;
      $('legend', line).textContent = `Line ${k}`;
      $$('input[data-part]', line).forEach((input) => {
        const part = input.dataset.part;
        input.name = `items.${i}.${part}`;
        input.id = `batch-${k}-${part}`;
        const label = input.closest('.field').querySelector('label');
        label.htmlFor = input.id;
        label.textContent = `Line ${k} ${PART_LABELS[part]}`;
      });
      const remove = $('button[name=op]', line);
      remove.value = `remove:${i}`;
      remove.textContent = `Remove line ${k}`;
      remove.disabled = lines.length === 1;
    });
  }

  function addLine(form) {
    const lines = $$('[data-line]', form);
    if (lines.length >= 100) return;
    const line = lines[0].cloneNode(true);
    $$('input', line).forEach((input) => {
      input.value = '';
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
    $$('.field__error', line).forEach((p) => p.remove());
    lines[lines.length - 1].after(line);
    renumber(form);
    $('input[data-part="destination_address"]', line).focus();
  }

  function removeLine(form, button) {
    const line = button.closest('[data-line]');
    const next = line.nextElementSibling;
    line.remove();
    renumber(form);
    updateTotal(form);
    if (next?.matches('[data-line]')) $('input[data-part="destination_address"]', next).focus();
    else $('[data-add-line]', form).focus();
  }

  // Enter in a batch field submits the batch, never the first line's Remove button.
  document.addEventListener('keydown', (event) => {
    const form = event.key === 'Enter' && event.target.matches?.('input') && event.target.closest('[data-fetch="batch"]');
    if (!form) return;
    event.preventDefault();
    form.requestSubmit($('button[value="submit"]', form));
  });

  document.addEventListener('input', (event) => {
    const form = event.target.closest('[data-fetch="batch"]');
    if (!form) return;
    updateTotal(form);
    const input = event.target;
    if (input.dataset.part === 'amount' && rawOf(input.value.trim(), form.dataset.asset) !== null) clearLineAmount(input);
  });

  function clearLineAmount(input) {
    const id = `client-${input.name.replace(/[^a-z0-9]/gi, '-')}`;
    if (!document.getElementById(id)) return;
    document.getElementById(id).remove();
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  }

  document.addEventListener('focusout', (event) => {
    const input = event.target;
    const form = input.closest?.('[data-fetch="batch"]');
    if (!form || input.dataset.part !== 'amount') return;
    const value = input.value.trim();
    if (value && rawOf(value, form.dataset.asset) === null) {
      markField(form, input.name, 'Enter an amount like 1250 or 0.5', { focus: false });
    } else {
      clearLineAmount(input);
    }
  });

  // ---------------------------------------------------------------- toggled panels, tabs, copy
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-toggle]');
    if (!toggle) return;
    const panel = document.getElementById(toggle.getAttribute('aria-controls'));
    const open = !panel.hasAttribute('data-open');
    panel.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) $(FOCUSABLE, panel)?.focus();
  });

  function selectTab(tab, focus) {
    $$('[role=tab]', tab.closest('[data-tabs]')).forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    history.replaceState(null, '', tab.href);
    if (focus) tab.focus();
  }

  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tabs] [role=tab]');
    if (!tab) return;
    event.preventDefault();
    selectTab(tab, false);
  });

  document.addEventListener('keydown', (event) => {
    const tab = event.target.closest?.('[data-tabs] [role=tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = $$('[role=tab]', tab.closest('[data-tabs]'));
    const i = tabs.indexOf(tab);
    const next = { ArrowLeft: tabs[(i - 1 + tabs.length) % tabs.length], ArrowRight: tabs[(i + 1) % tabs.length],
      Home: tabs[0], End: tabs[tabs.length - 1] }[event.key];
    event.preventDefault();
    selectTab(next, true);
  });

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.className = 'sr-only';
      document.body.append(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      return copied;
    }
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    const copied = await copyText($(button.dataset.copy).textContent.trim());
    toast(copied ? { text: button.dataset.copied || 'Copied' } : { text: 'Copy is not available here; select the text instead.', kind: 'error' });
  });

  // A table wider than its panel scrolls inside it; keyboard users can reach that scroll.
  function scrollRegions() {
    $$('.table-wrap').forEach((wrap) => {
      const scrolls = wrap.scrollWidth > wrap.clientWidth + 1;
      if (scrolls && !wrap.hasAttribute('tabindex')) {
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', `${$('table', wrap)?.getAttribute('aria-label') || 'Table'}, scrolls sideways`);
        wrap.dataset.scrollRegion = '';
      } else if (!scrolls && wrap.hasAttribute('data-scroll-region')) {
        ['tabindex', 'role', 'aria-label', 'data-scroll-region'].forEach((a) => wrap.removeAttribute(a));
      }
    });
  }
  window.addEventListener('resize', scrollRegions);
  new MutationObserver(scrollRegions).observe(document.body, { childList: true, subtree: true });

  // A page restored from the back-forward cache never keeps a busy submitter.
  window.addEventListener('pageshow', () => $$('[aria-busy]').forEach((b) => busy(b, false)));

  // ---------------------------------------------------------------- start
  words();
  scrollRegions();
  reveal();
  heroScrub();
  $('[data-focus-on-load]')?.focus();
})();
