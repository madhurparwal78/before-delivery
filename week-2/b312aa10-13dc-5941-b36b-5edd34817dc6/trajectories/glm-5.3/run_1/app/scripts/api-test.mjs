import { Pool } from 'pg';

const base = 'http://localhost:4173';
let cookie = {};
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + detail}`);
};

async function call(method, path, body, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers ?? {}) };
  if (cookie.jar) headers.Cookie = cookie.jar;
  const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie.jar = setCookie.split(';')[0];
  let data = null;
  const text = await response.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, headers: response.headers };
}

// Fresh sign-in as operator
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });

// --- Kitchen scoping ---
const harbor = await call('GET', '/api/stations');
check('northside has 6 stations', harbor.data.stations.length === 6, harbor.data.stations.length);

const otherKitchen = await call('GET', '/api/members/mem_omar');
check('other kitchen member 404', otherKitchen.status === 404, JSON.stringify(otherKitchen.data));

// --- Business name with emoji ---
const rename = await call('PATCH', '/api/members/me', { businessName: 'Bello 🥖 Bakes' });
check('member cannot PATCH /api/members/me as operator? (403)', rename.status === 403, JSON.stringify(rename.data));

// Sign in as Ada
cookie.jar = null;
await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const renameAda = await call('PATCH', '/api/members/me', { businessName: 'Bello 🥖 Bakes' });
check('emoji business name accepted', renameAda.status === 200 && renameAda.data.member.businessName === 'Bello 🥖 Bakes', JSON.stringify(renameAda.data));
const badName = await call('PATCH', '/api/members/me', { businessName: 'Bello\u2028Bcc: x@evil.example' });
check('line separator refused', badName.status === 422 && badName.data.errors.businessName.includes('no line breaks'), JSON.stringify(badName.data));
const extraKey = await call('PATCH', '/api/members/me', { businessName: 'Okoro Spice', email: 'x@y.z' });
check('cannot-set key refused', extraKey.status === 422 && extraKey.data.errors.email === 'This field cannot be set.', JSON.stringify(extraKey.data));

// --- Shelf capacity: Shelf B has 2 slots ---
cookie.jar = null;
await call('POST', '/api/session', { email: 'kofi@smokestack.example', password: 'lineboard-demo' });
const s1 = await call('POST', '/api/bookings', { stationId: 'stn_shelfB', date: '2026-11-21', days: 1 }, { headers: { 'Idempotency-Key': 't-shelf-1' } });
check('shelf hold 1', s1.status === 201, JSON.stringify(s1.data).slice(0, 200));
const s2 = await call('POST', '/api/bookings', { stationId: 'stn_shelfB', date: '2026-11-21', days: 1 }, { headers: { 'Idempotency-Key': 't-shelf-2' } });
check('shelf hold 2', s2.status === 201);
const s3 = await call('POST', '/api/bookings', { stationId: 'stn_shelfB', date: '2026-11-21', days: 1 }, { headers: { 'Idempotency-Key': 't-shelf-3' } });
check('third shelf claim 409 lists full day', s3.status === 409 && s3.data.taken?.[0]?.date === '2026-11-21' && s3.data.message === 'Walk-in Shelf B 2026-11-21 was taken.', JSON.stringify(s3.data));

// Free the slot instantly after discard
const discard = await call('POST', `/api/bookings/${s2.data.bookings[0].id}/cancel`, {}, { headers: { 'Idempotency-Key': 't-discard-1' } });
check('discard answers 200 cancelled_free', discard.status === 200 && discard.data.booking.status === 'cancelled_free', JSON.stringify(discard.data.booking?.status));
const s4 = await call('POST', '/api/bookings', { stationId: 'stn_shelfB', date: '2026-11-21', days: 1 }, { headers: { 'Idempotency-Key': 't-shelf-4' } });
check('freed slot reclaimable at once', s4.status === 201, JSON.stringify(s4.data).slice(0, 120));

// --- Series across a month boundary ---
const series = await call('POST', '/api/bookings', { stationId: 'stn_prep1', date: '2026-11-24', start: '05:00', end: '09:00', repeatWeeks: 4 }, { headers: { 'Idempotency-Key': 't-series-1' } });
check('series of 4 weeks held', series.status === 201 && series.data.bookings.length === 4, JSON.stringify(series.data).slice(0, 200));
check('series id set', !!series.data.seriesId);
const confirmSeries = await call('POST', `/api/bookings/${series.data.bookings[0].id}/confirm`, {}, { headers: { 'Idempotency-Key': 't-series-c1' } });
check('series confirm 200/202', [200, 202].includes(confirmSeries.status), confirmSeries.status);
check('series confirm confirms all', confirmSeries.data.bookings.length === 4, JSON.stringify(confirmSeries.data.bookings?.length));

// Hour bank for Kofi (20 h): 4h/week, weeks in Nov: 11-24, 12-01, 12-08... months split
const kofiNov = await call('GET', '/api/members/mem_kofi/hour-bank?month=2026-11');
const kofiDec = await call('GET', '/api/members/mem_kofi/hour-bank?month=2026-12');
console.log('  kofi nov bank:', JSON.stringify(kofiNov.data), 'dec:', JSON.stringify(kofiDec.data));

// Cancel one week: only that week is cancelled
const week2 = series.data.bookings[1];
const cancelWeek = await call('POST', `/api/bookings/${week2.id}/cancel`, {}, { headers: { 'Idempotency-Key': 't-week-cancel' } });
check('one week cancelled free', cancelWeek.status === 200 && cancelWeek.data.booking.status === 'cancelled_free', JSON.stringify(cancelWeek.data.booking?.status));

// --- Late cancellation, waiver ---
const holdLate = await call('POST', '/api/bookings', { stationId: 'stn_oven1', date: '2026-11-05', start: '14:00', end: '16:00' }, { headers: { 'Idempotency-Key': 't-late-1' } });
const confirmLate = await call('POST', `/api/bookings/${holdLate.data.bookings[0].id}/confirm`, {}, { headers: { 'Idempotency-Key': 't-late-c' } });
check('late block confirmed', [200, 202].includes(confirmLate.status), JSON.stringify(confirmLate.data).slice(0, 120));
const cancelLate = await call('POST', `/api/bookings/${holdLate.data.bookings[0].id}/cancel`, {}, { headers: { 'Idempotency-Key': 't-late-cancel' } });
check('late cancel carries fee', cancelLate.status === 200 && cancelLate.data.booking.penaltyCents === Math.round(cancelLate.data.booking.chargeCents / 2), JSON.stringify({ penalty: cancelLate.data.booking?.penaltyCents, charge: cancelLate.data.booking?.chargeCents }));

// Idempotent replay of the late cancellation returns the stored response
const replay = await call('POST', `/api/bookings/${holdLate.data.bookings[0].id}/cancel`, {}, { headers: { 'Idempotency-Key': 't-late-cancel' } });
check('cancel replay identical', JSON.stringify(replay.data) === JSON.stringify(cancelLate.data), 'replay differs');

// Member cannot waive
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const waiveForbidden = await fetch(base + `/api/bookings/${holdLate.data.bookings[0].id}/waive-penalty`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
check('member waive 401', waiveForbidden.status === 401);
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const waive = await call('POST', `/api/bookings/${holdLate.data.bookings[0].id}/waive-penalty`, {}, { headers: { 'Idempotency-Key': 't-waive-1' } });
check('operator waive 200', waive.status === 200 && waive.data.booking.penaltyWaived === true, JSON.stringify(waive.data).slice(0, 150));
const waive2 = await call('POST', `/api/bookings/${holdLate.data.bookings[0].id}/waive-penalty`, {}, { headers: { 'Idempotency-Key': 't-waive-2' } });
check('second waive invalid_transition', waive2.status === 409 && waive2.data.error === 'invalid_transition', JSON.stringify(waive2.data).slice(0, 120));

// --- Out of service ---
// Ada books Oven 2 on Nov 20 first so the window flags a conflict.
cookie.jar = null;
await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const adaOven = await call('POST', '/api/bookings', { stationId: 'stn_oven2', date: '2026-11-20', start: '18:00', end: '21:00' }, { headers: { 'Idempotency-Key': 't-ada-oven-1' } });
const adaConfirm = await call('POST', `/api/bookings/${adaOven.data.bookings[0].id}/confirm`, {}, { headers: { 'Idempotency-Key': 't-ada-oven-c' } });
check('ada books oven 2', [200, 202].includes(adaConfirm.status), JSON.stringify(adaConfirm.data).slice(0, 120));
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const oos = await call('POST', '/api/out-of-service', { stationId: 'stn_oven2', date: '2026-11-20', start: '17:00', end: '23:00', reason: 'element broke' });
check('oos window created', oos.status === 201, JSON.stringify(oos.data).slice(0, 200));
check('oos flags conflicts', oos.data.conflicts.length === 1, JSON.stringify(oos.data.conflicts));

// Ada's held block overlapping the window was cancelled; a new hold is refused
cookie.jar = null;
await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const oosHold = await call('POST', '/api/bookings', { stationId: 'stn_oven2', date: '2026-11-20', start: '21:00', end: '22:00' }, { headers: { 'Idempotency-Key': 't-oos-hold' } });
check('hold overlapping window 422 stationId', oosHold.status === 422 && oosHold.data.errors.stationId === 'Oven 2 is out of service then.', JSON.stringify(oosHold.data));

// Operator moves Ada's conflicted block.
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });

// Move Ada's conflicted block to Oven 1, clear of the window.
const conflictBooking = adaOven.data.bookings[0].id;
const freshBooking = await call('GET', `/api/bookings/${conflictBooking}`);
const move = await call('POST', `/api/bookings/${conflictBooking}/move`, { stationId: 'stn_oven1', date: '2026-11-20', start: '18:00', end: '21:00', version: freshBooking.data.booking.version });
check('staff move clears conflict', move.status === 200 && move.data.booking.conflict === false && move.data.booking.stationId === 'stn_oven1', JSON.stringify(move.data).slice(0, 200));
const staleMove = await call('POST', `/api/bookings/${conflictBooking}/move`, { stationId: 'stn_oven1', date: '2026-11-20', start: '19:00', end: '21:00', version: 1 });
check('stale move 412', staleMove.status === 412 && staleMove.data.current !== undefined, staleMove.status);

// Release: put Oven 1 out of service over the moved block, then release it.
const oos2 = await call('POST', '/api/out-of-service', { stationId: 'stn_oven1', date: '2026-11-20', start: '17:00', end: '23:00', reason: 'oven broke' });
check('second oos flags the moved block', oos2.status === 201 && oos2.data.conflicts.includes(conflictBooking), JSON.stringify(oos2.data));
const release = await call('POST', `/api/bookings/${conflictBooking}/release`, {});
check('release free of charge', release.status === 200 && release.data.booking.status === 'cancelled_free', JSON.stringify(release.data).slice(0, 150));

// Check-in and check-out: book a block starting within the hour.
const now = new Date();
const tz = 'America/New_York';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const parts = fmt.formatToParts(now);
const get = (t) => parts.find((p) => p.type === t).value;
const startDate = `${get('year')}-${get('month')}-${get('day')}`;
const nowMinutes = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
const nextQuarter = Math.ceil((nowMinutes + 10) / 15) * 15;
const fmtTime = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const startTime = fmtTime(nextQuarter);
const endTime = fmtTime(nextQuarter + 120);
const laterStart = fmtTime(nextQuarter + 180);
const laterEnd = fmtTime(nextQuarter + 240);
cookie.jar = null;
await call('POST', '/api/session', { email: 'kofi@smokestack.example', password: 'lineboard-demo' });
const soonHold = await call('POST', '/api/bookings', { stationId: 'stn_prep2', date: startDate, start: startTime, end: endTime }, { headers: { 'Idempotency-Key': 't-soon-1' } });
const soonConfirm = await call('POST', `/api/bookings/${soonHold.data.bookings[0].id}/confirm`, {}, { headers: { 'Idempotency-Key': 't-soon-c' } });
check('soon block confirmed', [200, 202].includes(soonConfirm.status), JSON.stringify(soonConfirm.data).slice(0, 120));
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const checkIn = await call('POST', `/api/bookings/${soonHold.data.bookings[0].id}/check-in`, {});
check('check-in 200', checkIn.status === 200 && checkIn.data.booking.status === 'checked_in', JSON.stringify(checkIn.data).slice(0, 150));
const checkOut = await call('POST', `/api/bookings/${soonHold.data.bookings[0].id}/check-out`, {});
check('check-out 200 completed', checkOut.status === 200 && checkOut.data.booking.status === 'completed', JSON.stringify(checkOut.data).slice(0, 100));

// A block 3 hours out offers no check-in to staff.
cookie.jar = null;
await call('POST', '/api/session', { email: 'kofi@smokestack.example', password: 'lineboard-demo' });
const laterHold = await call('POST', '/api/bookings', { stationId: 'stn_prep2', date: startDate, start: laterStart, end: laterEnd }, { headers: { 'Idempotency-Key': 't-later-1' } });
check('later hold created', laterHold.status === 201, JSON.stringify(laterHold.data).slice(0, 120));
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const laterRead = await call('GET', `/api/bookings/${laterHold.data.bookings[0].id}`);
check('later block actions omit check_in', !laterRead.data.booking.actions.includes('check_in'), JSON.stringify(laterRead.data.booking.actions));
const earlyCheckIn = await call('POST', `/api/bookings/${laterHold.data.bookings[0].id}/check-in`, {});
check('early check-in 409 invalid_transition', earlyCheckIn.status === 409 && earlyCheckIn.data.error === 'invalid_transition', JSON.stringify(earlyCheckIn.data).slice(0, 150));
check('early check-in names current state', typeof earlyCheckIn.data.from === 'string', earlyCheckIn.data.from);

// Spring-forward gap: 2027-03-14 02:30 does not exist in New York.
cookie.jar = null;
await call('POST', '/api/session', { email: 'ada@bellobakes.example', password: 'lineboard-demo' });
const gapHold = await call('POST', '/api/bookings', { stationId: 'stn_oven1', date: '2027-03-14', start: '02:30', end: '05:00' }, { headers: { 'Idempotency-Key': 't-gap-test-1' } });
check('spring-forward gap refused on start', gapHold.status === 422 && gapHold.data.errors.start === '02:30 does not exist on 2027-03-14 in America/New_York (clocks go forward).', JSON.stringify(gapHold.data));

// --- Check-in document rule: Nadia has an expired certificate ---
cookie.jar = null;
await call('POST', '/api/session', { email: 'nadia@okorospice.example', password: 'lineboard-demo' });
const nadiaHold = await call('POST', '/api/bookings', { stationId: 'stn_prep1', date: '2026-11-05', start: '09:00', end: '11:00' }, { headers: { 'Idempotency-Key': 't-nadia-1' } });
check('nadia hold refused on documents', nadiaHold.status === 422 && nadiaHold.data.errors.documents.includes('insurance certificate'), JSON.stringify(nadiaHold.data));

// --- Inspector links ---
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const link = await call('POST', '/api/inspector-links', { email: 'inspector@example.org', expiresAt: '2026-11-20T18:00:00-05:00' });
check('inspector link created', link.status === 201 && link.data.link.url.includes('/inspect/'), JSON.stringify(link.data).slice(0, 200));
const token = link.data.link.url.split('/inspect/')[1];
const inspect = await fetch(base + `/api/inspect/${token}`);
const inspectData = await inspect.json();
check('inspector view 200', inspect.status === 200, JSON.stringify(inspectData).slice(0, 150));
check('inspector sees certificates', inspectData.certificates.length >= 4, inspectData.certificates.length);
check('inspector headers no-referrer', inspect.headers.get('referrer-policy') === 'no-referrer');
const cert = inspectData.certificates[0];
const download = await fetch(base + `/api/inspect/${token}/documents/${cert.documentId}/file`);
check('inspector certificate download 200', download.status === 200, download.status);
check('download content-type', download.headers.get('content-type') === 'application/pdf', download.headers.get('content-type'));
check('download attachment', (download.headers.get('content-disposition') ?? '').includes('attachment'));
const linksAfter = await call('GET', '/api/inspector-links');
check('access counted', linksAfter.data.links[0].views === 1 && linksAfter.data.links[0].downloads === 1, JSON.stringify({ v: linksAfter.data.links[0].views, d: linksAfter.data.links[0].downloads }));
const revoked = await call('DELETE', `/api/inspector-links/${link.data.link.id}`);
check('revoke 200', revoked.status === 200 && revoked.data.link?.status === 'revoked', JSON.stringify(revoked.data.link).slice(0,150));
const inspectAfter = await fetch(base + `/api/inspect/${token}`);
const inspectAfterBody = await inspectAfter.text();
check('revoked link 410', inspectAfter.status === 410 && JSON.parse(inspectAfterBody).error === 'link_revoked', `${inspectAfter.status} ${inspectAfterBody.slice(0, 120)}`);

// --- Sanitation ---
const entry = await call('POST', '/api/sanitation-entries', { area: 'Prep stations', task: 'Wiped counters', sanitizerPpm: 200, initials: 'TL', notes: '' });
check('sanitation entry 201', entry.status === 201 && entry.data.entry.localDate === '2026-11-04', JSON.stringify(entry.data).slice(0, 150));
const badEntry = await call('POST', '/api/sanitation-entries', { area: 'Prep stations', task: 'Wiped', sanitizerPpm: 999, initials: 'TL' });
check('sanitizer ppm range', badEntry.status === 422 && badEntry.data.errors.sanitizerPpm === 'Sanitizer strength is 0 to 400 ppm.', JSON.stringify(badEntry.data));
const pdf = await call('POST', '/api/sanitation-reports', { month: '2026-11' });
check('monthly pdf stored', pdf.status === 201 && pdf.data.report.status === 'stored', JSON.stringify(pdf.data));
const pdfDownload = await fetch(base + '/api/sanitation-reports/2026-11/file', { headers: { Cookie: cookie.jar } });
check('pdf download 200', pdfDownload.status === 200 && (await pdfDownload.text()).startsWith('%PDF-'));

// --- Rate versions ---
const rate = await call('POST', '/api/stations/stn_oven2/rates', { offPeakHourlyCents: 4500, peakHourlyCents: 6300, effectiveFrom: '2026-12-01T00:00' });
check('rate scheduled', rate.status === 201 && rate.data.station.rates.some((r) => r.status === 'scheduled'), JSON.stringify(rate.data).slice(0, 200));
const dupRate = await call('POST', '/api/stations/stn_oven2/rates', { offPeakHourlyCents: 4600, peakHourlyCents: 6400, effectiveFrom: '2026-12-01T00:00' });
check('duplicate effective instant 409', dupRate.status === 409 && dupRate.data.error === 'rate_version_exists', JSON.stringify(dupRate.data).slice(0, 120));
const pastRate = await call('POST', '/api/stations/stn_oven2/rates', { offPeakHourlyCents: 4600, peakHourlyCents: 6400, effectiveFrom: '2025-12-01T00:00' });
check('past rate 422', pastRate.status === 422 && pastRate.data.errors.effectiveFrom === 'Rate changes must start in the future.', JSON.stringify(pastRate.data).slice(0, 120));

// Peak windows with stale rules version
const stale = await call('PUT', '/api/kitchen/peak-windows', { windows: [], rulesVersion: 999 });
check('stale rules 412', stale.status === 412 && stale.data.current.rulesVersion !== undefined, JSON.stringify(stale.data).slice(0, 120));
const kitchenNow = await call('GET', '/api/kitchen');
const saveWindows = await call('PUT', '/api/kitchen/peak-windows', { windows: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '16:00', end: '19:00' }, { days: ['sat', 'sun'], start: '08:00', end: '13:00' }], rulesVersion: kitchenNow.data.rulesVersion });
check('peak windows saved, version bumped', saveWindows.status === 200 && saveWindows.data.rulesVersion === kitchenNow.data.rulesVersion + 1, JSON.stringify(saveWindows.data.rulesVersion));

// --- Documents upload via multipart ---
cookie.jar = null;
await call('POST', '/api/session', { email: 'nadia@okorospice.example', password: 'lineboard-demo' });
const form = new FormData();
form.append('type', 'insurance_certificate');
form.append('expiryDate', '2027-11-04');
const pdfBytes = Buffer.from('%PDF-1.4 test insurance certificate for nadia');
form.append('file', new Blob([pdfBytes]), 'insurance.pdf');
const upload = await fetch(base + '/api/documents', { method: 'POST', body: form, headers: { Cookie: cookie.jar } });
const uploadData = await upload.json();
check('upload 201', upload.status === 201 && uploadData.document.status === 'submitted', JSON.stringify(uploadData).slice(0, 200));

// A wrong-kind file is refused
const badForm = new FormData();
badForm.append('type', 'insurance_certificate');
badForm.append('expiryDate', '2027-11-04');
badForm.append('file', new Blob([Buffer.from('<html>x</html>')]), 'evil.html');
const badUpload = await fetch(base + '/api/documents', { method: 'POST', body: badForm, headers: { Cookie: cookie.jar } });
check('html upload 415', badUpload.status === 415, badUpload.status);

// Approve as operator; then Nadia can book
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const docs = await call('GET', '/api/documents?memberId=mem_nadia');
check('nadia docs listed', docs.status === 200 && docs.data.documents.length >= 2, JSON.stringify(docs.data).slice(0, 150));
const submitted = docs.data.documents.find((d) => d.status === 'submitted');
const approve = await call('POST', `/api/documents/${submitted.id}/approve`, { version: submitted.version });
check('approve 200', approve.status === 200 && approve.data.document.status === 'approved', JSON.stringify(approve.data).slice(0, 150));
const staleApprove = await call('POST', `/api/documents/${submitted.id}/approve`, { version: 1 });
check('stale approve 412', staleApprove.status === 412, staleApprove.status);

// Nadia still has no food-handler card: approve one before she can book.
cookie.jar = null;
await call('POST', '/api/session', { email: 'nadia@okorospice.example', password: 'lineboard-demo' });
const cardFormEarly = new FormData();
cardFormEarly.append('type', 'food_handler_card');
cardFormEarly.append('expiryDate', '2026-11-14');
cardFormEarly.append('file', new Blob([Buffer.from('%PDF-1.4 nadia card')]), 'card.pdf');
const cardEarly = await (await fetch(base + '/api/documents', { method: 'POST', body: cardFormEarly, headers: { Cookie: cookie.jar } })).json();
cookie.jar = null;
await call('POST', '/api/session', { email: 'ops@northside.example', password: 'lineboard-demo' });
const cardEarlyApprove = await call('POST', `/api/documents/${cardEarly.document.id}/approve`, { version: cardEarly.document.version });
check('card approve 200', cardEarlyApprove.status === 200, JSON.stringify(cardEarlyApprove).slice(0, 120));
cookie.jar = null;
await call('POST', '/api/session', { email: 'nadia@okorospice.example', password: 'lineboard-demo' });
const nadiaHold2 = await call('POST', '/api/bookings', { stationId: 'stn_prep1', date: '2026-11-05', start: '09:00', end: '11:00' }, { headers: { 'Idempotency-Key': 't-nadia-2' } });
check('nadia can book after approval', nadiaHold2.status === 201, JSON.stringify(nadiaHold2.data).slice(0, 150));

// Expiry notice: approving Nadia's first 10-day card sends the 14-day notice at once.
await new Promise((r) => setTimeout(r, 12000));
const mail = await (await fetch('http://mailpit:8025/api/v1/messages?limit=50')).json();
const notices = mail.messages.filter((m) => m.Subject.includes('notice:'));
check('expiry notice sent for 10-day card', notices.length >= 1, JSON.stringify(notices.map((n) => n.Subject)));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures > 0 ? 1 : 0);
