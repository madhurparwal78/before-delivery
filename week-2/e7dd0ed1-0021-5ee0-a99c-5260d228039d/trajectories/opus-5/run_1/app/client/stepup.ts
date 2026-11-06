import { ApiFailure, api } from './api';
import { button, el, field, openDialog, setStatus, textbox } from './dom';
import { stepUpCancelled } from './copy';

/**
 * Runs an action, and when the server answers step_up_required asks for a fresh code and sends the
 * same action once more. The console never tracks the confirmation itself.
 */
export async function withStepUp<T>(
  action: () => Promise<T>,
  options: { opener: HTMLElement | null; status: HTMLElement | null },
): Promise<T | null> {
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof ApiFailure) || error.code !== 'step_up_required') throw error;
  }
  return new Promise<T | null>((resolve, reject) => {
    openDialog({
      name: "Confirm it's you",
      opener: options.opener,
      build: (dialog) => {
        const code = textbox('Authenticator code', { value: '' });
        code.setAttribute('autocomplete', 'one-time-code');
        const confirm = button('Confirm', { className: 'primary' });
        const cancel = button('Cancel');
        dialog.body.append(
          el('h2', { text: "Confirm it's you" }),
          el('p', { text: 'Enter the current code from your authenticator app to continue.' }),
          field('Authenticator code', code),
          el('div', { class: 'dialog-actions' }, [confirm, cancel]),
        );
        confirm.addEventListener('click', async () => {
          dialog.setStatus('Checking code\u2026');
          try {
            await api.post('/api/me/two-step/confirm', { code: code.value.trim() });
          } catch (error) {
            if (error instanceof ApiFailure) {
              dialog.setStatus(error.errors.code ?? error.message);
              return;
            }
            dialog.close();
            reject(error);
            return;
          }
          dialog.close();
          try {
            resolve(await action());
          } catch (error) {
            reject(error);
          }
        });
        cancel.addEventListener('click', () => {
          dialog.close();
          setStatus(options.status, stepUpCancelled);
          resolve(null);
        });
        dialog.root.addEventListener('keydown', (event) => {
          if ((event as KeyboardEvent).key !== 'Escape') return;
          setStatus(options.status, stepUpCancelled);
          resolve(null);
        });
      },
    });
  });
}
