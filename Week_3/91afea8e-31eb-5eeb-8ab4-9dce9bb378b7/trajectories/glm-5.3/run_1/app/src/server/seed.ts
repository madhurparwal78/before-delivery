import { query, withTransaction, type PoolClient } from "./db.js";
import { hashPassword, id } from "./crypto.js";
import { addDays, istDateString } from "./time.js";

interface SeedCategory { slug: string; name: string; gstRate: number; commission: number; returnDays: number }
const CATEGORIES: SeedCategory[] = [
  { slug: "kitchen", name: "Kitchen", gstRate: 5, commission: 10, returnDays: 10 },
  { slug: "fashion", name: "Fashion", gstRate: 5, commission: 15, returnDays: 7 },
  { slug: "electronics", name: "Electronics", gstRate: 18, commission: 7, returnDays: 7 },
  { slug: "beverages", name: "Beverages", gstRate: 40, commission: 8, returnDays: 0 },
];

const PINCODES = [
  { pin: "110001", city: "New Delhi", state: "Delhi", serviceable: true, cod: true, remote: false },
  { pin: "400001", city: "Mumbai", state: "Maharashtra", serviceable: true, cod: true, remote: false },
  { pin: "411001", city: "Pune", state: "Maharashtra", serviceable: true, cod: true, remote: false },
  { pin: "560001", city: "Bengaluru", state: "Karnataka", serviceable: true, cod: true, remote: false },
  { pin: "560034", city: "Bengaluru", state: "Karnataka", serviceable: true, cod: true, remote: false },
  { pin: "380001", city: "Ahmedabad", state: "Gujarat", serviceable: true, cod: true, remote: false },
  { pin: "700001", city: "Kolkata", state: "West Bengal", serviceable: true, cod: true, remote: false },
  { pin: "194101", city: "Leh", state: "Ladakh", serviceable: true, cod: false, remote: true },
  { pin: "744101", city: "Port Blair", state: "Andaman and Nicobar Islands", serviceable: false, cod: false, remote: false },
];

const SERVICEABLE_STATES = ["Delhi", "Maharashtra", "Karnataka", "Gujarat", "West Bengal", "Ladakh"];

interface SeedSeller {
  id: string; name: string; email: string; phone: string; password: string;
  city: string; state: string; gstin: string; dispatch: number; rating: number; cod: boolean;
  shipStates: string[] | "all-except-ladakh" | "all";
}
const SELLERS: SeedSeller[] = [
  { id: "S-KAVERI", name: "Kaveri Handlooms", email: "kaveri@example.test", phone: "+919800000011", password: "Kaveri@Seller2026", city: "Bengaluru", state: "Karnataka", gstin: "29ABCDE1234F1Z5", dispatch: 1, rating: 4.6, cod: true, shipStates: "all" },
  { id: "S-GANGA", name: "Ganga Steelworks", email: "ganga@example.test", phone: "+919800000012", password: "Ganga@Seller2026", city: "New Delhi", state: "Delhi", gstin: "07ABCDE5678G1Z3", dispatch: 2, rating: 4.2, cod: true, shipStates: "all" },
  { id: "S-MARINE", name: "Marine Drive Gadgets", email: "marinedrive@example.test", phone: "+919800000013", password: "Marine@Seller2026", city: "Mumbai", state: "Maharashtra", gstin: "27ABCDE9012H1Z1", dispatch: 1, rating: 4.4, cod: false, shipStates: ["Maharashtra", "Karnataka", "Gujarat", "Delhi"] },
  { id: "S-SABAR", name: "Sabarmati Electronics", email: "sabarmati@example.test", phone: "+919800000014", password: "Sabarmati@Seller2026", city: "Ahmedabad", state: "Gujarat", gstin: "24ABCDE3456J1Z9", dispatch: 2, rating: 3.8, cod: true, shipStates: "all-except-ladakh" },
];

interface SeedProduct {
  id: string; title: string; brand: string; category: string; rating: number;
  description: string; specs: Record<string, string | number>;
}
const PRODUCTS: SeedProduct[] = [
  { id: "steel-tiffin-3", title: "Steel Tiffin Stack, 3 tier", brand: "Dabba Co", category: "kitchen", rating: 4.5, description: "Three stainless steel tiers with a tight lid and a side clip. Keeps rotis soft and sambar where it belongs.", specs: { capacity_litres: 1.8, weight_grams: 720 } },
  { id: "pressure-cooker-5l", title: "Pressure Cooker 5 L", brand: "Seeti", category: "kitchen", rating: 4.3, description: "Five litre cooker with a thick induction base and a loud, honest whistle.", specs: { capacity_litres: 5, weight_grams: 3100 } },
  { id: "copper-bottle-1l", title: "Copper Water Bottle 1 L", brand: "Tamra", category: "kitchen", rating: 4.1, description: "Hammered copper bottle, one litre, lacquered outside so it keeps its shine.", specs: { capacity_litres: 1, weight_grams: 340 } },
  { id: "ilkal-saree", title: "Ilkal Handloom Saree", brand: "Kaveri Looms", category: "fashion", rating: 4.7, description: "Handwoven Ilkal cotton-silk with a kasuti border and a pallu that drapes like water.", specs: { length_metres: 6.3, weight_grams: 680 } },
  { id: "cotton-kurta", title: "Block-print Cotton Kurta", brand: "Kaveri Looms", category: "fashion", rating: 4.2, description: "Hand block-printed cotton kurta, colour-fast dyes, side slits for easy sitting.", specs: { fabric: "cotton", weight_grams: 420 } },
  { id: "dhwani-speaker", title: "Dhwani Bluetooth Speaker", brand: "Dhwani", category: "electronics", rating: 4.4, description: "Loud little speaker with a 360-degree grille and a strap that survives an auto ride.", specs: { battery_hours: 14, weight_grams: 540, warranty_months: 12, water_resistance: "IPX5" } },
  { id: "tara-smartwatch", title: "Tara Smartwatch", brand: "Tara", category: "electronics", rating: 4.0, description: "Round-dial smartwatch with a week of battery and a screen that reads well in sun.", specs: { battery_hours: 168, weight_grams: 52, warranty_months: 18, water_resistance: "IP68" } },
  { id: "lehar-earbuds", title: "Lehar Wireless Earbuds", brand: "Lehar", category: "electronics", rating: 3.9, description: "True wireless earbuds with a low-latency mode for the match.", specs: { battery_hours: 24, weight_grams: 46, warranty_months: 6, water_resistance: "IPX4" } },
  { id: "jugnu-powerbank", title: "Jugnu Power Bank 20000 mAh", brand: "Jugnu", category: "electronics", rating: 4.2, description: "Twenty-thousand milliamp power bank with two outputs and a torch that actually helps.", specs: { battery_hours: 0, weight_grams: 430, warranty_months: 12, water_resistance: "none" } },
  { id: "pankha-desk-fan", title: "Pankha USB Desk Fan", brand: "Pankha", category: "electronics", rating: 3.7, description: "USB desk fan with a metal stand and three speeds.", specs: { battery_hours: 6, weight_grams: 380, warranty_months: 6, water_resistance: "none" } },
  { id: "jaljeera-fizz-24", title: "Jaljeera Fizz, crate of 24 cans", brand: "Fizzwala", category: "beverages", rating: 4.0, description: "Twenty-four cans of spiced, fizzy jaljeera. Best cold, better with a limca chaser.", specs: { cans: 24, weight_grams: 8600 } },
];

interface SeedListing {
  listing: string; product: string; seller: string; pricePaise: number; stock: number; costPaise: number; cod: boolean; noCostEmi: boolean;
}
const LISTINGS: SeedListing[] = [
  { listing: "L-1001", product: "steel-tiffin-3", seller: "S-GANGA", pricePaise: 64900, stock: 25, costPaise: 38000, cod: true, noCostEmi: false },
  { listing: "L-1002", product: "steel-tiffin-3", seller: "S-KAVERI", pricePaise: 69900, stock: 10, costPaise: 40000, cod: true, noCostEmi: false },
  { listing: "L-1003", product: "pressure-cooker-5l", seller: "S-GANGA", pricePaise: 189900, stock: 12, costPaise: 115000, cod: true, noCostEmi: false },
  { listing: "L-1004", product: "copper-bottle-1l", seller: "S-GANGA", pricePaise: 49900, stock: 1, costPaise: 26000, cod: true, noCostEmi: false },
  { listing: "L-1005", product: "ilkal-saree", seller: "S-KAVERI", pricePaise: 345000, stock: 6, costPaise: 210000, cod: true, noCostEmi: false },
  { listing: "L-1006", product: "cotton-kurta", seller: "S-KAVERI", pricePaise: 89900, stock: 30, costPaise: 45000, cod: true, noCostEmi: false },
  { listing: "L-1007", product: "dhwani-speaker", seller: "S-MARINE", pricePaise: 249900, stock: 40, costPaise: 170000, cod: false, noCostEmi: true },
  { listing: "L-1008", product: "dhwani-speaker", seller: "S-SABAR", pricePaise: 244900, stock: 15, costPaise: 165000, cod: true, noCostEmi: false },
  { listing: "L-1009", product: "tara-smartwatch", seller: "S-MARINE", pricePaise: 599900, stock: 20, costPaise: 410000, cod: false, noCostEmi: true },
  { listing: "L-1014", product: "tara-smartwatch", seller: "S-SABAR", pricePaise: 609900, stock: 8, costPaise: 420000, cod: true, noCostEmi: false },
  { listing: "L-1010", product: "lehar-earbuds", seller: "S-SABAR", pricePaise: 179900, stock: 3, costPaise: 110000, cod: true, noCostEmi: false },
  { listing: "L-1011", product: "jugnu-powerbank", seller: "S-SABAR", pricePaise: 129900, stock: 50, costPaise: 80000, cod: true, noCostEmi: false },
  { listing: "L-1012", product: "pankha-desk-fan", seller: "S-SABAR", pricePaise: 59900, stock: 0, costPaise: 33000, cod: true, noCostEmi: false },
  { listing: "L-1013", product: "jaljeera-fizz-24", seller: "S-GANGA", pricePaise: 96000, stock: 40, costPaise: 60000, cod: true, noCostEmi: false },
];

const SHOPPERS = [
  { id: "U-ASHA", name: "Asha Verma", email: "asha@example.test", phone: "+919800000001", password: "Asha@Bazaar2026", balance: 50000 },
  { id: "U-RAVI", name: "Ravi Iyer", email: "ravi@example.test", phone: "+919800000002", password: "Ravi@Bazaar2026", balance: 0 },
  { id: "U-MEERA", name: "Meera Das", email: "meera@example.test", phone: "+919800000003", password: "Meera@Bazaar2026", balance: 0 },
];

const SUPPORT = { id: "U-SUPPORT", name: "Nikhil Rao", email: "support@example.test", phone: "+919800000021", password: "Support@Desk2026" };

const ASHA_ADDRESSES = [
  { id: "AD-ASHA-1", label: "Home", name: "Asha Verma", line1: "A-12 Lakshmi Residency, 5th Cross", line2: "Koramangala", city: "Bengaluru", state: "Karnataka", pin: "560034", phone: "+919800000001" },
  { id: "AD-ASHA-2", label: "Office", name: "Asha Verma", line1: "4th Floor, Indigo Tech Park", line2: "", city: "Mumbai", state: "Maharashtra", pin: "400001", phone: "+919800000001" },
];
const RAVI_ADDRESSES = [
  { id: "AD-RAVI-1", label: "Home", name: "Ravi Iyer", line1: "Flat 7, Sagar Apartments, Marine Lines", line2: "", city: "Mumbai", state: "Maharashtra", pin: "400001", phone: "+919800000002" },
];
const MEERA_ADDRESSES = [
  { id: "AD-MEERA-1", label: "Home", name: "Meera Das", line1: "22 Park Lane", line2: "", city: "Kolkata", state: "West Bengal", pin: "700001", phone: "+919800000003" },
];

const BANKS = [
  { code: "SAFB", name: "Saffron Bank" },
  { code: "NILB", name: "Nilgiri Bank" },
  { code: "DECB", name: "Deccan Cooperative Bank" },
  { code: "KONB", name: "Konkan Bank" },
];

interface SeedOrder {
  order: string; shopper: string; shipment: string; listing: string; qty: number;
  method: string; amountPaise: number; state: string; daysAgo: number; deliveredDaysAgo?: number;
  addressId: string; speed: string;
}
const ORDERS: SeedOrder[] = [
  { order: "CH-SEED0001", shopper: "U-ASHA", shipment: "SH-SEED0001", listing: "L-1005", qty: 1, method: "card", amountPaise: 345000, state: "delivered", daysAgo: 2, deliveredDaysAgo: 2, addressId: "AD-ASHA-1", speed: "standard" },
  { order: "CH-SEED0002", shopper: "U-ASHA", shipment: "SH-SEED0002", listing: "L-1001", qty: 2, method: "upi", amountPaise: 129800, state: "delivered", daysAgo: 20, deliveredDaysAgo: 20, addressId: "AD-ASHA-1", speed: "standard" },
  { order: "CH-SEED0003", shopper: "U-ASHA", shipment: "SH-SEED0003", listing: "L-1007", qty: 1, method: "upi", amountPaise: 249900, state: "shipped", daysAgo: 1, addressId: "AD-ASHA-1", speed: "standard" },
  { order: "CH-SEED0004", shopper: "U-RAVI", shipment: "SH-SEED0004", listing: "L-1011", qty: 1, method: "cod", amountPaise: 132400, state: "placed", daysAgo: 0, addressId: "AD-RAVI-1", speed: "standard" },
  { order: "CH-SEED0005", shopper: "U-MEERA", shipment: "SH-SEED0005", listing: "L-1013", qty: 1, method: "cod", amountPaise: 98500, state: "placed", daysAgo: 0, addressId: "AD-MEERA-1", speed: "standard" },
  { order: "CH-SEED0006", shopper: "U-MEERA", shipment: "SH-SEED0006", listing: "L-1013", qty: 1, method: "cod", amountPaise: 98500, state: "placed", daysAgo: 0, addressId: "AD-MEERA-1", speed: "standard" },
  { order: "CH-SEED0007", shopper: "U-MEERA", shipment: "SH-SEED0007", listing: "L-1013", qty: 1, method: "cod", amountPaise: 98500, state: "placed", daysAgo: 0, addressId: "AD-MEERA-1", speed: "standard" },
];

const KB_SPEC = [
  { name: "Ilkal Handloom Saree", net: 281947, gross: 345000, commission: 51750, cgst: 9315, tcs: 1643, tds: 345 },
];

export async function seedIfEmpty(): Promise<void> {
  const marker = await query<{ value: string }>("SELECT value FROM seed_markers WHERE name = 'seeded'");
  if (marker.length > 0) return;
  await withTransaction(async (client) => {
    const lock = await client.query("SELECT pg_try_advisory_xact_lock(918273645) AS locked");
    if (!lock.rows[0].locked) return;
    const again = await client.query("SELECT value FROM seed_markers WHERE name = 'seeded' FOR UPDATE");
    if (again.rows.length > 0) return;

    const seedTime = new Date();
    const today = istDateString(seedTime);

    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (slug, name, gst_rate, commission_percent, return_days) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (slug) DO NOTHING`,
        [c.slug, c.name, c.gstRate, c.commission, c.returnDays],
      );
    }
    for (const p of PINCODES) {
      await client.query(
        `INSERT INTO pincodes (pincode, city, state, serviceable, cod_available, remote) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (pincode) DO NOTHING`,
        [p.pin, p.city, p.state, p.serviceable, p.cod, p.remote],
      );
    }
    for (const s of SELLERS) {
      const shipStates = s.shipStates === "all" ? SERVICEABLE_STATES
        : s.shipStates === "all-except-ladakh" ? SERVICEABLE_STATES.filter((x) => x !== "Ladakh")
        : s.shipStates;
      await client.query(
        `INSERT INTO sellers (seller_id, name, email, phone, password_hash, pickup_city, pickup_state, gstin, dispatch_days, rating, cod_allowed, ship_states, ship_all_states)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (seller_id) DO NOTHING`,
        [s.id, s.name, s.email, s.phone, hashPassword(s.password), s.city, s.state, s.gstin, s.dispatch, s.rating, s.cod, shipStates, s.shipStates === "all"],
      );
    }
    for (const p of PRODUCTS) {
      await client.query(
        `INSERT INTO products (product_id, title, brand, category, rating, description, specs) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (product_id) DO NOTHING`,
        [p.id, p.title, p.brand, p.category, p.rating, p.description, JSON.stringify(p.specs)],
      );
    }
    let seq = 1;
    for (const l of LISTINGS) {
      await client.query(
        `INSERT INTO listings (listing_id, product_id, seller_id, price_paise, cost_price_paise, stock, status, cod_allowed, no_cost_emi, description, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,'live',$7,$8,$9,$10) ON CONFLICT (listing_id) DO NOTHING`,
        [l.listing, l.product, l.seller, l.pricePaise, l.costPaise, l.stock, l.cod, l.noCostEmi, PRODUCTS.find((p) => p.id === l.product)!.description, seq++],
      );
    }
    await client.query(
      `UPDATE listings SET deal_price_paise = 99900, deal_ends_at = $1 WHERE listing_id = 'L-1011'`,
      [new Date(seedTime.getTime() + 7 * 86400000)],
    );

    for (const u of SHOPPERS) {
      await client.query(
        `INSERT INTO shoppers (account_id, name, email, phone, password_hash, balance_paise, role) VALUES ($1,$2,$3,$4,$5,$6,'shopper')
         ON CONFLICT (account_id) DO NOTHING`,
        [u.id, u.name, u.email, u.phone, hashPassword(u.password), u.balance],
      );
    }
    await client.query(
      `INSERT INTO shoppers (account_id, name, email, phone, password_hash, balance_paise, role) VALUES ($1,$2,$3,$4,$5,0,'support')
       ON CONFLICT (account_id) DO NOTHING`,
      [SUPPORT.id, SUPPORT.name, SUPPORT.email, SUPPORT.phone, hashPassword(SUPPORT.password)],
    );

    for (const a of [...ASHA_ADDRESSES, ...RAVI_ADDRESSES, ...MEERA_ADDRESSES]) {
      await client.query(
        `INSERT INTO addresses (address_id, account_id, label, name, line1, line2, city, state, pincode, phone, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (address_id) DO NOTHING`,
        [a.id, a.id.startsWith("AD-ASHA") ? "U-ASHA" : a.id.startsWith("AD-RAVI") ? "U-RAVI" : "U-MEERA", a.label, a.name, a.line1, a.line2, a.city, a.state, a.pin, a.phone, seq++],
      );
    }
    await client.query(
      `INSERT INTO saved_cards (card_id, account_id, network, last4, expiry_month, expiry_year, name, created_seq)
       VALUES ('card-asha-1','U-ASHA','Visa','1111',12,2030,'Asha Verma',$1) ON CONFLICT (card_id) DO NOTHING`,
      [seq++],
    );
    await client.query(
      `INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id, created_seq) VALUES
       ($1,'U-ASHA','steel-tiffin-3','L-1001',$3), ($2,'U-ASHA','tara-smartwatch','L-1009',$4)`,
      [id("WI"), id("WI"), seq++, seq++],
    );
    for (const c of [
      { code: "CHAURAHA10", kind: "percent", value: 10, min: 99900, max: 50000, expires: null },
      { code: "FLAT150", kind: "flat", value: 15000, min: 100000, max: null, expires: null },
      { code: "DIWALI25", kind: "percent", value: 25, min: 0, max: null, expires: new Date(seedTime.getTime() - 86400000) },
    ]) {
      await client.query(
        `INSERT INTO coupons (code, kind, value, min_subtotal_paise, max_discount_paise, expires_at, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING`,
        [c.code, c.kind, c.value, c.min, c.max, c.expires, c.expires === null],
      );
    }
    for (const g of [
      { code: "CHGC-1000-AAAA", value: 100000 },
      { code: "CHGC-0250-BBBB", value: 25000 },
    ]) {
      await client.query(
        `INSERT INTO gift_cards (code, value_paise) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`,
        [g.code, g.value],
      );
    }
    for (const b of BANKS) {
      await client.query(
        `INSERT INTO seed_markers (name, value) VALUES ($1,$2) ON CONFLICT (name) DO NOTHING`,
        [`bank-${b.code}`, b.name],
      );
    }

    // Orders, shipments, settlement lines
    let orderSeq = 1;
    for (const o of ORDERS) {
      const listing = LISTINGS.find((l) => l.listing === o.listing)!;
      const product = PRODUCTS.find((p) => p.id === listing.product)!;
      const seller = SELLERS.find((s) => s.id === listing.seller)!;
      const address = [...ASHA_ADDRESSES, ...RAVI_ADDRESSES, ...MEERA_ADDRESSES].find((a) => a.id === o.addressId)!;
      const placedAt = new Date(seedTime.getTime() - o.daysAgo * 86400000);
      const deliveredOn = o.deliveredDaysAgo !== undefined ? addDays(today, -o.deliveredDaysAgo) : null;
      const promiseDate = addDays(today, -(o.daysAgo + 3));
      const intraState = seller.state === address.state;
      const lineTotal = o.amountPaise - 0;
      const taxable = Math.floor((lineTotal * 100) / (100 + product.rating * 0 + (product.category === "electronics" ? 18 : product.category === "kitchen" || product.category === "fashion" ? 5 : 40)));
      const tax = lineTotal - taxable;
      const sgst = intraState ? Math.floor(tax / 2) : 0;
      const cgst = intraState ? tax - sgst : 0;
      const igst = intraState ? 0 : tax;
      const category = CATEGORIES.find((c) => c.slug === product.category)!;
      const deliveryFee = o.amountPaise >= 49900 && o.method === "cod" ? 2500 : o.amountPaise >= 49900 ? 0 : 4000;
      const codFee = o.method === "cod" ? 2500 : 0;
      await client.query(
        `INSERT INTO orders (order_id, account_id, address_id, address_snapshot, placed_at, status, payable_paise, subtotal_paise,
          discount_paise, gift_wrap_paise, delivery_paise, cod_fee_paise, emi_discount_paise, balance_applied_paise, due_paise, pincode, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7,0,0,$8,$9,0,0,$7,$10,$11) ON CONFLICT (order_id) DO NOTHING`,
        [o.order, o.shopper, address.id, JSON.stringify(address), placedAt, o.state === "delivered" ? "delivered" : o.state, o.amountPaise, deliveryFee, codFee, address.pin, orderSeq++],
      );
      await client.query(
        `INSERT INTO shipments (shipment_id, order_id, seller_id, state, promise_date, speed, delivery_fee_paise, cod_fee_paise, gift_wrap_paise, delivered_on, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10) ON CONFLICT (shipment_id) DO NOTHING`,
        [o.shipment, o.order, seller.id, o.state, promiseDate, o.speed, deliveryFee, codFee, deliveredOn, orderSeq++],
      );
      for (const st of ["placed", "packed", "shipped", "delivered"]) {
        if (st === "delivered" && o.state !== "delivered") continue;
        if (st === "shipped" && o.state === "placed") continue;
        if (st === "packed" && o.state === "placed") continue;
        await client.query(
          `INSERT INTO shipment_timeline (shipment_id, state, at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [o.shipment, st, new Date(placedAt.getTime() + (st === "placed" ? 0 : 86400000))],
        );
      }
      const lineId = id("SL");
      await client.query(
        `INSERT INTO shipment_lines (line_id, shipment_id, listing_id, title, quantity, unit_price_paise, coupon_share_paise,
          line_total_paise, gst_rate, taxable_value_paise, cgst_paise, sgst_paise, igst_paise, returnable_until, created_seq)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [lineId, o.shipment, o.listing, product.title, o.qty, Math.floor(o.amountPaise / o.qty), lineTotal, category.gstRate, taxable, cgst, sgst, igst, deliveredOn ? addDays(deliveredOn, category.returnDays) : null, orderSeq++],
      );
      await client.query(
        `INSERT INTO payments (payment_id, order_id, method, status, expires_at, initiated_at)
         VALUES ($1,$2,$3,$4,NULL,$5) ON CONFLICT (payment_id) DO NOTHING`,
        [id("PAY"), o.order, o.method === "card" ? "card" : o.method, "confirmed", placedAt],
      );
      await client.query(
        `INSERT INTO payment_legs (leg_id, payment_id, method, amount_paise, status, kb_txn_key)
         VALUES ($1,(SELECT payment_id FROM payments WHERE order_id=$2),$3,$4,'pending',$5)`,
        [id("PL"), o.order, o.method, o.amountPaise, `${o.order}-leg`],
      );
      if (o.state === "delivered") {
        await client.query(
          `INSERT INTO settlements (settlement_line_id, shipment_id, shipment_line_id, seller_id, kind, posted_on,
            gross_paise, commission_percent, commission_paise, commission_gst_paise, tcs_paise, tds_paise, emi_subvention_paise, net_paise, status, quantity, line_quantity)
           VALUES ($1,$2,$3,$4,'sale',$5,$6,$7,$8,$9,$10,$11,0,$12,'payment_confirmed',$13,$13)`,
          [id("SET"), o.shipment, lineId, seller.id, addDays(today, -(o.deliveredDaysAgo ?? 0)), o.amountPaise, category.commission,
            Math.floor((o.amountPaise * category.commission) / 100 + 0.5), Math.floor((Math.floor((o.amountPaise * category.commission) / 100 + 0.5)) * 0.18 + 0.5),
            Math.floor((taxable * 0.005) + 0.5), Math.floor((o.amountPaise * 0.001) + 0.5),
            o.amountPaise - Math.floor((o.amountPaise * category.commission) / 100 + 0.5) - Math.floor((Math.floor((o.amountPaise * category.commission) / 100 + 0.5)) * 0.18 + 0.5) - Math.floor((taxable * 0.005) + 0.5) - Math.floor((o.amountPaise * 0.001) + 0.5),
            o.qty],
        );
      }
    }
    void KB_SPEC;

    await client.query(`INSERT INTO seed_markers (name, value) VALUES ('seeded', $1) ON CONFLICT (name) DO NOTHING`, [seedTime.toISOString()]);
    await client.query(`UPDATE health_state SET seeded_at = now() WHERE id = 1`);
  });
}
