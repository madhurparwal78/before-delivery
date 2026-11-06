import { STATUS_COPY } from '../../domain/copy.ts';
import { landingFor, type Role } from '../../domain/screens.ts';
import { request } from '../net.ts';
import { control, onSubmit, pageData, valueOf } from '../ui.ts';

interface SignInData {
  screen: 'sign-in';
  next: string | null;
}

interface MemberAnswer {
  member: { role: Role };
}

export function startSignInScreen(): void {
  const data = pageData<SignInData>();
  onSubmit(
    '[data-form="sign-in"]',
    async () =>
      request<MemberAnswer>('/api/auth/sign-in', {
        method: 'POST',
        body: { email: valueOf('email'), password: control('password')?.value ?? '' },
      }),
    {
      region: 'Sign-in status',
      own: (failure) => (failure.code === 'invalid_credentials' ? STATUS_COPY.signInRefused : null),
      after: (result) => {
        const answer = result as MemberAnswer;
        window.location.assign(landingFor(answer.member.role, data.next));
      },
    },
  );
}

export function startForgotPasswordScreen(): void {
  onSubmit(
    '[data-form="forgot-password"]',
    async () =>
      request('/api/auth/password-reset', { method: 'POST', body: { email: valueOf('email') } }),
    { region: 'Reset status', success: STATUS_COPY.resetRequested },
  );
}

interface TokenData {
  token: string;
}

export function startResetPasswordScreen(): void {
  const data = pageData<TokenData>();
  onSubmit(
    '[data-form="reset-password"]',
    async () =>
      request<MemberAnswer>('/api/auth/password-reset/complete', {
        method: 'POST',
        body: { token: data.token, password: control('password')?.value ?? '' },
      }),
    {
      region: 'Reset status',
      success: STATUS_COPY.passwordSaved,
      own: (failure) => (failure.status === 410 ? STATUS_COPY.resetDeadLink : null),
      after: (result) => {
        const answer = result as MemberAnswer;
        window.location.assign(landingFor(answer.member.role, null));
      },
    },
  );
}

export function startInviteScreen(): void {
  const data = pageData<TokenData>();
  onSubmit(
    '[data-form="invite"]',
    async () =>
      request<MemberAnswer>('/api/auth/invitations/accept', {
        method: 'POST',
        body: {
          token: data.token,
          name: valueOf('name'),
          password: control('password')?.value ?? '',
        },
      }),
    {
      region: 'Invitation status',
      own: (failure) => (failure.status === 410 ? STATUS_COPY.inviteDeadLink : null),
      after: (result) => {
        const answer = result as MemberAnswer;
        window.location.assign(landingFor(answer.member.role, null));
      },
    },
  );
}

export function wireSignOut(): void {
  const form = document.querySelector<HTMLFormElement>('[data-sign-out]');
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async (): Promise<void> => {
      await request('/api/auth/sign-out', { method: 'POST' });
      window.location.assign('/sign-in');
    })();
  });
}
