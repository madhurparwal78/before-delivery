import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/server/errors.ts";
import { parseSeed } from "../src/server/admin/seed-parse.ts";

function refusal(body: unknown): ApiError {
  try {
    parseSeed(body, "");
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a refusal");
}

test("an empty body is a seed of nothing", () => {
  assert.deepEqual(parseSeed({}, ""), {
    users: undefined, groups: undefined, custom_roles: undefined, group_labels: undefined, epics: undefined, projects: undefined,
  });
});

test("absent lists, flags and nullable fields take their empty values", () => {
  const seed = parseSeed({
    projects: [{ key: "p", group: "acme", slug: "shop", visibility: "private", default_branch: "main", issues: [{ key: "i", title: "T", author: "ana" }] }],
  }, "");
  const issue = seed.projects?.[0]?.issues?.[0];
  assert.deepEqual(issue, {
    key: "i", title: "T", author: "ana", description: "", labels: [], assignees: [], milestone: null, weight: null, confidential: false, state: "opened",
  });
});

test("settings keep only what the body gives", () => {
  const seed = parseSeed({
    projects: [{ key: "p", group: "g", slug: "shop", visibility: "public", default_branch: "main", settings: { merge_method: "squash", merge_trains: true } }],
  }, "");
  assert.deepEqual(seed.projects?.[0]?.settings, { merge_method: "squash", merge_trains: true });
});

test("a wrong value is a 422 that names the field path", () => {
  const error = refusal({ groups: [{ key: "g", path: "acme", visibility: "secret" }] });
  assert.equal(error.status, 422);
  assert.deepEqual(error.details, { fields: { "groups.0.visibility": "visibility must be private, internal, public." } });
});

test("a missing required field and a wrong type are refused", () => {
  assert.deepEqual(refusal({ users: [{ password: "pass-1234" }] }).details, { fields: { "users.0.username": "username is required." } });
  assert.deepEqual(refusal({ users: "ana" }).details, { fields: { users: "users must be a list." } });
  assert.deepEqual(refusal({ projects: [{ key: "p", group: "g", slug: "s", visibility: "private", default_branch: "main", commits: [{ key: "c", branch: "main", as: "a", timestamp: -1, actions: [] }] }] }).details, {
    fields: { "projects.0.commits.0.timestamp": "timestamp must be a whole number from 0." },
  });
});
