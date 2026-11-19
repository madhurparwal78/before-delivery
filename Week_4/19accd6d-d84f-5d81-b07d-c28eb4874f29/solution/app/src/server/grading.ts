import type { Step } from "../shared/operations/types";
import { parseSteps } from "../shared/operations/validate";
import { settings } from "./config";
import { pool } from "./db";
import type { Db } from "./db";
import { notFound, storageUnavailable, validationFailed } from "./errors";
import { defineRoute, reply } from "./http";
import type { Route } from "./http";
import { hashPassword } from "./auth";
import { storeFile } from "./files";
import { closeAllSockets } from "./live";
import { outage } from "./outage";
import type { OutageService } from "./outage";
import { asRecord } from "../shared/records";
import { createRecipe, saveNextVersion } from "./recipes";
import type { RecipeContent, RecipeOwner } from "./recipes";
import { indexRecipes, SearchUnavailable } from "./search";
import { newId, openSession } from "./session";
import { confirmSnapshot, createSnapshot, snapshotStatus } from "./snapshots";
import { StorageUnavailable } from "./storage";
import { addMember, createTeam } from "./teams";
import { queryOne } from "./db";

const SEED_LIMIT = 10_000_000;
const SERVICES: readonly string[] = ["minio", "meilisearch", "live"];

interface SeedUser {
  key: string;
  email: string;
  password: string;
  displayName: string;
}

interface SeedVersion {
  author: string;
  name: string;
  note: string;
  steps: Step[];
}

interface SeedRecipe {
  key: string;
  owner: { user?: string; team?: string };
  tags: string[];
  versions: SeedVersion[];
}

interface SeedFile {
  key: string;
  owner: string;
  name: string;
  bytes: Buffer;
}

interface SeedSnapshot {
  key: string;
  owner: string;
  recipe: string;
  version: number;
  input: string | null;
  fileKey: string | null;
  output: Buffer;
  ttl: string;
  createdAt: Date;
}

interface SeedPlan {
  users: SeedUser[];
  teams: { key: string; name: string; owner: string; members: string[] }[];
  recipes: SeedRecipe[];
  files: SeedFile[];
  snapshots: SeedSnapshot[];
}

function list(raw: unknown): Record<string, unknown>[] {
  return Array.isArray(raw) ? raw.map(asRecord) : [];
}

function text(raw: unknown, field: string, fields: Record<string, string>): string {
  if (typeof raw === "string") return raw;
  fields[field] = `${field} is required.`;
  return "";
}

function parseSeed(raw: unknown): SeedPlan {
  const body = asRecord(raw);
  const fields: Record<string, string> = {};
  const plan: SeedPlan = {
    users: list(body.users).map((user, i) => ({
      key: text(user.key, `users.${i}.key`, fields), email: text(user.email, `users.${i}.email`, fields).toLowerCase(),
      password: text(user.password, `users.${i}.password`, fields), displayName: text(user.displayName, `users.${i}.displayName`, fields),
    })),
    teams: list(body.teams).map((team, i) => ({
      key: text(team.key, `teams.${i}.key`, fields), name: text(team.name, `teams.${i}.name`, fields),
      owner: text(team.owner, `teams.${i}.owner`, fields), members: Array.isArray(team.members) ? team.members.map(String) : [],
    })),
    recipes: list(body.recipes).map((recipe, i) => ({
      key: text(recipe.key, `recipes.${i}.key`, fields),
      owner: asRecord(recipe.owner),
      tags: Array.isArray(recipe.tags) ? recipe.tags.map(String) : [],
      versions: list(recipe.versions).map((version, j) => {
        const steps = parseSteps(version.steps);
        if ("problems" in steps) for (const problem of steps.problems) fields[`recipes.${i}.versions.${j}.${problem.path}`] = problem.message;
        return {
          author: text(version.author, `recipes.${i}.versions.${j}.author`, fields), name: text(version.name, `recipes.${i}.versions.${j}.name`, fields),
          note: typeof version.note === "string" ? version.note : "", steps: "steps" in steps ? steps.steps : [],
        };
      }),
    })) as SeedRecipe[],
    files: list(body.files).map((file, i) => ({
      key: text(file.key, `files.${i}.key`, fields), owner: text(file.owner, `files.${i}.owner`, fields),
      name: text(file.name, `files.${i}.name`, fields), bytes: Buffer.from(text(file.base64, `files.${i}.base64`, fields), "base64"),
    })),
    snapshots: list(body.snapshots).map((snapshot, i) => ({
      key: text(snapshot.key, `snapshots.${i}.key`, fields), owner: text(snapshot.owner, `snapshots.${i}.owner`, fields),
      recipe: text(snapshot.recipe, `snapshots.${i}.recipe`, fields), version: Number(snapshot.version),
      input: typeof snapshot.inputBase64 === "string" ? snapshot.inputBase64 : null,
      fileKey: typeof snapshot.fileKey === "string" ? snapshot.fileKey : null,
      output: Buffer.from(text(snapshot.outputBase64, `snapshots.${i}.outputBase64`, fields), "base64"),
      ttl: text(snapshot.ttl, `snapshots.${i}.ttl`, fields),
      createdAt: new Date(typeof snapshot.createdAt === "string" ? snapshot.createdAt : Date.now()),
    })),
  };
  if (Object.keys(fields).length) throw validationFailed(fields);
  return plan;
}

function keyed<T>(map: Map<string, T>, key: string): T {
  const found = map.get(key);
  if (found === undefined) throw validationFailed({ [key]: `${key} is not defined in this seed.` });
  return found;
}

async function seedUsers(db: Db, plan: SeedPlan): Promise<Map<string, { id: string; session: string }>> {
  const hashes = await Promise.all(plan.users.map((user) => hashPassword(user.password)));
  const users = new Map<string, { id: string; session: string }>();
  for (const [index, user] of plan.users.entries()) {
    const row = await queryOne<{ id: string }>(
      db,
      `INSERT INTO users (id, email, display_name, password_hash, verified) VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (lower(email)) DO UPDATE SET verified = true RETURNING id`,
      [newId("u"), user.email, user.displayName, hashes[index]],
    );
    const id = (row as { id: string }).id;
    users.set(user.key, { id, session: await openSession(db, id) });
  }
  return users;
}

/** Creates everything a grading call asks for in one transaction, then confirms objects and indexes recipes. */
async function seed(plan: SeedPlan): Promise<unknown> {
  const fileIds = new Map(plan.files.map((file) => [file.key, newId("f")]));
  const client = await pool.connect();
  const recipeIds: string[] = [];
  const response = { users: {} as Record<string, unknown>, teams: {} as Record<string, unknown>, recipes: {} as Record<string, unknown>, files: {} as Record<string, unknown>, snapshots: {} as Record<string, unknown> };
  const tokens: [string, string][] = [];
  try {
    const users = await seedUsers(pool, plan);
    await client.query("BEGIN");
    const teams = new Map<string, string>();
    for (const team of plan.teams) {
      const id = await createTeam(client, team.name, keyed(users, team.owner).id);
      for (const member of team.members) await addMember(client, id, keyed(users, member).id, "member");
      teams.set(team.key, id);
      response.teams[team.key] = { id };
    }
    const recipes = new Map<string, { id: string; latest: number }>();
    for (const recipe of plan.recipes) {
      const owner: RecipeOwner = recipe.owner.team
        ? { type: "team", id: keyed(teams, recipe.owner.team) }
        : { type: "user", id: keyed(users, recipe.owner.user as string).id };
      let id = "";
      let latest = 0;
      for (const version of recipe.versions) {
        const content: RecipeContent = { name: version.name, note: version.note, tags: recipe.tags, steps: version.steps };
        const author = keyed(users, version.author).id;
        if (latest === 0) id = await createRecipe(client, owner, content, author);
        else await saveNextVersion(client, id, latest, content, author);
        latest++;
      }
      recipes.set(recipe.key, { id, latest });
      recipeIds.push(id);
      response.recipes[recipe.key] = { id, latestVersion: latest };
    }
    for (const file of plan.files) {
      await storeFile(client, fileIds.get(file.key) as string, keyed(users, file.owner).id, file.name, file.bytes);
      response.files[file.key] = { id: fileIds.get(file.key) };
    }
    for (const snapshot of plan.snapshots) {
      const recipe = keyed(recipes, snapshot.recipe);
      const version = (await client.query<{ name: string; steps: Step[] }>(
        "SELECT name, steps FROM recipe_versions WHERE recipe_id = $1 AND n = $2", [recipe.id, snapshot.version],
      )).rows[0];
      if (!version) throw validationFailed({ [snapshot.key]: `${snapshot.recipe} has no version ${snapshot.version}.` });
      const input = snapshot.fileKey ? (plan.files.find((file) => file.key === snapshot.fileKey) as SeedFile).bytes : Buffer.from(snapshot.input ?? "", "base64");
      const token = await createSnapshot(client, {
        ownerId: keyed(users, snapshot.owner).id, recipeName: version.name, recipeVersion: snapshot.version,
        steps: version.steps, input, output: snapshot.output, ttl: snapshot.ttl, createdAt: snapshot.createdAt,
      });
      tokens.push([snapshot.key, token]);
    }
    await client.query("COMMIT");
    for (const [key, user] of users) response.users[key] = user;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error instanceof StorageUnavailable ? storageUnavailable() : error;
  } finally {
    client.release();
  }
  for (const [key, token] of tokens) {
    await confirmSnapshot(token);
    const row = await queryOne<{ revoked_at: Date | null; expires_at: Date; confirmed_at: Date | null }>(
      pool, "SELECT revoked_at, expires_at, confirmed_at FROM snapshots WHERE token = $1", [token],
    );
    const stored = row as { revoked_at: Date | null; expires_at: Date; confirmed_at: Date | null };
    response.snapshots[key] = { token, status: snapshotStatus(stored, new Date()), expiresAt: stored.expires_at.toISOString() };
  }
  await indexRecipes(recipeIds, true).catch((error: unknown) => {
    if (!(error instanceof SearchUnavailable)) throw error;
  });
  return response;
}

const unlessGrading = async (): Promise<undefined> => {
  if (!settings.grading) throw notFound();
  return undefined;
};

export const gradingRoutes: Route[] = [
  defineRoute<undefined, SeedPlan>({
    method: "POST", path: "/api/grading/seed", access: "public", body: "json", limit: () => SEED_LIMIT,
    resolve: unlessGrading,
    validate: parseSeed,
    run: async (_, __, plan) => reply(201, await seed(plan)),
  }),
  defineRoute<undefined, { service: OutageService; down: boolean }>({
    method: "POST", path: "/api/grading/outage", access: "public", body: "json",
    resolve: unlessGrading,
    validate: (body) => {
      const { service, down } = asRecord(body);
      if (typeof service !== "string" || !SERVICES.includes(service) || typeof down !== "boolean") {
        throw validationFailed({ service: `service must be one of ${SERVICES.join(", ")} and down true or false.` });
      }
      return { service: service as OutageService, down };
    },
    run: async (_, __, { service, down }) => {
      outage[service] = down;
      if (service === "live" && down) closeAllSockets();
      return reply(200, { service, down });
    },
  }),
];

