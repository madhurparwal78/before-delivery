// The public site's data: boards, portrait cards, profiles and photos. Only the published fields leave here.

import { one, pool, rows, type Db } from "../db.js";
import { publicRoute, json } from "../http.js";
import { FieldErrors, gone, notFound } from "../errors.js";
import { getObject } from "../storage.js";
import { BOARDS, type Board } from "./fees.js";
import { isBoard, measurementsBody, photoBody, portfolioOf, reachBody, type TalentRow } from "./talent.js";

const TITLES: Record<Board, string> = { women: "Women", men: "Men", creators: "Creators", new_faces: "New Faces" };
const PAGE_SIZE = 6;
const ACCENTED = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñÝýÿ";
const PLAIN = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyy";
const BY_NAME = `t.display_name COLLATE "und-x-icu", t.id`;
const SORTS: Record<string, string> = {
  name: BY_NAME,
  height: `t.height_cm DESC NULLS LAST, ${BY_NAME}`,
  reach: `coalesce(t.instagram, 0) + coalesce(t.tiktok, 0) + coalesce(t.youtube, 0) DESC, ${BY_NAME}`,
};

type CardRow = TalentRow & { cover_photo_id: string | null };

const CARD_SELECT = `SELECT t.*, (SELECT p.id FROM photos p WHERE p.talent_id = t.id ORDER BY p.position, p.id LIMIT 1)
  AS cover_photo_id FROM talent t`;

function cardBody(row: TalentRow, coverPhotoUrl: string | null) {
  return {
    slug: row.slug,
    displayName: row.display_name,
    office: row.office_id,
    board: row.board,
    measurements: measurementsBody(row),
    reach: reachBody(row),
    coverPhotoUrl,
  };
}

export async function profileBody(db: Db, row: TalentRow) {
  const portfolio = (await portfolioOf(db, row.id)).map(photoBody);
  return { ...cardBody(row, portfolio[0]?.url ?? null), portfolio };
}

function coverUrl(row: CardRow): string | null {
  return row.cover_photo_id ? `/api/photos/${row.cover_photo_id}` : null;
}

publicRoute("GET", "/api/public/boards", async () => {
  const counts = await rows<{ board: Board; count: number }>(
    pool, "SELECT board, count(*)::int AS count FROM talent WHERE state = 'active' GROUP BY board");
  const covers = await rows<{ board: Board; photo_id: string }>(
    pool,
    `SELECT DISTINCT ON (t.board) t.board, p.id AS photo_id FROM talent t JOIN photos p ON p.talent_id = t.id
      WHERE t.state = 'active' ORDER BY t.board, t.display_name COLLATE "und-x-icu", t.id, p.position`,
  );
  return json(200, {
    boards: BOARDS.map((board) => {
      const cover = covers.find((row) => row.board === board);
      return {
        board,
        title: TITLES[board],
        count: counts.find((row) => row.board === board)?.count ?? 0,
        coverPhotoUrl: cover ? `/api/photos/${cover.photo_id}` : null,
      };
    }),
  });
});

publicRoute("GET", "/api/public/talent", async (ctx) => {
  const board = ctx.query.get("board") ?? "";
  const office = ctx.query.get("office") || "all";
  const sort = ctx.query.get("sort") || "name";
  const page = Number(ctx.query.get("page") || 1);
  const q = (ctx.query.get("q") ?? "").trim();
  const errors: FieldErrors = new FieldErrors();
  if (!isBoard(board)) errors.add("board", "Choose Women, Men, Creators or New Faces.");
  if (!["all", "toronto", "vancouver"].includes(office)) errors.add("office", "Choose All offices, Toronto or Vancouver.");
  if (!(sort in SORTS)) errors.add("sort", "Choose Name, Height or Reach.");
  if (!Number.isInteger(page) || page < 1) errors.add("page", "Choose a page from 1.");
  errors.throwIfAny();
  const plainQuery = q.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const where = `WHERE t.state = 'active' AND t.board = $1 AND ($2 = 'all' OR t.office_id = $2)
    AND lower(translate(t.display_name, '${ACCENTED}', '${PLAIN}')) LIKE $3`;
  const params = [board, office, `%${plainQuery}%`];
  const total = (await one<{ count: number }>(pool, `SELECT count(*)::int AS count FROM talent t ${where}`, params))?.count ?? 0;
  const found = await rows<CardRow>(
    pool,
    `${CARD_SELECT} ${where} ORDER BY ${SORTS[sort]} LIMIT ${PAGE_SIZE} OFFSET $4`,
    [...params, (page - 1) * PAGE_SIZE],
  );
  return json(200, {
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    talent: found.map((row) => cardBody(row, coverUrl(row))),
  });
});

publicRoute("GET", "/api/public/talent/:slug", async (ctx) => {
  const row = await one<TalentRow>(pool, "SELECT * FROM talent WHERE slug = $1", [ctx.params.slug]);
  if (!row) throw notFound();
  if (row.state !== "active") throw gone("gone");
  return json(200, await profileBody(pool, row));
});

publicRoute("GET", "/api/photos/:photoId", async (ctx) => {
  const photo = await one<{ id: string; talent_id: string }>(
    pool,
    "SELECT p.id, p.talent_id FROM photos p JOIN talent t ON t.id = p.talent_id WHERE p.id = $1 AND t.state = 'active'",
    [ctx.params.photoId],
  );
  if (!photo) throw notFound();
  const data = await getObject(`portfolio/${photo.talent_id}/${photo.id}.jpg`);
  if (!data) throw notFound();
  return { status: 200, raw: data, contentType: "image/jpeg", headers: { "Cache-Control": "private, max-age=300" } };
});
