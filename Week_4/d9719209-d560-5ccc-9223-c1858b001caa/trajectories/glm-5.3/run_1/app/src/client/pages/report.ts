/* The illegal-content report dialog and the account-event handler. */
import { api, announce, copy, el, ApiFailure, type Me } from '../lib.js';
import { openDialog } from '../ui.js';

export function openReport(target: { targetType: 'post' | 'comment'; targetId: number }, me: Me | null): void {
  const catErr = el('span', {});
  const explErr = el('span', {});
  const emailErr = el('span', {});
  const goodErr = el('span', {});

  openDialog({
    title: 'Report illegal content',
    fields: () => {
      const catNames: [string, string][] = [
        ['hate', 'Hate speech or incitement'],
        ['terrorism', 'Terrorist content'],
        ['csam', 'Child sexual abuse material'],
        ['ip', 'Intellectual property infringement'],
        ['privacy', 'Privacy violation'],
        ['other', 'Other illegal content'],
      ];
      const group = el('div', { class: 'field', role: 'radiogroup', 'aria-label': 'Type of illegal content' });
      for (const [value, label] of catNames) {
        const input = el('input', { type: 'radio', name: 'report-category', id: `cat-${value}`, value });
        group.append(el('label', { class: 'radio-opt', for: `cat-${value}` }, input, label));
      }
      const expl = el('textarea', { class: 'textarea', 'aria-label': 'Explain why this is illegal' });
      const email = me === null ? el('input', { class: 'input', type: 'email', 'aria-label': 'Your email' }) : null;
      const good = el('input', { type: 'checkbox', id: 'good-faith' });
      const nodes = [
        group,
        catErr,
        expl,
        explErr,
      ];
      if (email !== null) nodes.push(email, emailErr);
      nodes.push(el('label', { class: 'checkbox-row', for: 'good-faith' }, good, 'I believe this report is accurate and complete'), goodErr);
      return nodes;
    },
    actions: (close) => {
      const send = el('button', { class: 'btn primary', type: 'button' }, 'Send report');
      const cancel = el('button', { class: 'btn', type: 'button' }, 'Cancel');
      cancel.addEventListener('click', close);
      const dialog = send.closest('.dialog') as HTMLElement | null;
      const confirmHost = el('div', {});
      send.addEventListener('click', () => {
        void (async () => {
          const dialogEl = dialog ?? document.body;
          const catInput = dialogEl.querySelector<HTMLInputElement>('input[name="report-category"]:checked');
          const expl = dialogEl.querySelector<HTMLTextAreaElement>('[aria-label="Explain why this is illegal"]');
          const email = dialogEl.querySelector<HTMLInputElement>('[aria-label="Your email"]');
          const good = dialogEl.querySelector<HTMLInputElement>('#good-faith');
          const fields: Record<string, string> = {};
          if (catInput === null) fields.category = 'Choose a type';
          if (expl === null || expl.value.trim() === '') fields.explanation = 'Explain why this is illegal';
          if (me === null && (email === null || !/.+@.+\..+/.test(email.value.trim()))) fields.reporterEmail = 'Enter a valid email address';
          if (good?.checked !== true) fields.goodFaith = 'Confirm the statement to send';
          catErr.replaceChildren(); explErr.replaceChildren(); emailErr.replaceChildren(); goodErr.replaceChildren();
          const targets = { category: catErr, explanation: explErr, reporterEmail: emailErr, goodFaith: goodErr };
          let firstInvalid: HTMLElement | null = null;
          for (const [field, message] of Object.entries(fields)) {
            const target = targets[field as keyof typeof targets] ?? catErr;
            target.replaceChildren(el('span', { class: 'field-error' }, message));
            if (firstInvalid === null) firstInvalid = target;
          }
          if (Object.keys(fields).length > 0) {
            const focusTarget = catInput === null ? dialogEl.querySelector<HTMLElement>('[role="radiogroup"]') : firstInvalid;
            focusTarget?.querySelector<HTMLElement>('input')?.focus();
            return;
          }
          send.textContent = 'Sending...';
          try {
            const res = await api<{ reference: string }>('/api/reports', {
              method: 'POST',
              body: JSON.stringify({
                targetType: target.targetType,
                targetId: target.targetId,
                category: catInput?.value,
                explanation: expl?.value.trim(),
                reporterEmail: me === null ? email?.value.trim() : undefined,
                goodFaith: true,
              }),
            });
            announce(copy.reportSent(res.reference));
            const content = dialogEl.querySelector('h2')?.parentElement;
            if (content !== null && content !== undefined) {
              content.replaceChildren(
                el('h2', {}, 'Report received'),
                el('p', {}, copy.reportRef(res.reference)),
                confirmHost,
              );
              const closeBtn = el('button', { class: 'btn', type: 'button' }, 'Close');
              closeBtn.addEventListener('click', close);
              confirmHost.append(closeBtn);
              closeBtn.focus();
            }
          } catch (err) {
            send.textContent = 'Send report';
            if (err instanceof ApiFailure) {
              for (const [field, message] of Object.entries(err.fields)) {
                const t = targets[field as keyof typeof targets];
                t?.replaceChildren(el('span', { class: 'field-error' }, message));
              }
            }
          }
        })();
      });
      return [cancel, send];
    },
  });
}

/* Account events: moderator-removed, approved, unapproved, suspended. */
export function handleAccountEvent(data: Record<string, unknown>): void {
  const kind = data.kind as string | undefined;
  if (kind === 'suspended') {
    announce(copy.signOutSuspension, true);
    window.setTimeout(() => { window.location.href = '/'; }, 200);
    return;
  }
  const name = data.communityName as string | undefined;
  if (kind === 'moderator-removed') {
    announce(copy.moderatorRemoved);
    // Remove moderator tools from the open page.
    for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button')))
      if (btn.textContent === 'Moderator actions') btn.remove();
    window.setTimeout(() => window.location.reload(), 3000);
  } else if (kind === 'approved') {
    announce(copy.canNowPost(name ?? ''));
    enableComposer();
  } else if (kind === 'unapproved') {
    window.setTimeout(() => window.location.reload(), 3000);
  }
}

function enableComposer(): void {
  const notice = document.querySelector('.banner p');
  if (notice !== null && notice.textContent === copy.restrictedNotice) notice.closest('.banner')?.remove();
  const submitLink = document.querySelector(`a[href$="/submit"]`);
  if (submitLink === null) {
    const head = document.querySelector('.post-head .card-meta');
    const name = window.location.pathname.split('/')[2];
    if (head !== null && name !== undefined) {
      const a = el('a', { class: 'btn primary', href: `/c/${name}/submit` }, 'Submit');
      head.append(a);
    }
  }
}
