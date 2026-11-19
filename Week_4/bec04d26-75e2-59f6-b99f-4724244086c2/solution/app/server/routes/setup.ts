import type { Hono } from "hono";
import { pool, transaction } from "../db";
import { notFound } from "../http/errors";
import { type Env, authorize, reply } from "../http/context";
import { isRealDate } from "../../shared/calendar";
import type { Frequency } from "../../shared/types";
import { listClients, insertClient, registerInState, stateTaken } from "../store/clients";
import { createUser, emailTaken, getPractice } from "../store/practice";
import { loadViews, recalculate } from "../store/returns";
import { getStates, insertEdition, saveHolidays } from "../store/states";
import { publish } from "../services/hub";
import { dispatchMail } from "../services/outbox";
import { Check, MESSAGES, asObject, duplicate, editionFrom } from "../validation";

async function publishRecalculated(practiceId: string, ids: string[]): Promise<void> {
  const practice = await getPractice(pool, practiceId);
  for (const view of await loadViews(pool, practice, { ids })) {
    publish(practiceId, { type: "return", change: "recalculated", by: view.changed_by, return: view }, { clientId: view.client.id });
  }
  publish(practiceId, { type: "states" }, { bookkeeperOnly: true });
  publish(practiceId, { type: "lists" }, { bookkeeperOnly: true });
  for (const clientId of new Set((await loadViews(pool, practice, { ids })).map((v) => v.client.id))) {
    publish(practiceId, { type: "lists" }, { clientId });
  }
}

export function registerSetup(app: Hono<Env>): void {
  app.get("/api/states", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    return reply(await getStates(pool, account.practiceId));
  });

  app.put("/api/states/:code/holidays", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    const code = c.req.param("code");
    if (!(await getStates(pool, account.practiceId)).some((s) => s.code === code)) throw notFound();
    const holidays = asObject(c.get("body")).holidays;
    const check = new Check();
    if (!Array.isArray(holidays) || !holidays.every((d) => typeof d === "string" && isRealDate(d))) {
      check.fail("holidays", MESSAGES.holidays);
    }
    check.done();
    const moved = await transaction(async (db) => {
      await saveHolidays(db, account.practiceId, code, holidays as string[]);
      return (await recalculate(db, await getPractice(db, account.practiceId), code, account.displayName)).moved;
    });
    await publishRecalculated(account.practiceId, moved);
    return reply((await getStates(pool, account.practiceId)).find((s) => s.code === code));
  });

  app.post("/api/states/:code/editions", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    const code = c.req.param("code");
    const state = (await getStates(pool, account.practiceId)).find((s) => s.code === code);
    if (!state) throw notFound();
    const check = new Check();
    const edition = editionFrom(check, "", asObject(c.get("body")));
    if (!("effective_date" in check.errors) && state.editions.some((e) => e.effective_date === edition.effective_date)) {
      check.fail("effective_date", MESSAGES.effectiveDateTaken);
    }
    check.done();
    const matching = await transaction(async (db) => {
      await insertEdition(db, account.practiceId, code, edition);
      return recalculate(db, await getPractice(db, account.practiceId), code, account.displayName, edition.effective_date);
    }).catch(duplicate("effective_date", MESSAGES.effectiveDateTaken));
    await publishRecalculated(account.practiceId, matching.moved);
    return reply({ edition, recalculated: matching.matching }, 201);
  });

  app.get("/api/clients", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    return reply(await listClients(pool, account.practiceId));
  });

  app.post("/api/clients", async (c) => {
    const account = await authorize(c, { roles: ["bookkeeper"] });
    const body = asObject(c.get("body"));
    const owner = asObject(body.owner);
    const check = new Check();
    const name = check.displayName("name", body.name, MESSAGES.businessName);
    const ownerName = check.displayName("display_name", owner.display_name, MESSAGES.ownerName);
    const email = check.email("owner.email", owner.email);
    const password = check.password("owner.password", owner.password);
    if (!("owner.email" in check.errors) && (await emailTaken(pool, email))) check.fail("owner.email", MESSAGES.emailTaken);
    check.done();
    const id = await transaction(async (db) => {
      const clientId = await insertClient(db, account.practiceId, name);
      await createUser(db, { practiceId: account.practiceId, clientId, displayName: ownerName, email, password, role: "owner" });
      return clientId;
    }).catch(duplicate("owner.email", MESSAGES.emailTaken));
    publish(account.practiceId, { type: "clients" }, { bookkeeperOnly: true });
    return reply((await listClients(pool, account.practiceId)).find((client) => client.id === id), 201);
  });

  app.post("/api/clients/:id/registrations", async (c) => {
    const clientId = c.req.param("id");
    const account = await authorize(c, { roles: ["bookkeeper"], record: { id: clientId, table: "clients" } });
    const body = asObject(c.get("body"));
    const states = await getStates(pool, account.practiceId);
    const check = new Check();
    const state = states.find((s) => s.code === body.state);
    if (!state) check.fail("state", MESSAGES.state);
    else if (await stateTaken(pool, clientId, state.code)) check.fail("state", MESSAGES.stateTaken);
    const frequency: Frequency = check.frequency("frequency", body.frequency);
    const firstPeriod = check.firstPeriod("first_period", body.frequency, body.first_period);
    check.done();
    const practice = await getPractice(pool, account.practiceId);
    const created = await transaction((db) => registerInState(db, {
      practiceId: account.practiceId, clientId, state: state!, frequency, firstPeriod,
      reminderHour: practice.reminderHour, changedBy: account.displayName,
    })).catch(duplicate("state", MESSAGES.stateTaken));
    await dispatchMail(account.practiceId);
    const returns = await loadViews(pool, practice, { ids: Object.values(created.returnIds) });
    publish(account.practiceId, { type: "clients" }, { bookkeeperOnly: true });
    publish(account.practiceId, { type: "lists" }, { bookkeeperOnly: true });
    publish(account.practiceId, { type: "lists" }, { clientId });
    return reply({ registration: created.registration, returns }, 201);
  });
}
