import { button, field, link, pageData } from './components.ts';
import { html } from './html.ts';
import { page, problemsRegion, statusRegion } from './layout.ts';

export function signInPage(next: string | null): string {
  const main = html`<h1 class="page-heading">Sign in</h1>
<form class="form form--narrow" aria-label="Sign in" data-form="sign-in">
  ${problemsRegion()}
  ${field({ name: 'email', label: 'Email', kind: 'email', autocomplete: 'username' })}
  ${field({ name: 'password', label: 'Password', kind: 'password', autocomplete: 'current-password' })}
  ${button('Sign in', { pending: 'Signing in…' })}
  ${statusRegion('Sign-in status')}
  <p>${link('Forgot password?', '/forgot-password')}</p>
</form>
${pageData({ screen: 'sign-in', next })}`;
  return page({ title: 'Sign in' }, main);
}

export function forgotPasswordPage(): string {
  const main = html`<h1 class="page-heading">Reset your password</h1>
<form class="form form--narrow" aria-label="Reset your password" data-form="forgot-password">
  ${problemsRegion()}
  ${field({ name: 'email', label: 'Email', kind: 'email', autocomplete: 'username' })}
  ${button('Send reset link', { pending: 'Sending…' })}
  ${statusRegion('Reset status')}
</form>
${pageData({ screen: 'forgot-password' })}`;
  return page({ title: 'Reset your password' }, main);
}

export function resetPasswordPage(token: string): string {
  const main = html`<h1 class="page-heading">Choose a new password</h1>
<form class="form form--narrow" aria-label="Choose a new password" data-form="reset-password">
  ${problemsRegion()}
  ${field({ name: 'password', label: 'New password', kind: 'password', autocomplete: 'new-password' })}
  ${button('Save password', { pending: 'Saving…' })}
  ${statusRegion('Reset status')}
</form>
${pageData({ screen: 'reset-password', token })}`;
  return page({ title: 'Choose a new password' }, main);
}

export function invitePage(token: string): string {
  const main = html`<h1 class="page-heading">Accept your invitation</h1>
<form class="form form--narrow" aria-label="Accept your invitation" data-form="invite">
  ${problemsRegion()}
  ${field({ name: 'name', label: 'Your name', autocomplete: 'name' })}
  ${field({ name: 'password', label: 'Password', kind: 'password', autocomplete: 'new-password' })}
  ${button('Join workspace', { pending: 'Joining…' })}
  ${statusRegion('Invitation status')}
</form>
${pageData({ screen: 'invite', token })}`;
  return page({ title: 'Accept your invitation' }, main);
}
