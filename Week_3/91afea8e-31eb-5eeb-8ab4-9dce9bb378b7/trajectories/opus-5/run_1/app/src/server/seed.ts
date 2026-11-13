/** Schema and seed, applied idempotently on every serve. */

import { pool, query, transaction, withAdvisoryLock, type Tx } from './db.js';
import { SCHEMA_SQL } from './schema.js';
import { hashPassword } from './domain/identity.js';
import { standardDeliveryFee, COD_FEE_PAISE, taxSplit } from './domain/money.js';
import { saleSettlement } from './domain/settlement.js';
import { addDays, indiaDate } from './domain/time.js';
import {
  ASHA_CARD,
  ASHA_WISHLIST,
  CATEGORIES,
  COUPONS,
  DEAL_LISTING,
  GIFT_CARDS,
  LISTINGS,
  PINCODES,
  PRODUCTS,
  SEED_ORDERS,
  SELLERS,
  SHOPPERS,
  SUPPORT_AGENT,
} from './seedData.js';

const SCHEMA_LOCK = 710_001;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function schemaApplied(): Promise<boolean> {
  const result = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'settlement_lines') AS ok`,
  );
  return result.rows[0].ok;
}

export async function applySchemaAndSeed(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK, async () => {
    await applySchema();
    const rows = await query<{ count: number }>('SELECT count(*)::int AS count FROM accounts');
    if (rows[0].count > 0) return;
    await transaction(seedEverything);
  });
}

async function seedEverything(tx: Tx): Promise<void> {
  const today = indiaDate();

  for (const [index, category] of CATEGORIES.entries()) {
    await tx.query(
      `INSERT INTO categories (slug, name, gst_rate, commission_percent, return_days, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (slug) DO NOTHING`,
      [category.slug, category.name, category.gst, category.commission, category.returnDays, index],
    );
  }

  for (const pincode of PINCODES) {
    await tx.query(
      `INSERT INTO pincodes (pincode, city, state, serviceable, cod, remote)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (pincode) DO NOTHING`,
      [pincode.pincode, pincode.city, pincode.state, pincode.serviceable, pincode.cod, pincode.remote],
    );
  }

  for (const seller of SELLERS) {
    await tx.query(
      `INSERT INTO accounts (id, role, name, email, phone, password_hash, balance_paise)
       VALUES ($1, 'seller', $2, $3, $4, $5, 0)`,
      [seller.accountId, seller.name, seller.email, seller.phone, hashPassword(seller.password)],
    );
    await tx.query(
      `INSERT INTO sellers (id, account_id, display_name, legal_name, gstin, pickup_pincode,
                            pickup_city, pickup_state, dispatch_days, rating, cod_allowed, ship_states)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        seller.id,
        seller.accountId,
        seller.name,
        seller.legalName,
        seller.gstin,
        seller.pickupPincode,
        seller.pickupCity,
        seller.pickupState,
        seller.dispatchDays,
        seller.rating,
        seller.cod,
        seller.shipStates,
      ],
    );
  }

  for (const shopper of SHOPPERS) {
    await tx.query(
      `INSERT INTO accounts (id, role, name, email, phone, password_hash, balance_paise)
       VALUES ($1, 'shopper', $2, $3, $4, $5, $6)`,
      [
        shopper.id,
        shopper.name,
        shopper.email,
        shopper.phone,
        hashPassword(shopper.password),
        shopper.balance,
      ],
    );
    for (const address of shopper.addresses) {
      const pincode = PINCODES.find((entry) => entry.pincode === address.pincode);
      await tx.query(
        `INSERT INTO addresses (id, account_id, label, name, line1, line2, city, pincode, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          address.id,
          shopper.id,
          address.label,
          shopper.name,
          address.line1,
          address.line2,
          pincode?.city ?? address.city,
          address.pincode,
          shopper.phone,
        ],
      );
    }
    await tx.query(`INSERT INTO cart_state (account_id) VALUES ($1)`, [shopper.id]);
  }

  await tx.query(
    `INSERT INTO accounts (id, role, name, email, phone, password_hash, balance_paise)
     VALUES ($1, 'support', $2, $3, $4, $5, 0)`,
    [
      SUPPORT_AGENT.id,
      SUPPORT_AGENT.name,
      SUPPORT_AGENT.email,
      SUPPORT_AGENT.phone,
      hashPassword(SUPPORT_AGENT.password),
    ],
  );

  await tx.query(
    `INSERT INTO cards (card_id, account_id, network, last4, expiry_month, expiry_year, name)
     VALUES ($1, 'U-ASHA', $2, $3, $4, $5, $6)`,
    [
      ASHA_CARD.cardId,
      ASHA_CARD.network,
      ASHA_CARD.last4,
      ASHA_CARD.expiryMonth,
      ASHA_CARD.expiryYear,
      ASHA_CARD.name,
    ],
  );

  for (const product of PRODUCTS) {
    await tx.query(
      `INSERT INTO products (id, title, brand, category_slug, rating, description, specs)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        product.id,
        product.title,
        product.brand,
        product.category,
        product.rating,
        product.description,
        JSON.stringify(product.specs),
      ],
    );
  }

  for (const listing of LISTINGS) {
    const product = PRODUCTS.find((entry) => entry.id === listing.product);
    await tx.query(
      `INSERT INTO listings (id, product_id, seller_id, price_paise, cost_price_paise, stock, status,
                             cod_allowed, no_cost_emi, description, return_note)
       VALUES ($1, $2, $3, $4, $5, $6, 'live', $7, $8, $9, $10)`,
      [
        listing.id,
        listing.product,
        listing.seller,
        listing.price,
        listing.cost,
        listing.stock,
        listing.cod,
        listing.noCostEmi,
        product?.description ?? '',
        'Returns accepted in the original packing.',
      ],
    );
  }

  await tx.query(
    `UPDATE listings SET deal_price_paise = $2, deal_ends_at = now() + ($3 || ' days')::interval
      WHERE id = $1`,
    [DEAL_LISTING.listing, DEAL_LISTING.dealPrice, String(DEAL_LISTING.endsInDays)],
  );

  for (const item of ASHA_WISHLIST) {
    await tx.query(
      `INSERT INTO wishlist_items (item_id, account_id, product_id, listing_id)
       VALUES ($1, 'U-ASHA', $2, $3)`,
      [`WL-${item.listing}`, item.product, item.listing],
    );
  }

  for (const coupon of COUPONS) {
    await tx.query(
      `INSERT INTO coupons (code, percent, max_discount_paise, flat_paise, min_subtotal_paise, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        coupon.code,
        coupon.percent,
        coupon.maxDiscount,
        coupon.flat,
        coupon.minSubtotal,
        coupon.expired ? new Date(Date.now() - 86_400_000).toISOString() : null,
      ],
    );
  }

  for (const giftCard of GIFT_CARDS) {
    await tx.query(`INSERT INTO gift_cards (code, amount_paise) VALUES ($1, $2)`, [
      giftCard.code,
      giftCard.amount,
    ]);
  }

  for (const seed of SEED_ORDERS) {
    const listing = LISTINGS.find((entry) => entry.id === seed.listing);
    if (listing === undefined) continue;
    const product = PRODUCTS.find((entry) => entry.id === listing.product);
    if (product === undefined) continue;
    const seller = SELLERS.find((entry) => entry.id === listing.seller);
    if (seller === undefined) continue;
    const category = CATEGORIES.find((entry) => entry.slug === product.category);
    if (category === undefined) continue;
    const shopper = SHOPPERS.find((entry) => entry.id === seed.shopper);
    if (shopper === undefined) continue;
    const address = shopper.addresses[0];
    const destination = PINCODES.find((entry) => entry.pincode === address.pincode);
    if (destination === undefined) continue;

    const lineSubtotal = listing.price * seed.quantity;
    const lineTotal = lineSubtotal;
    const intraState = destination.state === seller.pickupState;
    const split = taxSplit(lineTotal, category.gst, intraState);
    const deliveryFee = standardDeliveryFee(lineSubtotal);
    const codFee = seed.method === 'cod' ? COD_FEE_PAISE : 0;
    const payable = lineTotal + deliveryFee + codFee;
    const deliveredOn = seed.deliveredDaysAgo === null ? null : addDays(today, -seed.deliveredDaysAgo);
    const placedAtDays = seed.deliveredDaysAgo === null ? 1 : seed.deliveredDaysAgo + 3;
    const promiseDate =
      deliveredOn ??
      addDays(
        today,
        seller.dispatchDays +
          (destination.city === seller.pickupCity ? 1 : destination.state === seller.pickupState ? 2 : 4) +
          (destination.remote ? 2 : 0),
      );

    await tx.query(
      `INSERT INTO orders (id, account_id, placed_at, payable_paise, status, address)
       VALUES ($1, $2, now() - ($3 || ' days')::interval, $4, $5, $6::jsonb)`,
      [
        seed.orderId,
        shopper.id,
        String(placedAtDays),
        payable,
        'placed',
        JSON.stringify({
          id: address.id,
          label: address.label,
          name: shopper.name,
          line1: address.line1,
          line2: address.line2,
          city: destination.city,
          pincode: address.pincode,
          phone: shopper.phone,
        }),
      ],
    );

    const paymentId = `PAY-${seed.orderId}`;
    await tx.query(
      `INSERT INTO payments (payment_id, order_id, account_id, method, status, initiated_at)
       VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)`,
      [
        paymentId,
        seed.orderId,
        shopper.id,
        seed.method,
        seed.method === 'cod' ? 'pending' : 'confirmed',
        String(placedAtDays),
      ],
    );

    await tx.query(
      `INSERT INTO shipments (id, order_id, seller_id, account_id, state, promise_date, speed,
                              delivery_fee_paise, cod_fee_paise, gift_wrap_paise, payment_kind, delivered_on)
       VALUES ($1, $2, $3, $4, $5, $6, 'standard', $7, $8, 0, $9, $10)`,
      [
        seed.shipmentId,
        seed.orderId,
        seller.id,
        shopper.id,
        seed.state,
        promiseDate,
        deliveryFee,
        codFee,
        seed.method === 'cod' ? 'cod' : 'prepaid',
        deliveredOn,
      ],
    );

    const legId = `LEG-${seed.orderId}`;
    await tx.query(
      `INSERT INTO payment_legs (leg_id, payment_id, order_id, shipment_id, method, amount_paise, status,
                                 external_key, card_last4, card_network)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        legId,
        paymentId,
        seed.orderId,
        seed.method === 'cod' ? seed.shipmentId : null,
        seed.method,
        payable,
        seed.method === 'cod' ? 'pending' : 'confirmed',
        seed.method === 'cod'
          ? `${seed.orderId}-cod-${seed.shipmentId}`
          : `${seed.orderId}-${seed.method}`,
        seed.method === 'card' ? ASHA_CARD.last4 : null,
        seed.method === 'card' ? ASHA_CARD.network : null,
      ],
    );

    const lineId = `SL-${seed.shipmentId}`;
    await tx.query(
      `INSERT INTO shipment_lines (line_id, shipment_id, listing_id, title, quantity, unit_price_paise,
                                   coupon_share_paise, line_total_paise, gst_rate, taxable_value_paise,
                                   cgst_paise, sgst_paise, igst_paise)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12)`,
      [
        lineId,
        seed.shipmentId,
        listing.id,
        product.title,
        seed.quantity,
        listing.price,
        lineTotal,
        category.gst,
        split.taxable_value_paise,
        split.cgst_paise,
        split.sgst_paise,
        split.igst_paise,
      ],
    );

    const timeline: { state: string; daysAgo: number }[] = [{ state: 'placed', daysAgo: placedAtDays }];
    if (seed.state === 'shipped' || seed.state === 'delivered') {
      timeline.push({ state: 'packed', daysAgo: Math.max(0, placedAtDays - 1) });
      timeline.push({ state: 'shipped', daysAgo: Math.max(0, placedAtDays - 2) });
    }
    if (seed.state === 'delivered' && seed.deliveredDaysAgo !== null) {
      timeline.push({ state: 'delivered', daysAgo: seed.deliveredDaysAgo });
    }
    for (const entry of timeline) {
      await tx.query(
        `INSERT INTO shipment_timeline (shipment_id, state, at)
         VALUES ($1, $2, now() - ($3 || ' days')::interval)`,
        [seed.shipmentId, entry.state, String(entry.daysAgo)],
      );
    }

    if (seed.state === 'delivered' && deliveredOn !== null) {
      const amounts = saleSettlement({
        grossPaise: lineSubtotal,
        gstRate: category.gst,
        commissionPercent: category.commission,
        emiSubventionPaise: 0,
      });
      await tx.query(
        `INSERT INTO settlement_lines (id, seller_id, shipment_id, line_id, kind, posted_on, gross_paise,
           commission_percent, commission_paise, commission_gst_paise, tcs_paise, tds_paise,
           emi_subvention_paise, net_paise)
         VALUES ($1, $2, $3, $4, 'sale', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          `SET-${seed.shipmentId}`,
          seller.id,
          seed.shipmentId,
          lineId,
          deliveredOn,
          amounts.gross_paise,
          amounts.commission_percent,
          amounts.commission_paise,
          amounts.commission_gst_paise,
          amounts.tcs_paise,
          amounts.tds_paise,
          amounts.emi_subvention_paise,
          amounts.net_paise,
        ],
      );
    }
  }
}
