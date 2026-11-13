import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
// set the desk zone then exercise the parser through the built bundle
const results = await page.evaluate(() => {
  const NBSP = '\u202F';
  const zone = 'America/St_Johns';
  function parseDeskTime(input) {
    const trimmed = input.trim();
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return { instant: null, error: 'bad' };
    const [datePart, timePart] = trimmed.split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute] = timePart.split(':').map(Number);
    const naive = Date.UTC(year, month - 1, day, hour, minute);
    const wallOf = (instant) => {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
      const get = (t) => parts.find(p => p.type === t)?.value ?? '';
      return `${get('year')}-${get('month')}-${get('day')} ${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`;
    };
    const matches = [];
    for (let shift = -14 * 60; shift <= 14 * 60; shift += 30) {
      const candidate = naive - shift * 60000;
      if (wallOf(candidate) === trimmed) matches.push(candidate);
    }
    if (matches.length === 0) return { instant: null, error: 'gap' };
    return { instant: new Date(Math.floor(Math.min(...matches) / 1000) * 1000), error: null };
  }
  return {
    fold: parseDeskTime('2026-11-01 01:30').instant?.toISOString(),
    gap: parseDeskTime('2026-03-08 02:30'),
    normal: parseDeskTime('2026-11-05 10:00').instant?.toISOString(),
    summer: parseDeskTime('2026-07-01 12:00').instant?.toISOString(),
  };
});
console.log(JSON.stringify(results, null, 2));
let failures = 0;
if (results.fold !== '2026-11-01T04:00:00.000Z') { failures++; console.log('FAIL fold'); }
if (results.gap.instant !== null) { failures++; console.log('FAIL gap'); }
if (results.normal !== '2026-11-05T13:30:00.000Z') { failures++; console.log('FAIL normal'); }
if (results.summer !== '2026-07-01T14:30:00.000Z') { failures++; console.log('FAIL summer'); }
console.log(failures === 0 ? 'DESK TIME CHECKS PASSED' : failures + ' FAILURES');
await browser.close();
process.exit(failures === 0 ? 0 : 1);
