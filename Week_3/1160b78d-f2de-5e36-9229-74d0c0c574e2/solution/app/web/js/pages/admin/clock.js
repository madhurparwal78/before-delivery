// The operator clock: the server time in UTC, advance it, hold it.
import { html, useState, useEffect, useRef } from '../../lib/html.js';
import { api, fieldErrors } from '../../lib/api.js';
import { live } from '../../lib/live.js';
import { Button, Problems, FieldError } from '../../lib/ui.js';

const DEFAULT_ADVANCE = 60;

// "2027-03-14T14:00:05Z" reads "2027-03-14 14:00:05 UTC".
function utcText(instant) {
  return instant ? `${instant.slice(0, 10)} ${instant.slice(11, 19)} UTC` : '';
}

export function OperatorClock({ onLoaded } = {}) {
  const [now, setNow] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [seconds, setSeconds] = useState(String(DEFAULT_ADVANCE));
  const [errors, setErrors] = useState(null);
  const holding = useRef(false);

  const take = (state) => {
    setNow(state.now);
    if (!holding.current) setFrozen(state.frozen);
  };

  useEffect(() => {
    api.get('/api/clock').then((res) => {
      if (res.ok) take(res.data);
      onLoaded?.();
    });
    return live.on('clock', take);
  }, []);

  const advance = async () => {
    const res = await api.post('/api/operator/clock', { advance_seconds: Number(seconds) });
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { advance_seconds: 'The clock could not be moved.' });
      return;
    }
    setErrors(null);
    take(res.data);
    live.announce(`Clock moved to ${res.data.now}.`);
  };

  const hold = async (event) => {
    const wanted = event.target.checked;
    holding.current = true;
    setFrozen(wanted);
    const res = await api.post('/api/operator/clock', { frozen: wanted });
    holding.current = false;
    if (res.ok) take(res.data);
    else {
      const back = await api.get('/api/clock');
      if (back.ok) take(back.data);
    }
  };

  return html`<section class="block clock" role="region" aria-label="Operator clock">
    <h2>Operator clock</h2>
    <p class="figure-label">Server time</p>
    <p class="time">${utcText(now)}</p>
    <form onSubmit=${(event) => event.preventDefault()} noValidate>
      <${Problems} errors=${errors} />
      <div class="fields">
        <div class="field">
          <label for="advance_seconds">Advance by seconds</label>
          <input id="advance_seconds" type="number" min="1" max="31536000" step="1" value=${seconds}
            onInput=${(event) => setSeconds(event.target.value)} />
          <${FieldError} errors=${errors} name="advance_seconds" />
        </div>
        <div class="field act"><${Button} type="submit" onClick=${advance}>Advance clock</${Button}></div>
      </div>
      <label class="check" for="hold">
        <input id="hold" type="checkbox" checked=${frozen} onChange=${hold} />
        <span>Hold clock</span>
      </label>
    </form>
  </section>`;
}
