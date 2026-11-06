import { call } from './api.ts';
import { showFailure, showStatus, type Regions } from './feedback.ts';
import { closeDialog, openDialog } from './widgets.ts';

export type StepupOptions = {
  purpose: 'checkout' | 'gift' | 'membership';
  regions: Regions;
  onVerified: () => void;
};

export function initStepup(options: StepupOptions): void {
  const trigger = document.getElementById('stepup-trigger') as HTMLButtonElement | null;
  const dialog = document.getElementById('stepup-dialog');
  if (trigger === null || dialog === null) return;
  const verify = document.getElementById('stepup-verify') as HTMLButtonElement | null;
  const resend = document.getElementById('stepup-resend') as HTMLButtonElement | null;
  const closeButton = document.getElementById('stepup-close');
  const codeField = document.getElementById('stepup-code') as HTMLInputElement | null;
  let challengeId: string | null = null;

  const start = async (): Promise<void> => {
    const result = await call<{ challenge: { id: string; masked_email: string } }>('POST', '/api/stepup/start', {
      purpose: options.purpose,
    });
    challengeId = result.challenge.id;
    showStatus(options.regions, 'stepup_sent', { masked: result.challenge.masked_email });
  };

  trigger.addEventListener('click', () => {
    openDialog(dialog, trigger);
    void start().catch((error: unknown) => showFailure(options.regions, error));
  });

  resend?.addEventListener('click', () => {
    void (async () => {
      if (challengeId === null) {
        await start();
        return;
      }
      const result = await call<{ challenge: { id: string; masked_email: string } }>('POST', '/api/stepup/resend', {
        challenge_id: challengeId,
      });
      challengeId = result.challenge.id;
      showStatus(options.regions, 'stepup_sent', { masked: result.challenge.masked_email });
    })().catch((error: unknown) => showFailure(options.regions, error));
  });

  verify?.addEventListener('click', () => {
    void (async () => {
      if (challengeId === null) return;
      await call('POST', '/api/stepup/verify', { challenge_id: challengeId, code: codeField?.value ?? '' });
      closeDialog(dialog);
      showStatus(options.regions, 'stepup_verified');
      options.onVerified();
    })().catch((error: unknown) => showFailure(options.regions, error));
  });

  closeButton?.addEventListener('click', () => closeDialog(dialog));
}
