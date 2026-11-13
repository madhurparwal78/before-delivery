// The owner's password.

import { ApiError, FAILED_REQUEST, api } from '../api.js';
import { h } from '../dom.js';
import { pending, showFieldErrors } from '../dialog.js';

export async function accountScreen(mount, app) {
    const current = h('input', { type: 'password', 'aria-label': 'Current password' });
    const next = h('input', { type: 'password', 'aria-label': 'New password' });
    const summarySlot = h('div', {});
    const alertSlot = h('div', {});
    const updates = h('p', {
        class: 'notice-line',
        role: 'status',
        'aria-label': 'Account updates',
    });
    const save = h('button', { type: 'submit', class: 'primary', text: 'Change password' });
    const fieldNodes = { current_password: current, new_password: next };
    const form = h(
        'form',
        { 'aria-label': 'Change password', novalidate: true },
        summarySlot,
        alertSlot,
        h('div', { class: 'field' }, h('label', { text: 'Current password' }), current),
        h('div', { class: 'field' }, h('label', { text: 'New password' }), next),
        h('div', { class: 'form-actions' }, save),
    );
    mount.append(
        h(
            'div',
            { class: 'screen' },
            h('h1', { text: 'Account' }),
            h('p', { text: app.me.email }),
            updates,
            h('div', { class: 'panel' }, form),
        ),
    );

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        summarySlot.replaceChildren();
        alertSlot.replaceChildren();
        pending(save);
        try {
            await api.post('/api/account/password', {
                current_password: current.value,
                new_password: next.value,
            });
            pending(save, false);
            current.value = '';
            next.value = '';
            updates.textContent = 'Password changed. Other sessions are signed out.';
        } catch (error) {
            pending(save, false);
            if (!(error instanceof ApiError)) throw error;
            if (error.isSignedOut) {
                location.assign('/auth/login?next=%2Fvault%2Faccount');
                return;
            }
            if (error.fields) {
                showFieldErrors(error.fields, fieldNodes, summarySlot);
                return;
            }
            alertSlot.replaceChildren(
                h('p', {
                    class: 'alert',
                    role: 'alert',
                    text: error.isUnexplained ? FAILED_REQUEST : error.message,
                }),
            );
        }
    });

    return { path: '/vault/account' };
}
