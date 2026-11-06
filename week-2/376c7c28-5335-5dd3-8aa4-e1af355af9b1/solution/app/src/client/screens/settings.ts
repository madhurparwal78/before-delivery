import { post, put, RequestFailed } from '../api.ts';
import { refreshStudio, studio, type ScreenRender } from '../app.ts';
import { el, field, setFieldError } from '../dom.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';

const ROLE_OPTIONS = [
  { label: 'Kiln tech', role: 'kiln_tech', membership: null },
  { label: 'Member', role: 'member', membership: 'member' },
  { label: 'Drop-off', role: 'member', membership: 'drop_off' },
] as const;

export const renderSettings: ScreenRender = ({ mount }) => {
  const region = new Region('Settings status');
  const windowInput = el('input', {
    type: 'number',
    step: '1',
    min: '3',
    max: '60',
    'aria-label': 'Pickup window (days)',
  });
  const feeInput = el('input', {
    type: 'number',
    step: '1',
    min: '0',
    max: '500',
    'aria-label': 'Storage fee (¢/day)',
  });
  const windowField = field('Pickup window (days)', windowInput, 'settings-window');
  const feeField = field('Storage fee (¢/day)', feeInput, 'settings-fee');
  const savePolicy = el('button', { type: 'submit', class: 'btn primary', text: 'SAVE POLICY' });

  const emailInput = el('input', { type: 'email', 'aria-label': 'Invite email' });
  const emailField = field('Invite email', emailInput, 'settings-email');
  const roleSelect = el('select', { 'aria-label': 'Role' });
  for (const option of ROLE_OPTIONS) {
    roleSelect.appendChild(el('option', { value: option.label, text: option.label }));
  }
  const roleField = field('Role', roleSelect, 'settings-role');
  const sendInvite = el('button', { type: 'submit', class: 'btn primary', text: 'SEND INVITE' });

  const policyForm = el('form', { novalidate: true, class: 'stack' }, [
    windowField.wrap,
    feeField.wrap,
    savePolicy,
  ]);
  const inviteForm = el('form', { novalidate: true, class: 'stack' }, [
    emailField.wrap,
    roleField.wrap,
    sendInvite,
  ]);

  const current = studio();
  windowInput.value = String(current?.pickup_window_days ?? 14);
  feeInput.value = String(current?.storage_fee_cents ?? 50);

  policyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(windowInput, windowField.error, '');
    setFieldError(feeInput, feeField.error, '');
    void withPending(region, savePolicy, 'Saving…', async () => {
      try {
        await put('/api/studio/settings', {
          pickup_window_days: Number(windowInput.value),
          storage_fee_cents: Number(feeInput.value),
        });
        await refreshStudio();
        region.say('Pickup policy saved.');
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        const errors = error.failure.errors ?? {};
        setFieldError(windowInput, windowField.error, errors['pickup_window_days'] ?? '');
        setFieldError(feeInput, feeField.error, errors['storage_fee_cents'] ?? '');
        region.say(failureCopy(error.failure, {}));
      }
    });
  });

  inviteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(emailInput, emailField.error, '');
    setFieldError(roleSelect, roleField.error, '');
    void withPending(region, sendInvite, 'Sending…', async () => {
      const chosen =
        ROLE_OPTIONS.find((option) => option.label === roleSelect.value) ?? ROLE_OPTIONS[0];
      const email = emailInput.value.trim();
      try {
        await post('/api/invites', {
          email,
          role: chosen.role,
          membership: chosen.membership,
        });
        region.say(`Invite created for ${email}; the email is on its way.`);
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        const errors = error.failure.errors ?? {};
        setFieldError(emailInput, emailField.error, errors['email'] ?? '');
        setFieldError(roleSelect, roleField.error, errors['role'] ?? errors['membership'] ?? '');
        region.say(
          failureCopy(error.failure, {
            already_member: `${email} is already in this studio.`,
            member_inactive: `${email} is not active in this studio. Reactivate them first.`,
          }),
        );
      }
    });
  });

  mount.appendChild(
    el('div', { class: 'split-half' }, [
      el('section', { class: 'panel' }, [
        el('h1', { class: 'heading', text: 'SETTINGS' }),
        el('h2', { class: 'heading small', text: 'PICKUP POLICY' }),
        policyForm,
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { class: 'heading small', text: 'INVITE' }),
        inviteForm,
        region.node,
      ]),
    ]),
  );
};
