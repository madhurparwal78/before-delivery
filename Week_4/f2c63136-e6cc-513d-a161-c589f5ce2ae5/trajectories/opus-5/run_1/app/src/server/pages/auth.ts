import { attr, escapeHtml, page } from './layout.js';

export function signupPage(): string {
  const main = `<section class="card formcard">
<h1>Open a workspace</h1>
<form data-form="signup" class="stack">
<label class="field"><span>Email</span><input type="email" name="email" aria-label="Email" /></label>
<label class="field"><span>Username</span><input type="text" name="username" aria-label="Username" /></label>
<label class="field"><span>Full name</span><input type="text" name="name" aria-label="Full name" /></label>
<label class="field"><span>Password</span><input type="password" name="password" aria-label="Password" /></label>
<button type="submit" class="primary">Create account</button>
</form>
</section>`;
  return page({ title: 'Sign up', user: null }, main);
}

export function loginPage(): string {
  const main = `<section class="card formcard">
<h1>Log in</h1>
<form data-form="login" class="stack">
<label class="field"><span>Email</span><input type="email" name="email" aria-label="Email" /></label>
<label class="field"><span>Password</span><input type="password" name="password" aria-label="Password" /></label>
<button type="submit" class="primary">Log in</button>
</form>
</section>`;
  return page({ title: 'Log in', user: null }, main);
}

export function confirmPage(token: string): string {
  const main = `<section class="card formcard">
<h1>Confirm your email</h1>
<form data-form="confirm" data-token="${attr(token)}" class="stack">
<button type="submit" class="primary">Confirm email</button>
</form>
</section>`;
  return page({ title: 'Confirm email', user: null }, main);
}

export function notFoundPage(): string {
  const main = `<section class="card formcard">
<h1>We couldn't find that page</h1>
<p>${escapeHtml('It may not exist, or you may not have access to it.')}</p>
<a class="arrow" href="/inbox">Back to the inbox</a>
</section>`;
  return page({ title: 'Not found', user: null, statusRegions: false }, main);
}
