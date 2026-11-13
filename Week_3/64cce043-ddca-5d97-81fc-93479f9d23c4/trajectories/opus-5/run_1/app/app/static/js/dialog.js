// Dialogs: focus moves inside, Tab wraps, Escape closes and focus returns.

import { focusable, h, trapTab } from './dom.js';

export function openDialog({ name, alert = false, build, onClose }) {
    const opener = document.activeElement;
    const panel = h('div', {
        class: 'dialog fade-rise',
        role: alert ? 'alertdialog' : 'dialog',
        'aria-modal': 'true',
        'aria-label': name,
    });
    const scrim = h('div', { class: 'scrim' }, panel);

    const dialog = {
        panel,
        close(reason) {
            if (!scrim.isConnected) return;
            scrim.remove();
            document.removeEventListener('keydown', onKeyDown, true);
            if (opener && opener.isConnected) opener.focus();
            if (onClose) onClose(reason);
        },
        focusFirst() {
            const items = focusable(panel);
            const safe = alert ? items.find((item) => item.dataset.safe === 'true') : null;
            const target = safe || items[0];
            if (target) target.focus();
        },
    };

    function onKeyDown(event) {
        if (!scrim.isConnected) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            dialog.close('escape');
            return;
        }
        if (panel.contains(document.activeElement)) trapTab(panel, event);
    }

    build(panel, dialog);
    document.body.append(scrim);
    document.addEventListener('keydown', onKeyDown, true);
    dialog.focusFirst();
    return dialog;
}

// The error summary an invalid form shows, with one link per field error.
function errorSummary(fields, fieldNodes) {
    const items = Object.entries(fields).map(([name, message]) =>
        h(
            'li',
            {},
            h('a', {
                href: `#${name}`,
                text: message,
                onclick: (event) => {
                    event.preventDefault();
                    const target = fieldNodes[name];
                    if (target) target.focus();
                },
            }),
        ),
    );
    return h(
        'div',
        { class: 'alert error-summary', role: 'alert', tabindex: '-1' },
        h('strong', { text: 'Check these fields' }),
        h('ul', {}, items),
    );
}

export function showFieldErrors(fields, fieldNodes, summarySlot) {
    for (const [name, node] of Object.entries(fieldNodes)) {
        const holder = node.closest('.field');
        if (!holder) continue;
        holder.querySelectorAll('.field-error').forEach((old) => old.remove());
        node.removeAttribute('aria-invalid');
        if (fields[name]) {
            node.setAttribute('aria-invalid', 'true');
            holder.append(h('p', { class: 'field-error', text: fields[name] }));
        }
    }
    const summary = errorSummary(fields, fieldNodes);
    summarySlot.replaceChildren(summary);
    summary.focus();
    return summary;
}

export function pending(button, working = true) {
    if (working) {
        button.dataset.label = button.textContent;
        button.disabled = true;
        button.textContent = 'Working...';
    } else {
        button.disabled = false;
        if (button.dataset.label) button.textContent = button.dataset.label;
    }
}
