import { db } from "../../db.js";
import { exerciseCostCents, formatCents, parseDecimal } from "../../domain/money.js";
import { cancelOrder, placeExercise, retryOrder } from "../../flows/exercise.js";
import { buildOrder, noticeStatusFor, ORDER_COLUMNS, type OrderRow } from "../../model/orders.js";
import { GRANT_COLUMNS, type GrantRow } from "../../model/grants.js";
import type { PersonRow } from "../../model/people.js";
import { conflict, forbidden, notFound, validation } from "../errors.js";
import { field, readCount, readText } from "../fields.js";
import { json, requirePerson, type Handler } from "../context.js";
import { route, type Route } from "../router.js";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

async function grantForHolder(id: string, person: PersonRow): Promise<GrantRow> {
  const row = await db.queryOne<GrantRow>(`select ${GRANT_COLUMNS} from grants where id = $1`, [id]);
  if (row === null) throw notFound();
  if (row.holder_id !== person.id && person.role !== "founder_admin") throw notFound();
  if (row.holder_id !== person.id) throw forbidden();
  return row;
}

const quote: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await grantForHolder(context.params["id"] ?? "", person);
  if (row.state !== "accepted" || row.strike === null) {
    throw conflict("grant_not_exercisable", "This grant can't be exercised.");
  }
  const options = readCount(field(context.body, "options"));
  if (options === null) throw validation({ options: "Enter a whole number of options." });
  const strike = parseDecimal(row.strike, 4);
  if (strike === null) throw conflict("grant_not_exercisable", "This grant can't be exercised.");
  return json({ options, strike: row.strike, cost: formatCents(exerciseCostCents(options, strike)) });
};

const placeOrder: Handler = async (context) => {
  const person = requirePerson(context);
  const grantId = context.params["id"] ?? "";
  await grantForHolder(grantId, person);
  const key = readText(context.headers["idempotency-key"]);
  if (key === null || !KEY_PATTERN.test(key)) {
    throw validation({ idempotency_key: "Send an Idempotency-Key of 8 to 64 letters, digits, hyphens or underscores." });
  }
  const options = readCount(field(context.body, "options"));
  if (options === null) throw validation({ options: "Enter a whole number of options." });
  const response = await placeExercise({
    holderId: person.id,
    grantId,
    options,
    idempotencyKey: key,
    now: context.now,
  });
  return { status: response.status, body: response.body };
};

const listOrders: Handler = async (context) => {
  const person = requirePerson(context);
  if (person.role === "investor" || person.role === "board_member") throw forbidden();
  const rows =
    person.role === "founder_admin"
      ? await db.query<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders order by seq desc`)
      : await db.query<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders where holder_id = $1 order by seq desc`, [
          person.id,
        ]);
  const orders = [];
  for (const row of rows) orders.push(buildOrder(row, await noticeStatusFor(db, row)));
  return json({ orders });
};

async function ownOrder(id: string, person: PersonRow): Promise<OrderRow> {
  const row = await db.queryOne<OrderRow>(`select ${ORDER_COLUMNS} from exercise_orders where id = $1`, [id]);
  if (row === null) throw notFound();
  if (row.holder_id !== person.id && person.role !== "founder_admin") throw notFound();
  return row;
}

const readOrder: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await ownOrder(context.params["id"] ?? "", person);
  return json(buildOrder(row, await noticeStatusFor(db, row)));
};

const retry: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await ownOrder(context.params["id"] ?? "", person);
  if (row.holder_id !== person.id) throw forbidden();
  return json(await retryOrder(row.id, context.now));
};

const cancel: Handler = async (context) => {
  const person = requirePerson(context);
  const row = await ownOrder(context.params["id"] ?? "", person);
  if (row.holder_id !== person.id) throw forbidden();
  const order = await cancelOrder(row.id, context.now);
  return json(order);
};

export const exerciseRoutes: Route[] = [
  route("POST", "/api/grants/:id/exercise-quote", quote),
  route("POST", "/api/grants/:id/exercises", placeOrder),
  route("GET", "/api/exercises", listOrders),
  route("GET", "/api/exercises/:id", readOrder),
  route("POST", "/api/exercises/:id/retry", retry),
  route("POST", "/api/exercises/:id/cancel", cancel),
];
