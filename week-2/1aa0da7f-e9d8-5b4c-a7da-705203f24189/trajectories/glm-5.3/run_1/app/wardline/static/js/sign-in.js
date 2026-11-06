/* Sign-in page (DP-01, DP-04, DP-06). */
(function () {
  const params = new URLSearchParams(location.search);
  const nextInAddress = params.has('next');
  const statusEl = document.getElementById('sign-in-status');

  if (nextInAddress) statusEl.textContent = WL.copy.sessionEnded;

  document.getElementById('sign-in-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) {
      statusEl.textContent = WL.copy.signInFailed;
      statusEl.classList.add('vermilion-col');
      return;
    }
    const body = { email: email, password: password };
    if (nextInAddress) body.next = params.get('next');
    const res = await WL.api('POST', '/api/sign-in', body);
    if (!res.ok) {
      const locked = res.data && res.data.error === 'sign_in_locked';
      statusEl.textContent = locked ? WL.copy.signInLocked : WL.copy.signInFailed;
      statusEl.classList.add('vermilion-col');
      return;
    }
    location.href = res.data.landing;
  });

  // already signed in goes to the landing route
  (async () => {
    const res = await WL.api('GET', '/api/session', undefined, { background: true });
    if (res.ok) {
      const landing = {
        intake_officer: '/intake', case_lead: '/compartments',
        investigator: '/compartments', auditor: '/ledger',
      }[res.data.user.role];
      location.href = landing;
    }
  })();
})();
