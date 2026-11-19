// Plan requests: only the reply to the newest request is painted, requests that arrive while one is in flight
// are coalesced to the newest, and the latest request repeats silently every 60 seconds.
import { api } from '../core/api.js';

const REFRESH_MS = 60000;
const TONIGHT = '/api/tonight';

// createPlanLoader({explicitDate, apply, fail}) -> {first(), load(options), date()}
// load({minute, ...rest}) -> apply(plan, options) later; rest is handed back untouched.
export function createPlanLoader({ explicitDate, apply, fail }) {
  let date = explicitDate;
  let tonightMinute = null;
  let latestUrl = null;
  let pending = null;
  let busy = false;
  let timer = 0;

  function urlFor(minute) {
    if (explicitDate === null && minute === tonightMinute) return TONIGHT;
    return `/api/plans/${date}?minute=${minute}`;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (busy || pending) { schedule(); return; }
      pending = { url: latestUrl, silent: true };
      drain();
    }, REFRESH_MS);
  }

  async function drain() {
    busy = true;
    while (pending) {
      const options = pending;
      pending = null;
      const url = options.url || urlFor(options.minute);
      latestUrl = url;
      let plan;
      try {
        plan = await api('GET', url);
      } catch (error) {
        if (!pending && !options.silent) fail(error);
        continue;
      }
      if (url === TONIGHT) tonightMinute = plan.minute;
      if (pending) continue;
      apply(plan, options);
    }
    busy = false;
    schedule();
  }

  return {
    date: () => date,
    async first() {
      const url = explicitDate === null ? TONIGHT : `/api/plans/${explicitDate}?minute=0`;
      latestUrl = url;
      const plan = await api('GET', url);
      date = plan.date;
      if (explicitDate === null) tonightMinute = plan.minute;
      schedule();
      return plan;
    },
    load(options) {
      pending = options;
      if (!busy) drain();
    },
  };
}
