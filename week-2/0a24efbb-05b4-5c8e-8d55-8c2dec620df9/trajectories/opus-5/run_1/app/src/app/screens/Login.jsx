import { useState } from 'react';
import { usePage } from '../deskData.jsx';
import { feedback, ui } from '../../shared/copy.js';
import { call, refusalWording } from '../api.js';
import { announce } from '../announce.js';

export function LoginScreen() {
  const page = usePage();
  const [workAddress, setWorkAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const password = event.target.elements.password.value;
    setBusy(true);
    setRefusal(null);
    announce.polite(ui.signingIn);
    const answer = await call('POST', '/api/session', { body: { work_address: workAddress, password } });
    if (answer.status === 200) {
      window.location.assign(page.next ?? '/requests');
      return;
    }
    setBusy(false);
    event.target.elements.password.value = '';
    const wording = answer.status === 0 ? feedback.noServer : refusalWording(answer);
    setRefusal(wording);
    announce.assertive(wording);
  };

  return (
    <section className="sign-in">
      <h1>{ui.signInHeading}</h1>
      {page.notice ? <p className="notice">{page.notice}</p> : null}
      {refusal ? <p className="refusal">{refusal}</p> : null}
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="work-address">{ui.workAddress}</label>
          <input
            id="work-address"
            name="work_address"
            type="email"
            autoComplete="username"
            required
            value={workAddress}
            onChange={(event) => setWorkAddress(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">{ui.password}</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? ui.signingIn : ui.signIn}
        </button>
      </form>
    </section>
  );
}
