import type { PoolClient } from "pg";
import { pool, query } from "./db.js";
import { promiseDate, todayInIndia, type Destination } from "./domain/promise.js";
import { splitTax } from "./domain/tax.js";
import { hashPassword } from "./password.js";
import { postSales } from "./services/settlement.js";

const SEED_LOCK = 7_000_002;
const DAY_MS = 86_400_000;

const CATEGORIES = [
  ["kitchen", "Kitchen", 5, 10, 10],
  ["fashion", "Fashion", 5, 15, 7],
  ["electronics", "Electronics", 18, 7, 7],
  ["beverages", "Beverages", 40, 8, 0],
] as const;

const PINCODES = [
  ["110001", "New Delhi", "Delhi", true, true, false],
  ["400001", "Mumbai", "Maharashtra", true, true, false],
  ["411001", "Pune", "Maharashtra", true, true, false],
  ["560001", "Bengaluru", "Karnataka", true, true, false],
  ["560034", "Bengaluru", "Karnataka", true, true, false],
  ["380001", "Ahmedabad", "Gujarat", true, true, false],
  ["700001", "Kolkata", "West Bengal", true, true, false],
  ["194101", "Leh", "Ladakh", true, false, true],
  ["744101", "Port Blair", "Andaman and Nicobar Islands", false, false, false],
] as const;

const BANKS = [
  ["SAFB", "Saffron Bank"],
  ["NILB", "Nilgiri Bank"],
  ["DECB", "Deccan Cooperative Bank"],
  ["KONB", "Konkan Bank"],
] as const;

const ALL_STATES = ["Delhi", "Maharashtra", "Karnataka", "Gujarat", "West Bengal", "Ladakh"];

const SELLERS = [
  { id: "S-KAVERI", name: "Kaveri Handlooms", email: "kaveri@example.test", phone: "+919800000011", password: "Kaveri@Seller2026", pincode: "560001", city: "Bengaluru", state: "Karnataka", gstin: "29ABCDE1234F1Z5", dispatch: 1, rating: 4.6, cod: true, ships: ALL_STATES },
  { id: "S-GANGA", name: "Ganga Steelworks", email: "ganga@example.test", phone: "+919800000012", password: "Ganga@Seller2026", pincode: "110001", city: "New Delhi", state: "Delhi", gstin: "07ABCDE5678G1Z3", dispatch: 2, rating: 4.2, cod: true, ships: ALL_STATES },
  { id: "S-MARINE", name: "Marine Drive Gadgets", email: "marinedrive@example.test", phone: "+919800000013", password: "Marine@Seller2026", pincode: "400001", city: "Mumbai", state: "Maharashtra", gstin: "27ABCDE9012H1Z1", dispatch: 1, rating: 4.4, cod: false, ships: ["Maharashtra", "Karnataka", "Gujarat", "Delhi"] },
  { id: "S-SABAR", name: "Sabarmati Electronics", email: "sabarmati@example.test", phone: "+919800000014", password: "Sabarmati@Seller2026", pincode: "380001", city: "Ahmedabad", state: "Gujarat", gstin: "24ABCDE3456J1Z9", dispatch: 2, rating: 3.8, cod: true, ships: ALL_STATES.filter((state) => state !== "Ladakh") },
] as const;

const PRODUCTS = [
  { id: "steel-tiffin-3", title: "Steel Tiffin Stack, 3 tier", brand: "Dabba Co", category: "kitchen", rating: 4.5, description: "Three leak-proof stainless steel tiers on a single carry clip, sized for a full thali.", specs: { material: "Stainless steel 304", tiers: 3, capacity_ml: 1500 } },
  { id: "pressure-cooker-5l", title: "Pressure Cooker 5 L", brand: "Seeti", category: "kitchen", rating: 4.3, description: "Five litre aluminium pressure cooker with a gasket-release safety valve and a cool-touch handle.", specs: { material: "Aluminium", tiers: 1, capacity_ml: 5000 } },
  { id: "copper-bottle-1l", title: "Copper Water Bottle 1 L", brand: "Tamra", category: "kitchen", rating: 4.1, description: "A hammered copper bottle that holds one litre and keeps water cool through the afternoon.", specs: { material: "Copper", tiers: 1, capacity_ml: 1000 } },
  { id: "ilkal-saree", title: "Ilkal Handloom Saree", brand: "Kaveri Looms", category: "fashion", rating: 4.7, description: "A handwoven Ilkal saree with a traditional kondi border, woven in cotton and silk.", specs: { fabric: "Cotton silk", length_metres: 5.5, care: "Dry clean" } },
  { id: "cotton-kurta", title: "Block-print Cotton Kurta", brand: "Kaveri Looms", category: "fashion", rating: 4.2, description: "A relaxed cotton kurta with a hand block-printed yoke, cut for everyday wear.", specs: { fabric: "Cotton", length_metres: 1.1, care: "Machine wash cold" } },
  { id: "dhwani-speaker", title: "Dhwani Bluetooth Speaker", brand: "Dhwani", category: "electronics", rating: 4.4, description: "A portable Bluetooth speaker with a 360 degree driver and a splash-proof body.", specs: { battery_hours: 12, weight_grams: 540, warranty_months: 12, water_resistance: "IPX5" } },
  { id: "tara-smartwatch", title: "Tara Smartwatch", brand: "Tara", category: "electronics", rating: 4.0, description: "A smartwatch with heart-rate and sleep tracking, a bright always-on display and a week of battery.", specs: { battery_hours: 168, weight_grams: 42, warranty_months: 6, water_resistance: "IP68" } },
  { id: "lehar-earbuds", title: "Lehar Wireless Earbuds", brand: "Lehar", category: "electronics", rating: 3.9, description: "True wireless earbuds with a pocket charging case and touch controls.", specs: { battery_hours: 24, weight_grams: 55, warranty_months: 12, water_resistance: "IPX4" } },
  { id: "jugnu-powerbank", title: "Jugnu Power Bank 20000 mAh", brand: "Jugnu", category: "electronics", rating: 4.2, description: "A 20000 mAh power bank with two fast-charge ports and a digital charge readout.", specs: { battery_hours: 96, weight_grams: 430, warranty_months: 18, water_resistance: "None" } },
  { id: "pankha-desk-fan", title: "Pankha USB Desk Fan", brand: "Pankha", category: "electronics", rating: 3.7, description: "A quiet USB desk fan with three speeds and a tilting head.", specs: { battery_hours: 8, weight_grams: 310, warranty_months: 6, water_resistance: "None" } },
  { id: "jaljeera-fizz-24", title: "Jaljeera Fizz, crate of 24 cans", brand: "Fizzwala", category: "beverages", rating: 4.0, description: "A crate of twenty-four cans of sparkling jaljeera, tangy with cumin and mint.", specs: { flavour: "Jaljeera", cans: 24, can_ml: 250 } },
] as const;

// In the order listings were created before seed time.
const LISTINGS = [
  ["L-1001", "steel-tiffin-3", "S-GANGA", 64900, 25, 38000, true, false],
  ["L-1002", "steel-tiffin-3", "S-KAVERI", 69900, 10, 40000, true, false],
  ["L-1003", "pressure-cooker-5l", "S-GANGA", 189900, 12, 115000, true, false],
  ["L-1004", "copper-bottle-1l", "S-GANGA", 49900, 1, 26000, true, false],
  ["L-1005", "ilkal-saree", "S-KAVERI", 345000, 6, 210000, true, false],
  ["L-1006", "cotton-kurta", "S-KAVERI", 89900, 30, 45000, true, false],
  ["L-1007", "dhwani-speaker", "S-MARINE", 249900, 40, 170000, false, true],
  ["L-1008", "dhwani-speaker", "S-SABAR", 244900, 15, 165000, true, false],
  ["L-1009", "tara-smartwatch", "S-MARINE", 599900, 20, 410000, false, true],
  ["L-1014", "tara-smartwatch", "S-SABAR", 609900, 8, 420000, true, false],
  ["L-1010", "lehar-earbuds", "S-SABAR", 179900, 3, 110000, true, false],
  ["L-1011", "jugnu-powerbank", "S-SABAR", 129900, 50, 80000, true, false],
  ["L-1012", "pankha-desk-fan", "S-SABAR", 59900, 0, 33000, true, false],
  ["L-1013", "jaljeera-fizz-24", "S-GANGA", 96000, 40, 60000, true, false],
] as const;

const SHOPPERS = [
  { id: "U-ASHA", name: "Asha Verma", email: "asha@example.test", phone: "+919800000001", password: "Asha@Bazaar2026", balance: 50000 },
  { id: "U-RAVI", name: "Ravi Iyer", email: "ravi@example.test", phone: "+919800000002", password: "Ravi@Bazaar2026", balance: 0 },
  { id: "U-MEERA", name: "Meera Das", email: "meera@example.test", phone: "+919800000003", password: "Meera@Bazaar2026", balance: 0 },
] as const;

const ADDRESSES = [
  { id: "AD-ASHA-HOME", owner: "U-ASHA", label: "Home", line1: "A-12 Lakshmi Residency", line2: "5th Cross, Koramangala", city: "Bengaluru", pincode: "560034" },
  { id: "AD-ASHA-OFFICE", owner: "U-ASHA", label: "Office", line1: "4th Floor, Indigo Tech Park", line2: "", city: "Mumbai", pincode: "400001" },
  { id: "AD-RAVI-HOME", owner: "U-RAVI", label: "Home", line1: "Flat 7, Sagar Apartments", line2: "Marine Lines", city: "Mumbai", pincode: "400001" },
  { id: "AD-MEERA-HOME", owner: "U-MEERA", label: "Home", line1: "22 Park Lane", line2: "", city: "Kolkata", pincode: "700001" },
] as const;

interface SeededOrder {
  n: number;
  owner: (typeof SHOPPERS)[number]["id"];
  listing: string;
  quantity: number;
  payment: "card" | "upi" | "cod";
  state: "delivered" | "shipped" | "placed";
  daysAgo: number;
}

const ORDERS: readonly SeededOrder[] = [
  { n: 1, owner: "U-ASHA", listing: "L-1005", quantity: 1, payment: "card", state: "delivered", daysAgo: 2 },
  { n: 2, owner: "U-ASHA", listing: "L-1001", quantity: 2, payment: "upi", state: "delivered", daysAgo: 20 },
  { n: 3, owner: "U-ASHA", listing: "L-1007", quantity: 1, payment: "upi", state: "shipped", daysAgo: 1 },
  { n: 4, owner: "U-RAVI", listing: "L-1011", quantity: 1, payment: "cod", state: "placed", daysAgo: 0 },
  { n: 5, owner: "U-MEERA", listing: "L-1013", quantity: 1, payment: "cod", state: "placed", daysAgo: 0 },
  { n: 6, owner: "U-MEERA", listing: "L-1013", quantity: 1, payment: "cod", state: "placed", daysAgo: 0 },
  { n: 7, owner: "U-MEERA", listing: "L-1013", quantity: 1, payment: "cod", state: "placed", daysAgo: 0 },
];

async function seedOrder(client: PoolClient, order: SeededOrder, seedMs: number): Promise<void> {
  const listing = LISTINGS.find((row) => row[0] === order.listing) as (typeof LISTINGS)[number];
  const product = PRODUCTS.find((row) => row.id === listing[1]) as (typeof PRODUCTS)[number];
  const category = CATEGORIES.find((row) => row[0] === product.category) as (typeof CATEGORIES)[number];
  const seller = SELLERS.find((row) => row.id === listing[2]) as (typeof SELLERS)[number];
  const address = ADDRESSES.find((row) => row.owner === order.owner && row.label === "Home") as (typeof ADDRESSES)[number];
  const owner = SHOPPERS.find((row) => row.id === order.owner) as (typeof SHOPPERS)[number];
  const pin = PINCODES.find((row) => row[0] === address.pincode) as (typeof PINCODES)[number];
  const destination: Destination = { pincode: pin[0], city: pin[1], state: pin[2], serviceable: pin[3], codAvailable: pin[4], remote: pin[5] };
  const id = `CH-SEED000${order.n}`;
  const shipmentId = `SH-SEED000${order.n}`;
  const paymentId = `PAY-SEED000${order.n}`;
  const placedMs = seedMs - order.daysAgo * DAY_MS - (order.state === "delivered" ? 3 * DAY_MS : 0);
  const lineTotal = listing[3] * order.quantity;
  const codFee = order.payment === "cod" ? 2500 : 0;
  const payable = lineTotal + codFee;
  const tax = splitTax(lineTotal, category[2], seller.state === pin[2]);
  const promise = promiseDate(placedMs, { pickupCity: seller.city, pickupState: seller.state, dispatchDays: seller.dispatch, shipToStates: seller.ships }, destination, "standard");
  const addressJson = { id: address.id, name: owner.name, line1: address.line1, line2: address.line2, city: address.city, state: pin[2], pincode: address.pincode, phone: owner.phone };
  await client.query("INSERT INTO orders (id, account_id, address, payable_paise, placed_at, payment_id) VALUES ($1, $2, $3, $4, $5, $6)", [id, order.owner, JSON.stringify(addressJson), payable, placedMs, paymentId]);
  await client.query("INSERT INTO payments (id, order_id, method, status, initiated_at) VALUES ($1, $2, $3, 'confirmed', $4)", [paymentId, id, order.payment, placedMs]);
  await client.query(
    `INSERT INTO payment_legs (id, payment_id, order_id, shipment_id, method, amount_paise, status, kb_key, card_last4, card_network)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      `LG-SEED000${order.n}`, paymentId, id, order.payment === "cod" ? shipmentId : null, order.payment, payable, order.payment === "cod" ? "pending" : "confirmed",
      order.payment === "cod" ? `${id}-cod-${shipmentId}` : `${id}-${order.payment}`, order.payment === "card" ? "1111" : null, order.payment === "card" ? "Visa" : null,
    ],
  );
  const deliveredMs = seedMs - order.daysAgo * DAY_MS;
  await client.query(
    `INSERT INTO shipments (id, order_id, seller_id, state, promise_date, speed, delivery_fee_paise, cod_fee_paise, gift_wrap_paise, delivered_on)
     VALUES ($1, $2, $3, $4, $5, 'standard', 0, $6, 0, $7)`,
    [shipmentId, id, seller.id, order.state, promise, codFee, order.state === "delivered" ? todayInIndia(deliveredMs) : null],
  );
  const timeline: [string, number][] = [["placed", placedMs]];
  if (order.state !== "placed") timeline.push(["packed", placedMs + DAY_MS / 2], ["shipped", placedMs + DAY_MS]);
  if (order.state === "delivered") timeline.push(["delivered", deliveredMs]);
  for (const [state, at] of timeline) await client.query("INSERT INTO shipment_events (shipment_id, state, at) VALUES ($1, $2, $3)", [shipmentId, state, at]);
  await client.query(
    `INSERT INTO shipment_lines (id, shipment_id, listing_id, title, category, quantity, unit_price_paise, coupon_share_paise, line_total_paise, gst_rate,
        taxable_value_paise, cgst_paise, sgst_paise, igst_paise, commission_percent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, $14)`,
    [`SL-SEED000${order.n}`, shipmentId, listing[0], product.title, product.category, order.quantity, listing[3], lineTotal, category[2], tax.taxableValuePaise, tax.cgstPaise, tax.sgstPaise, tax.igstPaise, category[3]],
  );
  if (order.state === "delivered") await postSales(shipmentId, deliveredMs, client);
}

/** Seeds an empty database once; running it again after a restart changes nothing. */
export async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
    const existing = await query<{ n: number }>("SELECT count(*)::int AS n FROM accounts", [], client);
    if ((existing[0]?.n ?? 0) > 0) return;
    const seedMs = Date.now();
    await client.query("BEGIN");
    for (const [slug, name, gst, commission, days] of CATEGORIES) await client.query("INSERT INTO categories VALUES ($1, $2, $3, $4, $5)", [slug, name, gst, commission, days]);
    for (const row of PINCODES) await client.query("INSERT INTO pincodes VALUES ($1, $2, $3, $4, $5, $6)", [...row]);
    for (const [code, name] of BANKS) await client.query("INSERT INTO banks VALUES ($1, $2)", [code, name]);
    for (const s of SELLERS) {
      await client.query("INSERT INTO sellers (id, name, gstin, pickup_pincode, pickup_city, pickup_state, dispatch_days, rating, cod, ship_to_states) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
        s.id, s.name, s.gstin, s.pincode, s.city, s.state, s.dispatch, s.rating, s.cod, [...s.ships],
      ]);
      await client.query("INSERT INTO accounts (id, role, name, first_name, email, phone, password_hash, seller_id, created_at) VALUES ($1, 'seller', $2, $3, $4, $5, $6, $1, $7)", [
        s.id, s.name, s.name.split(" ")[0], s.email, s.phone, await hashPassword(s.password), seedMs,
      ]);
    }
    await client.query("INSERT INTO accounts (id, role, name, first_name, email, phone, password_hash, created_at) VALUES ('U-NIKHIL', 'support', 'Nikhil Rao', 'Nikhil', 'support@example.test', '+919800000021', $1, $2)", [
      await hashPassword("Support@Desk2026"), seedMs,
    ]);
    for (const p of PRODUCTS) await client.query("INSERT INTO products (id, title, brand, category, rating, description, specs) VALUES ($1, $2, $3, $4, $5, $6, $7)", [p.id, p.title, p.brand, p.category, p.rating, p.description, JSON.stringify(p.specs)]);
    for (const [id, productId, sellerId, price, stock, cost, cod, emi] of LISTINGS) {
      const deal = id === "L-1011";
      await client.query(
        `INSERT INTO listings (id, product_id, seller_id, price_paise, cost_price_paise, stock, status, description, cod_allowed, no_cost_emi, deal_price_paise, deal_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10, $11)`,
        [id, productId, sellerId, price, cost, stock, (PRODUCTS.find((p) => p.id === productId) as (typeof PRODUCTS)[number]).description, cod, emi, deal ? 99900 : null, deal ? seedMs + 7 * DAY_MS : null],
      );
    }
    for (const s of SHOPPERS) {
      await client.query("INSERT INTO accounts (id, role, name, first_name, email, phone, password_hash, balance_paise, created_at) VALUES ($1, 'shopper', $2, $3, $4, $5, $6, $7, $8)", [
        s.id, s.name, s.name.split(" ")[0], s.email, s.phone, await hashPassword(s.password), s.balance, seedMs,
      ]);
    }
    for (const a of ADDRESSES) {
      const owner = SHOPPERS.find((s) => s.id === a.owner) as (typeof SHOPPERS)[number];
      const pin = PINCODES.find((p) => p[0] === a.pincode) as (typeof PINCODES)[number];
      await client.query("INSERT INTO addresses (id, account_id, label, name, line1, line2, city, state, pincode, phone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [
        a.id, a.owner, a.label, owner.name, a.line1, a.line2, a.city, pin[2], a.pincode, owner.phone,
      ]);
    }
    await client.query("INSERT INTO cards (id, account_id, network, last4, expiry_month, expiry_year, name) VALUES ('card-asha-1', 'U-ASHA', 'Visa', '1111', 12, 2030, 'Asha Verma')");
    await client.query("INSERT INTO wishlist_items (id, account_id, product_id, listing_id) VALUES ('WI-ASHA-1', 'U-ASHA', 'steel-tiffin-3', 'L-1001'), ('WI-ASHA-2', 'U-ASHA', 'tara-smartwatch', 'L-1009')");
    await client.query("INSERT INTO coupons VALUES ('CHAURAHA10', 'percent', 10, 50000, 99900, false), ('FLAT150', 'flat', 15000, NULL, 100000, false), ('DIWALI25', 'percent', 25, NULL, 0, true)");
    await client.query("INSERT INTO gift_cards (code, amount_paise) VALUES ('CHGC-1000-AAAA', 100000), ('CHGC-0250-BBBB', 25000)");
    for (const order of ORDERS) await seedOrder(client, order, seedMs);
    await client.query("INSERT INTO search_outbox (listing_id, queued_at) SELECT id, $1 FROM listings", [seedMs]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]).catch(() => undefined);
    client.release();
  }
}
