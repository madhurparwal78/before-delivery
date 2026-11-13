import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:4173';
let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`PASS: ${name}`); }
  else { fail += 1; failures.push(name); console.log(`FAIL: ${name} ${detail}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

// --- Journey 1: find and fit a bag ------------------------------------------
console.log('--- Journey 1');
await page.goto(`${BASE}/collections/luggage`);
await page.waitForLoadState('networkidle');
const count1 = await page.locator('#result-count-region').textContent().catch(() => '');
check('collection loads with count', (count1 ?? '').includes('products'), String(count1));

// tick Cabin size and Graphite colour by keyboard-ish interaction
const cabinBox = page.getByRole('group', { name: 'Size' }).getByRole('checkbox', { name: 'Cabin' });
await cabinBox.click();
await page.waitForTimeout(600);
const graphiteBox = page.getByRole('group', { name: 'Colour' }).getByRole('checkbox', { name: 'Graphite' });
await graphiteBox.click();
await page.waitForTimeout(600);
const count2 = await page.locator('#result-count-region').textContent().catch(() => '');
check('Luggage Cabin+Graphite = 2 products', (count2 ?? '').trim() === '2 products', String(count2));

// sort by price low to high
await page.getByRole('combobox', { name: 'Sort by' }).selectOption('price-asc');
await page.waitForTimeout(600);
const firstCard = page.locator('.product-grid article h3').first();
const firstName = await firstCard.textContent().catch(() => '');
check('Meridian Spinner first at price-asc', (firstName ?? '').trim() === 'Meridian Spinner', String(firstName));

// reload restores the same results
await page.reload();
await page.waitForLoadState('networkidle');
const url = page.url();
check('address holds filters+sort', url.includes('size=cabin') && url.includes('colour=graphite') && url.includes('sort=price-asc'), url);
const countAfter = await page.locator('#result-count-region').textContent().catch(() => '');
check('reload restores count', (countAfter ?? '').trim() === '2 products', String(countAfter));

// open the first product
await page.locator('.product-grid article a').first().click();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(400);
check('product page has gallery', await page.getByRole('region', { name: 'Gallery' }).count() > 0);

// pick Sage in Check-in Medium
await page.getByRole('radio', { name: 'Sage' }).first().click();
await page.waitForTimeout(300);
await page.getByRole('radio', { name: 'Check-in Medium' }).click();
await page.waitForTimeout(500);
const selected = await page.locator('.badge').first().textContent().catch(() => '');
check('MER-SAG-M badge Only 2 left', (selected ?? '').trim() === 'Only 2 left', String(selected));
const skuInUrl = page.url().includes('sku=MER-SAG-M');
check('sku in address', skuInUrl, page.url());

// gallery keyboard: ArrowRight moves a view
const before = await page.locator('.gallery img').getAttribute('src');
await page.locator('.gallery-tabs [role="tab"]').nth(1).focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(400);
const after = await page.locator('.gallery img').getAttribute('src');
check('gallery view changes by keyboard', before !== after, `${before} -> ${after}`);

// Gate Gauge: choose airline and read verdict
await page.getByRole('radio', { name: 'Monsoon Air' }).click();
await page.waitForTimeout(700);
const verdict = await page.locator('#fit-verdict-region').textContent().catch(() => '');
check('verdict for Monsoon Air', (verdict ?? '').length > 0, String(verdict));
const airlineInUrl = page.url().includes('airline=monsoon-air');
check('airline in address', airlineInUrl, page.url());

// --- Journey 2: compare and wishlist --------------------------------------------
console.log('--- Journey 2');
await page.goto(`${BASE}/collections/backpacks`);
await page.waitForLoadState('networkidle');
await page.locator('.product-grid article').nth(0).getByRole('button', { name: /Compare/ }).click();
await page.waitForTimeout(700);
await page.locator('.product-grid article').nth(1).getByRole('button', { name: /Compare/ }).click();
await page.waitForTimeout(700);
// the third joins; a fourth is refused with the limit notice
await page.locator('.product-grid article').nth(2).getByRole('button', { name: /Compare/ }).click();
await page.waitForTimeout(700);
const compareLink = await page.locator('.compare-link').textContent().catch(() => '');
check('compare set shows 3', (compareLink ?? '').includes('3'), String(compareLink));
await page.goto(`${BASE}/collections/all`);
await page.waitForLoadState('networkidle');
for (let i = 0; i < 4; i++) {
  await page.locator('.product-grid article').nth(i).getByRole('button', { name: /Compare/ }).click();
  await page.waitForTimeout(700);
}
const compareAll = await page.locator('.compare-link').textContent().catch(() => '');
check('fourth compare refused', (compareAll ?? '').includes('3') && !(compareAll ?? '').includes('4'), String(compareAll));
const limitNotice = await page.locator('#compare-updates').textContent().catch(() => '');
check('limit notice announced', (limitNotice ?? '').includes('up to 3'), String(limitNotice));
await page.goto(`${BASE}/compare?compare=TRN-GRA-C,RDG-SND-U,CRR-TEA-U`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
const compareRows = await page.locator('.compare-table thead th').count();
check('compare table renders', compareRows >= 4, String(compareRows));
await page.locator('.compare-table [aria-label^="Remove"]').first().click();
await page.waitForTimeout(500);
const compareAfter = await page.locator('.compare-table thead th').count();
check('compare removes a column', compareAfter === compareRows - 1, `${compareRows} -> ${compareAfter}`);

// wishlist as guest survives reload
await page.goto(`${BASE}/collections/backpacks`);
await page.waitForLoadState('networkidle');
await page.locator('.product-grid article').nth(0).getByRole('button', { name: /Save/ }).click();
await page.waitForTimeout(600);
await page.reload();
await page.waitForLoadState('networkidle');
await page.goto(`${BASE}/wishlist`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
const wishCount = await page.locator('.wishlist-grid article').count();
check('wishlist survives reload', wishCount === 1, String(wishCount));

// --- Journey 4: buy with codes ---------------------------------------------
console.log('--- Journey 4');
// sign in first: checkout needs a signed-in shopper
await page.goto(`${BASE}/sign-in`);
await page.waitForLoadState('networkidle');
await page.getByRole('textbox', { name: 'Email' }).fill('asha@roamhouse.example');
await page.getByLabel('Password').fill('travel-asha-01');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForTimeout(1000);
await page.goto(`${BASE}/collections/luggage`);
await page.waitForLoadState('networkidle');
await page.locator('.product-grid article').nth(0).getByRole('button', { name: /Quick add/ }).click();
await page.waitForTimeout(800);
const bagText = await page.locator('.bag-button').textContent().catch(() => '');
check('bag button shows count', (bagText ?? '').includes('('), String(bagText));

await page.goto(`${BASE}/bag`);
await page.waitForLoadState('networkidle');
const subtotal = await page.locator('.bag-totals div').first().textContent().catch(() => '');
check('bag totals render', (subtotal ?? '').includes('Subtotal'), String(subtotal));

// decline then place
await page.getByRole('link', { name: 'Check out' }).click();
await page.waitForLoadState('networkidle');
const step1 = await page.locator('.progress li.current').textContent().catch(() => '');
check('checkout starts at Contact', (step1 ?? '').trim() === 'Contact', String(step1));
await page.getByRole('textbox', { name: 'Email' }).fill('asha@roamhouse.example');
await page.getByRole('textbox', { name: 'Mobile number' }).fill('9820012345');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForTimeout(600);
await page.getByRole('radio', { name: 'New address' }).click();
await page.getByRole('textbox', { name: 'Full name' }).fill('Asha Menon');
await page.getByRole('textbox', { name: 'Address line 1' }).fill('14 Carter Road');
await page.getByRole('textbox', { name: 'Town or city' }).fill('Mumbai');
await page.getByRole('combobox', { name: 'State' }).selectOption('Maharashtra');
await page.getByRole('textbox', { name: 'PIN code' }).fill('400050');
await page.getByRole('textbox', { name: 'Mobile number', exact: false }).first().fill('9820012345');
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForTimeout(600);
await page.getByRole('radio', { name: 'Standard' }).check();
await page.getByRole('button', { name: 'Continue' }).click();
await page.waitForTimeout(800);
const payLabel = await page.locator('button.primary').last().textContent().catch(() => '');
check('Pay button shows amount', (payLabel ?? '').startsWith('Pay ₹'), String(payLabel));

await page.getByRole('textbox', { name: 'Card number' }).fill('4000 0000 0000 0002');
await page.getByRole('textbox', { name: 'Expiry (MM/YY)' }).fill('11/28');
await page.getByRole('textbox', { name: 'Security code' }).fill('123');
await page.locator('button.primary').last().click();
await page.waitForTimeout(2000);
const stillOnPayment = await page.locator('#step-payment').count();
check('declined card leaves shopper on Payment', stillOnPayment === 1, String(stillOnPayment));
const declinedText = await page.locator('.field-error, .alert-panel').first().textContent().catch(() => '');
check('declined card shows message', (declinedText ?? '').length > 0, String(declinedText));

await page.getByRole('textbox', { name: 'Card number' }).fill('4242 4242 4242 4242');
await page.locator('button.primary').last().click();
await page.waitForTimeout(2500);
const confirm = await page.locator('.confirmation h1').textContent().catch(() => '');
check('order confirmation focused', (confirm ?? '').includes('is placed'), String(confirm));

// --- phone layout ------------------------------------------------------------
console.log('--- Journey 8');
const phone = await browser.newPage({ viewport: { width: 375, height: 812 }, hasTouch: true });
await phone.goto(`${BASE}/collections/all`);
await phone.waitForLoadState('networkidle');
const overflows = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('phone: no sideways overflow', overflows <= 0, String(overflows));
const menuVisible = await phone.getByRole('button', { name: 'Menu' }).isVisible();
check('phone: menu button visible', menuVisible);
const searchVisible = await phone.getByRole('combobox', { name: 'Search products' }).isVisible();
check('phone: search box visible', searchVisible);
await phone.getByRole('button', { name: 'Menu' }).click();
await phone.waitForTimeout(400);
const menuOpen = await phone.getByRole('dialog', { name: 'Menu' }).isVisible();
check('phone: menu dialog opens', menuOpen);
await phone.keyboard.press('Escape');
await phone.waitForTimeout(300);
await phone.getByRole('button', { name: 'Filters' }).click();
await phone.waitForTimeout(400);
const sheetOpen = await phone.getByRole('dialog', { name: 'Filters' }).isVisible();
check('phone: filter sheet opens', sheetOpen);
await phone.getByRole('button', { name: 'Show results' }).click();
await phone.waitForTimeout(300);
const overflowsAfter = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('phone: no overflow after sheet', overflowsAfter <= 0, String(overflowsAfter));

// tablet and desktop viewports
for (const [w, h, name] of [[768, 1024, 'tablet'], [1280, 800, 'desktop']]) {
  const vp = await browser.newPage({ viewport: { width: w, height: h } });
  await vp.goto(`${BASE}/`);
  await vp.waitForLoadState('networkidle');
  const over = await vp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${name}: no sideways overflow`, over <= 0, String(over));
  await vp.close();
}

// reduced motion
const reducedPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await reducedPage.emulateMedia({ reducedMotion: 'reduce' });
await reducedPage.goto(`${BASE}/`);
await reducedPage.waitForLoadState('networkidle');
const motionAttr = await reducedPage.locator('html').getAttribute('data-motion');
check('reduced motion sets data-motion', motionAttr === 'reduced', String(motionAttr));
await reducedPage.close();

// --- Journey 5: live order tracking and cancellation --------------------------
console.log('--- Journey 5');
{
  const shopper = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const staff = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  shopper.on('pageerror', (e) => console.log('SHOPPER ERROR:', e.message));
  staff.on('pageerror', (e) => console.log('STAFF ERROR:', e.message));

  // shopper signs in, buys a bag
  await shopper.goto(`${BASE}/sign-in`);
  await shopper.getByRole('textbox', { name: 'Email' }).fill('dev@roamhouse.example');
  await shopper.getByLabel('Password').fill('travel-dev-02');
  await shopper.getByRole('button', { name: 'Sign in' }).click();
  await shopper.waitForTimeout(1000);
  await shopper.goto(`${BASE}/collections/wallets`);
  await shopper.waitForLoadState('networkidle');
  await shopper.locator('.product-grid article').nth(0).getByRole('button', { name: /Quick add/ }).click();
  await shopper.waitForTimeout(900);
  await shopper.goto(`${BASE}/bag`);
  await shopper.waitForLoadState('networkidle');
  await shopper.waitForTimeout(500);
  await shopper.getByRole('link', { name: 'Check out' }).click();
  await shopper.waitForTimeout(1200);
  await shopper.getByRole('textbox', { name: 'Email' }).fill('dev@roamhouse.example');
  await shopper.getByRole('textbox', { name: 'Mobile number' }).fill('9800000002');
  await shopper.getByRole('button', { name: 'Continue' }).click();
  await shopper.waitForTimeout(700);
  await shopper.getByRole('radio', { name: 'New address' }).click();
  await shopper.getByRole('textbox', { name: 'Full name' }).fill('Dev Raman');
  await shopper.getByRole('textbox', { name: 'Address line 1' }).fill('2 Hill Road');
  await shopper.getByRole('textbox', { name: 'Town or city' }).fill('Pune');
  await shopper.getByRole('combobox', { name: 'State' }).selectOption('Maharashtra');
  await shopper.getByRole('textbox', { name: 'PIN code' }).fill('411001');
  await shopper.getByRole('textbox', { name: 'Mobile number', exact: false }).nth(0).fill('9800000002');
  await shopper.getByRole('button', { name: 'Continue' }).click();
  await shopper.waitForTimeout(700);
  await shopper.getByRole('radio', { name: 'Standard' }).check();
  await shopper.getByRole('button', { name: 'Continue' }).click();
  await shopper.waitForTimeout(900);
  await shopper.getByRole('textbox', { name: 'Card number' }).fill('4242424242424242');
  await shopper.getByRole('textbox', { name: 'Expiry (MM/YY)' }).fill('11/28');
  await shopper.getByRole('textbox', { name: 'Security code' }).fill('123');
  await shopper.locator('button.primary').last().click();
  await shopper.waitForTimeout(2500);
  const orderUrl = shopper.url();
  const orderNumber = /order (\S+) is placed/.exec(await shopper.locator('.confirmation h1').textContent() ?? '')?.[1] ?? '';
  check('J5 order placed', orderNumber.startsWith('RH-'), orderNumber);
  await shopper.goto(`${BASE}/orders/${orderNumber}`);
  await shopper.waitForTimeout(1200);
  const timelineBefore = await shopper.locator('.timeline li').count();
  check('order page shows timeline', timelineBefore >= 1, String(timelineBefore));

  // staff packs the order; the shopper sees it live without a reload
  await staff.goto(`${BASE}/sign-in`);
  await staff.getByRole('textbox', { name: 'Email' }).fill('ops@roamhouse.example');
  await staff.getByLabel('Password').fill('ops-priya-03');
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await staff.waitForTimeout(1000);
  await staff.goto(`${BASE}/admin/orders/${orderNumber}`);
  await staff.waitForTimeout(1500);
  const packVisible = await staff.getByRole('button', { name: 'Mark packed' }).count();
  check('staff order page shows Mark packed', packVisible === 1, String(packVisible));
  await staff.getByRole('button', { name: 'Mark packed' }).click();
  await staff.waitForTimeout(2500);
  const staffStatus = await staff.locator('h1 + p, .staff-updates').first().textContent().catch(() => '');
  const timelineAfter = await shopper.locator('.timeline li').count();
  check('shopper sees Packed live', timelineAfter === timelineBefore + 1, `${timelineBefore} -> ${timelineAfter}`);
  const shopperStatus = await shopper.locator('.status-line').first().textContent().catch(() => '');
  check('shopper status reads Packed', (shopperStatus ?? '').includes('Packed'), String(shopperStatus));

  // shopper cancels through the dialog
  await shopper.getByRole('button', { name: 'Cancel order' }).click();
  await shopper.waitForTimeout(500);
  const dialog = shopper.getByRole('alertdialog', { name: 'Cancel this order?' });
  check('cancel dialog opens', await dialog.count() === 1);
  await dialog.getByRole('button', { name: 'Yes, cancel order' }).click();
  await shopper.waitForTimeout(2000);
  const cancelledStatus = await shopper.locator('.status-line').first().textContent().catch(() => '');
  check('order cancelled', (cancelledStatus ?? '').includes('Cancelled'), String(cancelledStatus));

  await shopper.close();
  await staff.close();
}

// --- Journey 7: staff live price change and stale save -----------------------
console.log('--- Journey 7');
{
  const staffA = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const staffB = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const shopperPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  for (const p of [staffA, staffB]) {
    await p.goto(`${BASE}/sign-in`);
    await p.getByRole('textbox', { name: 'Email' }).fill('ops@roamhouse.example');
    await p.getByLabel('Password').fill('ops-priya-03');
    await p.getByRole('button', { name: 'Sign in' }).click();
    await p.waitForTimeout(900);
  }
  await staffA.goto(`${BASE}/admin/products/harbour-softside`);
  await staffB.goto(`${BASE}/admin/products/harbour-softside`);
  await staffA.waitForTimeout(1500);
  await staffB.waitForTimeout(1500);

  // the shopper has the product page open
  await shopperPage.goto(`${BASE}/products/harbour-softside`);
  await shopperPage.waitForTimeout(1200);
  const priceBefore = await shopperPage.locator('.product-main .price').textContent().catch(() => '');
  check('J7 product page open', (priceBefore ?? '').length > 0, String(priceBefore));

  // manager A changes the price
  const firstVariant = staffA.locator('.variant-form').first();
  await firstVariant.locator('input[aria-label="Price"]').fill('9499');
  await firstVariant.getByRole('button', { name: /Save/ }).click();
  await staffA.waitForTimeout(2500);
  const savedNotice = await staffA.locator('#staff-updates').textContent().catch(() => '');
  check('staff saved variant', (savedNotice ?? '').includes('Saved'), String(savedNotice));

  // manager B's stale save is refused
  const staleVariant = staffB.locator('.variant-form').first();
  await staleVariant.locator('input[aria-label="Price"]').fill('8999');
  await staleVariant.getByRole('button', { name: /Save/ }).click();
  await staffB.waitForTimeout(2000);
  const staleAlert = await staffB.locator('.alert-panel').textContent().catch(() => '');
  check('stale save refused', (staleAlert ?? '').includes('changed since you opened'), String(staleAlert));
  const reloadButton = await staffB.getByRole('button', { name: 'Reload latest' }).count();
  check('reload latest offered', reloadButton === 1, String(reloadButton));

  // the open product page shows the change without a reload
  await shopperPage.waitForTimeout(2000);
  const priceAfter = await shopperPage.locator('.product-main .price').textContent().catch(() => '');
  check('live price reached the product page', (priceAfter ?? '').includes('9,499'), `${priceBefore} -> ${priceAfter}`);
  const updateAnnounced = await shopperPage.locator('#product-updates').textContent().catch(() => '');
  check('price change announced', (updateAnnounced ?? '').includes('Price updated'), String(updateAnnounced));

  // staff shopper refusal: a customer cannot open the staff area
  const customer = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await customer.goto(`${BASE}/sign-in`);
  await customer.getByRole('textbox', { name: 'Email' }).fill('asha@roamhouse.example');
  await customer.getByLabel('Password').fill('travel-asha-01');
  await customer.getByRole('button', { name: 'Sign in' }).click();
  await customer.waitForTimeout(900);
  await customer.goto(`${BASE}/admin`);
  await customer.waitForTimeout(800);
  const refusal = await customer.locator('h1').first().textContent().catch(() => '');
  check('shopper sees staff refusal page', (refusal ?? '').includes('This area is for Roam House staff.'), String(refusal));
  await customer.close();

  await staffA.close();
  await staffB.close();
  await shopperPage.close();
}

// --- Journey 2 second half: wishlist merge on sign-in -------------------------
console.log('--- Journey 2b');
{
  const guest = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  guest.on('pageerror', (e) => console.log('GUEST ERROR:', e.message));
  await guest.goto(`${BASE}/collections/totes`);
  await guest.waitForLoadState('networkidle');
  await guest.locator('.product-grid article').nth(0).getByRole('button', { name: /Save/ }).click();
  await guest.waitForTimeout(900);
  const savedBefore = await guest.locator('a[aria-label^="Wishlist,"]').textContent().catch(() => '');
  check('guest wishlist count 1', (savedBefore ?? '').includes('1'), String(savedBefore));
  await guest.locator('.product-grid article').nth(1).getByRole('button', { name: /Save/ }).click();
  await guest.waitForTimeout(900);

  // sign in: the guest wishlist joins the account with no duplicates
  await guest.goto(`${BASE}/sign-in`);
  await guest.getByRole('textbox', { name: 'Email' }).fill('asha@roamhouse.example');
  await guest.getByLabel('Password').fill('travel-asha-01');
  await guest.getByRole('button', { name: 'Sign in' }).click();
  await guest.waitForTimeout(1500);
  await guest.goto(`${BASE}/wishlist`);
  await guest.waitForLoadState('networkidle');
  await guest.waitForTimeout(1200);
  const merged = await guest.locator('.wishlist-grid article').count();
  check('wishlist merged into account', merged >= 2, String(merged));
  const links = await guest.locator('a[aria-label^="Wishlist,"]').textContent().catch(() => '');
  check('header wishlist count after merge', (links ?? '').length > 0, String(links));

  // a second session of the account sees wishlist changes live
  const second = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await second.goto(`${BASE}/sign-in`);
  await second.getByRole('textbox', { name: 'Email' }).fill('asha@roamhouse.example');
  await second.getByLabel('Password').fill('travel-asha-01');
  await second.getByRole('button', { name: 'Sign in' }).click();
  await second.waitForTimeout(1200);
  await second.goto(`${BASE}/collections/accessories`);
  await second.waitForLoadState('networkidle');
  const countBefore = await second.locator('a[aria-label^="Wishlist,"]').textContent().catch(() => '');
  // the first session removes one
  await guest.locator('.wishlist-grid article').nth(0).getByRole('button', { name: /Remove/ }).click();
  await guest.waitForTimeout(2000);
  const countAfter = await second.locator('a[aria-label^="Wishlist,"]').textContent().catch(() => '');
  check('second session sees wishlist live', countBefore !== countAfter, `${countBefore} -> ${countAfter}`);
  await guest.close();
  await second.close();
}

console.log('========================');
console.log(`PASS: ${pass}  FAIL: ${fail}`);
if (failures.length > 0) console.log('Failures:', failures.join(', '));
await browser.close();
process.exit(fail > 0 ? 1 : 0);
