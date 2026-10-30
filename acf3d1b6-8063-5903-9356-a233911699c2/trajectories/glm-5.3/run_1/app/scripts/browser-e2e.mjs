// Browser journey checks against a running app. Run: node scripts/browser-e2e.mjs <base>
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const MAILPIT = process.env.MAILPIT_URL || 'http://mailpit:8025';
let pass = 0, fail = 0;
const results = [];
const check = (name, ok, extra = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`;
  results.push(line);
  console.log(line);
  if (ok) pass++; else fail++;
};

const rnd = () => Math.random().toString(36).slice(2, 8);
const browser = await chromium.launch();

async function mailFor(toAddress, subjectPart, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages`);
    const list = await res.json();
    for (const m of list.messages || []) {
      const tos = (m.To || []).map(x => x.Address);
      if (tos.includes(toAddress) && m.Subject.includes(subjectPart)) {
        const full = await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json();
        return { subject: m.Subject, text: full.Text };
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

// ---------------- Journey 1: pricing -> signup -> composer -> Ready
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.goto(`${BASE}/pricing`);
  const yearlyOn = await page.getByRole('switch', { name: 'Yearly billing' }).getAttribute('aria-checked');
  check('pricing opens on yearly', yearlyOn === 'true', String(yearlyOn));
  const stdPrice = await page.locator('.plan-card', { hasText: 'Standard' }).locator('.amount').first().textContent();
  check('standard yearly $12', stdPrice.trim() === '$12', stdPrice);
  await page.getByRole('switch', { name: 'Yearly billing' }).click();
  const stdMonthly = await page.locator('.plan-card', { hasText: 'Standard' }).locator('.amount').first().textContent();
  check('standard monthly $15', stdMonthly.trim() === '$15', stdMonthly);
  await page.getByRole('switch', { name: 'Yearly billing' }).click();

  const lenaEmail = `lena.${rnd()}@example.com`;
  await page.locator('.plan-card', { hasText: 'Free' }).getByRole('link', { name: 'Start Free' }).click();
  await page.waitForURL('**/signup');
  await page.getByLabel('Name').fill('Lena Hart');
  await page.getByLabel('Email').fill(lenaEmail);
  await page.getByLabel('Password').fill('longpassword1');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.waitForURL('**/studio');
  const balance = await page.locator('.sidebar .balance').textContent();
  check('signup lands with 125 credits', balance.trim() === '125 credits', balance);

  // composer journey
  await page.getByLabel('Prompt').fill('A paper lantern rising over a quiet harbour at night');
  await page.getByRole('radio', { name: 'Vela 4.5' }).check();
  await page.getByRole('radio', { name: '10 seconds' }).check();
  const cost = await page.locator('.cost-line').textContent();
  check('cost line 120', cost.includes('120 credits'), cost);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expectText(page, page.locator('.sidebar .balance'), '5 credits', 8000);
  const card = page.locator('.gen-card', { hasText: 'paper lantern' });
  await expectText(page, card.locator('.status-chip').first(), 'Queued');
  // a second Generate the balance cannot cover is refused
  await page.getByLabel('Prompt').fill('A second lonely lantern');
  await page.getByRole('radio', { name: 'Vela 4 Turbo' }).check();
  await page.getByRole('radio', { name: '5 seconds' }).check();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Generate', exact: true }).click().catch(() => {});
  await page.waitForTimeout(1500);
  const banner = await page.locator('.error-banner').textContent().catch(() => '');
  check('refusal message shows', banner.includes('Not enough credits. This needs 30 and you have 5.'), banner);

  await expectText(page, card.locator('.status-chip').first(), 'Ready', 40000);
  const img = card.locator('img');
  await expectVisible(page, img);
  const alt = await img.getAttribute('alt');
  check('picture alt is the prompt', alt === 'A paper lantern rising over a quiet harbour at night', String(alt));
  const errors1 = errors.filter(e => !/favicon/.test(e));
  check('no client errors (journey 1)', errors1.length === 0, errors1.join(' | '));
  await ctx.close();
}

// ---------------- Journey 2: creator cancel while rendering
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('creator@example.com');
  await page.getByLabel('Password').fill('deku-demo-pw-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/studio');
  let bal = await page.locator('.sidebar .balance').textContent();
  check('creator 595 credits', bal.includes('595'), bal);
  await page.getByLabel('Prompt').fill('Neon reflections on a wet dance floor, slow camera push');
  await page.getByRole('radio', { name: 'Vela 4 Turbo' }).check();
  await page.getByRole('radio', { name: '5 seconds' }).check();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.waitForTimeout(2500);
  bal = await page.locator('.sidebar .balance').textContent();
  check('creator 565 while rendering', bal.includes('565'), bal);
  const newCard = page.locator('.gen-card', { hasText: 'Neon reflections' }).first();
  await expectText(page, newCard.locator('.status-chip').first(), 'Rendering');
  await newCard.getByRole('button', { name: 'Cancel' }).click();
  const toast = await page.locator('.toast').textContent().catch(() => '');
  check('cancel toast', toast.includes('Cancelled. 30 credits returned.'), toast);
  await expectText(page, newCard.locator('.status-chip').first(), 'Cancelled');
  bal = await page.locator('.sidebar .balance').textContent();
  check('creator back to 595', bal.includes('595'), bal);
  await page.goto(`${BASE}/studio/credits`);
  const firstRow = await page.locator('.credit-table tbody tr').first().textContent();
  check('credits newest refund', firstRow.includes('Refund') && firstRow.includes('+30'), firstRow);
  const secondRow = await page.locator('.credit-table tbody tr').nth(1).textContent();
  check('credits second charge', secondRow.includes('Generation') && secondRow.includes('-30'), secondRow);
  await ctx.close();
}

// ---------------- Journey 3: invite via email link
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('owner@example.com');
  await page.getByLabel('Password').fill('deku-demo-pw-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/studio');
  await page.goto(`${BASE}/studio/team`);
  const seats = await page.locator('.seat-line').textContent();
  check('team shows 2 of 9 seats', seats.includes('2 of 9 seats used'), seats);
  const joEmail = `jo.ellis.${rnd()}@example.com`;
  await page.getByRole('button', { name: 'Invite teammate' }).click();
  const dialog = page.locator('.dialog');
  await expectVisible(page, dialog);
  await dialog.getByLabel('Email').fill(joEmail);
  await dialog.getByRole('button', { name: 'Send invite' }).click();
  await page.waitForTimeout(800);
  const invMail = await mailFor(joEmail, 'invited you to Northlight Studio');
  check('invite email arrived', !!invMail);
  check('invite subject exact', invMail && invMail.subject === 'Mara Quinn invited you to Northlight Studio on Kinora', invMail && invMail.subject);
  const link = invMail && invMail.text.match(/https?:\/\/\S+\/invite\/\S+/)[0].replace('http://127.0.0.1:4173', BASE);

  // Jo joins in a new context
  const joCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const jo = await joCtx.newPage();
  await jo.goto(link);
  await expectVisible(jo, jo.locator('h1'));
  await jo.getByLabel('Name').fill('Jo Ellis');
  await jo.getByLabel('Password').fill('longpassword1');
  await jo.getByRole('button', { name: 'Join team' }).click();
  await expectText(jo, jo.locator('.auth-card h1'), 'You\u2019re in. Welcome to Northlight Studio.', 15000);
  await jo.getByRole('button', { name: 'Open the studio' }).click();
  await jo.waitForURL('**/studio');
  const joBal = await jo.locator('.sidebar .balance').textContent();
  check('jo sees 20,564 credits', joBal.trim() === '20,564 credits', joBal);
  await page.reload();
  await expectText(page, page.locator('.sidebar .balance'), '20,564 credits', 10000);
  await joCtx.close();

  // Theo sees Jo but no invite button
  const theoCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const theo = await theoCtx.newPage();
  await theo.goto(`${BASE}/login`);
  await theo.getByLabel('Email').fill('member@example.com');
  await theo.getByLabel('Password').fill('deku-demo-pw-2026');
  await theo.getByRole('button', { name: 'Log in' }).click();
  await theo.waitForURL('**/studio');
  await theo.goto(`${BASE}/studio/team`);
  {
    const start = Date.now(); let found = false;
    while (Date.now() - start < 10000) {
      const txt = (await theo.locator('.member-list').first().textContent().catch(() => '')) || '';
      if (txt.includes('Jo Ellis')) { found = true; break; }
      await theo.waitForTimeout(500);
    }
    check('theo sees jo on team', found);
  }
  check('theo has no invite button', !(await theo.getByRole('button', { name: 'Invite teammate' }).count()), '');
  check('theo has no revoke', !(await theo.getByRole('button', { name: 'Revoke' }).count()), '');
  await theoCtx.close();
  await ctx.close();
}

// ---------------- Journey 4: enterprise enquiry
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/enterprise-contact`);
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForTimeout(400);
  const alerts = await page.locator('.error-text').count();
  check('empty form shows field errors', alerts >= 7, `alerts=${alerts}`);
  const kept = await page.getByLabel('Business Email').inputValue();
  check('values kept after failure', kept === '', kept);
  const hpEmail = `hp.${rnd()}@example.com`;
  await page.getByLabel('First Name').fill('Harbour');
  await page.getByLabel('Last Name').fill('Pine');
  await page.getByLabel('Business Email').fill(hpEmail);
  await page.locator('#enq-company').fill('Harbour & Pine');
  await page.getByLabel('Company Size').selectOption('201-1,000');
  await page.getByLabel('Industry').selectOption('Gaming');
  await page.getByLabel('Creative Platform').check();
  await page.getByLabel('Message').fill('We need a quote for the winter campaign work.');
  await page.getByRole('button', { name: 'Submit' }).click();
  const thanks = await page.locator('.card h2').first().textContent().catch(() => '');
  check('enquiry confirmation', thanks.includes('Thanks, we will be in touch within two business days.'), thanks);
  const salesMail = await mailFor('sales@example.com', 'New enterprise enquiry from Harbour & Pine');
  check('sales email exact subject', salesMail && salesMail.subject === 'New enterprise enquiry from Harbour & Pine', salesMail && salesMail.subject);
  const ackMail = await mailFor(hpEmail, 'We received your enquiry');
  check('visitor ack email', !!ackMail, `no ack to ${hpEmail}`);
  await ctx.close();
}

// ---------------- accessibility + responsive spot checks
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(300);
  const scrolled = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('home no sideways scroll at 375px', !scrolled);
  const menuBtn = page.getByRole('button', { name: 'Menu' });
  check('mobile menu button', await menuBtn.count() === 1);
  await menuBtn.click();
  await expectVisible(page, page.locator('.drawer'));
  // the drawer moves focus inside itself once it opens; wait for that first
  {
    const start = Date.now(); let focused = false;
    while (Date.now() - start < 4000) {
      focused = await page.evaluate(() => !!document.activeElement
        && !!document.activeElement.closest('.drawer'));
      if (focused) break;
      await page.waitForTimeout(150);
    }
    check('drawer moves focus inside', focused);
  }
  await page.keyboard.press('Escape');
  {
    const start = Date.now(); let closed = false;
    while (Date.now() - start < 4000) {
      if ((await page.locator('.drawer').count()) === 0) { closed = true; break; }
      await page.waitForTimeout(250);
    }
    check('drawer closes on Escape', closed);
  }
  await page.goto(`${BASE}/examples`);
  await page.waitForTimeout(300);
  const exScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('examples no sideways scroll', !exScroll);

  // focus ring visible on a control
  await page.goto(`${BASE}/login`);
  await page.keyboard.press('Tab');
  const focusInfo = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return { tag: 'none' };
    const st = getComputedStyle(el);
    const boxShadow = st.boxShadow;
    return { tag: el.tagName, boxShadow: boxShadow !== 'none' && boxShadow !== '' };
  });
  check('focus ring visible', focusInfo.boxShadow === true, JSON.stringify(focusInfo));
  await ctx.close();
}

// ---------------- studio phone drawer
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('member@example.com');
  await page.getByLabel('Password').fill('deku-demo-pw-2026');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/studio');
  const scrolled = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('studio no sideways scroll at 375px', !scrolled);
  await page.getByRole('button', { name: 'Menu' }).first().click();
  await expectVisible(page, page.locator('.sidebar.open'));
  await ctx.close();
}

async function expectText(page, locator, text, timeout = 40000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = ((await locator.first().textContent().catch(() => '')) || '').trim();
    if (t === text) { check(`text "${text}" appears`, true); return; }
    await page.waitForTimeout(500);
  }
  const last = ((await locator.first().textContent().catch(() => '')) || '').trim();
  check(`text "${text}" appears`, false, `last="${last}"`);
}

async function expectVisible(page, locator, timeout = 5000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); check('element visible', true); }
  catch (e) { check('element visible', false, e.message.split('\n')[0]); }
}

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
