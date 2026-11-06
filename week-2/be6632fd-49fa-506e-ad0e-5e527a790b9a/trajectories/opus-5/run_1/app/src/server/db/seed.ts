import { danishSortKey } from '../../domain/danish.ts';
import { MARKETS, marketCurrency } from '../../domain/markets.ts';
import { parseInstant } from '../../domain/time.ts';
import { hashPassword, newClaimReference, newToken } from '../services/crypto.ts';
import { renderGarmentPng } from '../services/images.ts';
import { ensureBucket, lookObjectKey, putObject } from '../services/storage.ts';
import { pool, query, transact, withAdvisoryLock, type Transaction } from './pool.ts';
import { writeTiming } from '../repo/timing.ts';
import {
  DROPS,
  HARBOUR_REQUESTS,
  HARBOUR_STORY_HTML,
  HARBOUR_WAITLIST,
  MEMBERS,
  PRICE_LISTS,
  SEED_PASSWORD,
  STOCKISTS,
  WORKSPACES,
} from './seeddata.ts';

const SEED_LOCK = 0x484f_5553;
const IMAGE_STEP = 'look_images_v1';

const id = (...parts: readonly string[]): string => parts.join(':');

/** The shared go-live instant of a seeded drop, used as the base for its past timestamps. */
function seedBaseMs(key: string): number {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) % 1_000_000;
  return Date.UTC(2026, 0, 1) + hash * 1000;
}

export async function applySeed(): Promise<void> {
  await withAdvisoryLock(SEED_LOCK, async () => {
    await transact(async (tx) => {
      await seedWorkspaces(tx);
      await seedStockists(tx);
      await seedMembers(tx);
      await seedPriceLists(tx);
      await seedDrops(tx);
      await seedStory(tx);
      await seedWaitlist(tx);
      await seedRequests(tx);
    });
  });
}

async function seedWorkspaces(tx: Transaction): Promise<void> {
  for (const workspace of WORKSPACES) {
    await tx.query(
      `insert into workspaces (id, name) values ($1, $2) on conflict (id) do nothing`,
      [id('ws', workspace.key), workspace.name],
    );
  }
}

async function seedStockists(tx: Transaction): Promise<void> {
  for (const stockist of STOCKISTS) {
    await tx.query(
      `insert into stockists (id, workspace_id, name, sort_key, market, currency,
                              contact_name, contact_email, contact_phone, notes, status, created_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11)
       on conflict (id) do update set sort_key = excluded.sort_key`,
      [
        id('stk', stockist.key),
        id('ws', stockist.workspace),
        stockist.name,
        danishSortKey(stockist.name),
        stockist.market,
        marketCurrency(stockist.market),
        stockist.contactName,
        stockist.contactEmail,
        stockist.contactPhone,
        stockist.notes,
        seedBaseMs(stockist.key),
      ],
    );
  }
}

async function seedMembers(tx: Transaction): Promise<void> {
  const passwordHash = hashPassword(SEED_PASSWORD);
  for (const member of MEMBERS) {
    await tx.query(
      `insert into members (id, workspace_id, name, email, role, stockist_id, password_hash, created_at_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do nothing`,
      [
        id('mem', member.email),
        id('ws', member.workspace),
        member.name,
        member.email,
        member.role,
        member.stockist === undefined ? null : id('stk', member.stockist),
        passwordHash,
        seedBaseMs(member.email),
      ],
    );
  }
}

async function seedPriceLists(tx: Transaction): Promise<void> {
  for (const [index, list] of PRICE_LISTS.entries()) {
    const listId = id('pl', list.key);
    await tx.query(
      `insert into price_lists (id, workspace_id, name, effective_date, created_at_ms)
       values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
      [listId, id('ws', list.workspace), list.name, list.effectiveDate, Date.UTC(2025, 11, 1) + index * 1000],
    );
    for (const [styleNumber, currency, unitPriceMinor] of list.prices) {
      await tx.query(
        `insert into price_list_prices (price_list_id, style_number, currency, unit_price_minor)
         values ($1,$2,$3,$4) on conflict do nothing`,
        [listId, styleNumber, currency, unitPriceMinor],
      );
    }
  }
}

async function seedDrops(tx: Transaction): Promise<void> {
  let shopperNumber = 1;
  for (const drop of DROPS) {
    const dropId = id('drop', drop.key);
    const createdAtMs = seedBaseMs(drop.key);
    const inserted = await tx.query(
      `insert into drops (id, workspace_id, slug, name, type, status, hold_seconds, palette,
                          internal_note, created_at_ms, withdrawn_at_ms, withdraw_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       on conflict (id) do nothing
       returning id`,
      [
        dropId,
        id('ws', drop.workspace),
        drop.slug,
        drop.name,
        drop.type,
        drop.status,
        drop.holdSeconds,
        drop.palette,
        drop.internalNote,
        createdAtMs,
        drop.status === 'withdrawn' ? createdAtMs + 86_400_000 : null,
        drop.status === 'withdrawn' ? 'Supplier delay at the kiln.' : null,
      ],
    );
    if (inserted.length === 0) {
      shopperNumber += drop.claims.reduce((sum, [, count]) => sum + count, 0);
      continue;
    }

    for (const market of MARKETS) {
      await tx.query(
        `insert into drop_markets (drop_id, market, store_pieces) values ($1,$2,$3)
         on conflict do nothing`,
        [dropId, market, drop.storePieces],
      );
    }
    for (const [position, style] of drop.styles.entries()) {
      await tx.query(
        `insert into drop_styles (drop_id, style_number, name, colour, wholesale_edition, rrp_dkk_minor, position)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`,
        [dropId, style.styleNumber, style.name, style.colour, style.wholesaleEdition, style.rrpDkkMinor, position],
      );
    }
    await writeTiming(tx, dropId, {
      type: drop.type,
      goLiveAtMs: drop.goLiveAt === null ? null : parseInstant(drop.goLiveAt),
      copenhagenGoLive: null,
      localGoLive: drop.localGoLive,
    });

    for (const [position, look] of drop.looks.entries()) {
      await tx.query(
        `insert into looks (id, drop_id, position, title, alt_text, width, height, content_type, size_bytes, object_key, created_at_ms)
         values ($1,$2,$3,$4,$5,0,0,'image/png',0,$6,$7) on conflict (id) do nothing`,
        [
          id('look', drop.key, String(position)),
          dropId,
          position,
          look.title,
          look.altText,
          lookObjectKey(dropId, id('look', drop.key, String(position)), 'png'),
          createdAtMs + position,
        ],
      );
    }
    await tx.query(
      `insert into look_orders (drop_id, order_version, saved_by, saved_at_ms)
       values ($1, 1, 'Jonas Berg', $2) on conflict (drop_id) do nothing`,
      [dropId, createdAtMs],
    );

    for (const [market, count] of drop.claims) {
      const opened = await tx.queryOne<{ go_live_at_ms: number | null }>(
        'select go_live_at_ms from drop_markets where drop_id = $1 and market = $2',
        [dropId, market],
      );
      const base = Number(opened?.go_live_at_ms ?? createdAtMs) + 60_000;
      for (let index = 0; index < count; index += 1) {
        const number = String(shopperNumber).padStart(2, '0');
        shopperNumber += 1;
        await tx.query(
          `insert into claims (id, drop_id, market, reference, name, email, claimed_at_ms)
           values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
          [
            id('claim', drop.key, market, String(index)),
            dropId,
            market,
            newClaimReference(),
            `Shopper ${number}`,
            `shopper${number}@example.com`,
            base + index * 1000,
          ],
        );
      }
    }
  }
}

async function seedStory(tx: Transaction): Promise<void> {
  const dropId = id('drop', 'harbour-wool-edit');
  const savedAtMs = seedBaseMs('harbour-wool-edit') + 3_600_000;
  await tx.query(
    `insert into stories (drop_id, html, version, saved_by, saved_at_ms, published_html, published_at_ms)
     values ($1,$2,2,'Amir Haddad',$3,$2,$3) on conflict (drop_id) do nothing`,
    [dropId, HARBOUR_STORY_HTML, savedAtMs],
  );
  for (const drop of DROPS) {
    if (drop.key === 'harbour-wool-edit') continue;
    await tx.query(
      `insert into stories (drop_id, html, version, saved_by, saved_at_ms)
       values ($1,'',1,'',$2) on conflict (drop_id) do nothing`,
      [id('drop', drop.key), seedBaseMs(drop.key)],
    );
  }
}

async function seedWaitlist(tx: Transaction): Promise<void> {
  const dropId = id('drop', 'harbour-wool-edit');
  const base = seedBaseMs('harbour-wool-edit') + 7_200_000;
  for (const [index, member] of HARBOUR_WAITLIST.entries()) {
    const memberId = id('wl', 'harbour-wool-edit', member.email);
    const joinedAtMs = base + index * 60_000;
    await tx.query(
      `insert into waitlist_members (id, drop_id, market, name, email, status, joined_at_ms, position, confirmed_at_ms)
       values ($1,$2,$3,$4,$5,'confirmed',$6,$7,$6)
       on conflict (id) do nothing`,
      [memberId, dropId, member.market, member.name, member.email, joinedAtMs, index + 1],
    );
    await tx.query(
      `insert into opt_in_links (id, waitlist_member_id, token, issued_at_ms, expires_at_ms, used_at_ms)
       values ($1,$2,$3,$4,$5,$4) on conflict (id) do nothing`,
      [id('optin', memberId), memberId, newToken(), joinedAtMs, joinedAtMs + 86_400_000],
    );
  }
}

async function seedRequests(tx: Transaction): Promise<void> {
  const dropId = id('drop', 'harbour-wool-edit');
  const base = seedBaseMs('harbour-wool-edit') + 10_800_000;
  const drop = DROPS.find((entry) => entry.key === 'harbour-wool-edit');
  if (drop === undefined) return;

  for (const [index, request] of HARBOUR_REQUESTS.entries()) {
    const allocationId = id('alloc', 'harbour-wool-edit', request.stockist);
    const requestedAtMs = base + index * 3_600_000;
    const inserted = await tx.query(
      `insert into allocations (id, workspace_id, drop_id, stockist_id, status, version,
                                requested_at_ms, internal_note, saved_by, saved_at_ms)
       values ($1,$2,$3,$4,'requested',1,$5,'','Jonas Berg',$5)
       on conflict (id) do nothing returning id`,
      [allocationId, id('ws', 'maren-vale'), dropId, id('stk', request.stockist), requestedAtMs],
    );
    if (inserted.length === 0) continue;
    const quantities = new Map(request.lines.map(([styleNumber, quantity]) => [styleNumber, quantity]));
    for (const [position, style] of drop.styles.entries()) {
      await tx.query(
        `insert into allocation_lines (allocation_id, style_number, position, requested_quantity, allocated_quantity)
         values ($1,$2,$3,$4,0) on conflict do nothing`,
        [allocationId, style.styleNumber, position, quantities.get(style.styleNumber) ?? 0],
      );
    }
  }
}

interface LookImageRow {
  id: string;
  drop_id: string;
  position: number;
  object_key: string;
  palette: string[];
}

/**
 * Draws and stores each seeded look image. Runs again at each sweep while MinIO is unreachable,
 * and does nothing once every image is in place.
 */
export async function seedLookImages(): Promise<void> {
  const done = await query('select 1 from seed_steps where step = $1', [IMAGE_STEP]);
  if (done.length > 0) return;

  await ensureBucket();
  const looks = await query<LookImageRow>(
    `select l.id, l.drop_id, l.position, l.object_key, d.palette
       from looks l join drops d on d.id = l.drop_id
      where l.size_bytes = 0
      order by l.drop_id, l.position`,
  );
  for (const look of looks) {
    const image = renderGarmentPng(look.palette, look.position);
    await putObject(look.object_key, image.bytes, image.contentType);
    await pool.query(
      'update looks set width = $2, height = $3, size_bytes = $4 where id = $1',
      [look.id, image.width, image.height, image.bytes.length],
    );
  }
  await pool.query(
    'insert into seed_steps (step, done_at_ms) values ($1, $2) on conflict (step) do nothing',
    [IMAGE_STEP, Date.now()],
  );
}
