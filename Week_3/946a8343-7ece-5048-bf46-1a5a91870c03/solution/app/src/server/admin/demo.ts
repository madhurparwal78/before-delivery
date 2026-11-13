// The demo instance an empty database gets on start (DP-09). It goes through the same seed as the grading route.
import { now } from "../clock.ts";
import { db, markDemoSettled, withAdvisoryLock, withTx } from "../db.ts";
import { storage } from "../s3.ts";
import { runSeed } from "./seed.ts";
import type { SeedRequest } from "./seed-spec.ts";

const DEMO_LOCK = 727002;
const DEMO_PASSWORD = "spurline-demo-1";
const SYSTEM_USER = "spurline-train";

const PIPELINE_CONFIG = `stages: [build, test, deploy]
build:
  stage: build
  script:
    - print Building tidepool
    - write dist/app.txt tidepool build
  artifacts:
    paths: [dist/app.txt]
test-unit:
  stage: test
  script:
    - print Running unit tests
deploy-production:
  stage: deploy
  script:
    - print Deploying tidepool
  environment:
    name: production
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
`;

const APP_SOURCE = 'export const name = "tidepool";\n';

const DEMO: SeedRequest = {
  users: [
    { username: "asha", password: DEMO_PASSWORD, time_zone: "Europe/Lisbon" },
    { username: "tomas", password: DEMO_PASSWORD, time_zone: "America/Bogota" },
    { username: "rin", password: DEMO_PASSWORD, time_zone: "Asia/Tokyo" },
    { username: "odile", password: DEMO_PASSWORD, time_zone: "UTC" },
  ],
  groups: [
    {
      key: "coldbrook",
      path: "coldbrook",
      visibility: "private",
      members: [
        { username: "asha", role: "owner" },
        { username: "tomas", role: "developer" },
        { username: "rin", role: "developer" },
        { username: "odile", role: "reporter" },
      ],
    },
    { key: "apps", path: "coldbrook/apps", visibility: "private", members: [{ username: "rin", role: "maintainer" }] },
  ],
  custom_roles: [
    { key: "release-captain", group: "coldbrook", name: "release-captain", base: "developer", permissions: ["approve", "manage_environments"] },
  ],
  group_labels: ["priority::high", "priority::low", "workflow::doing", "workflow::review", "type::bug"].map((name) => ({
    group: "coldbrook",
    name,
    description: "",
  })),
  projects: [
    {
      key: "tidepool",
      group: "coldbrook/apps",
      slug: "tidepool",
      visibility: "private",
      default_branch: "main",
      settings: {
        merge_method: "merge_commit",
        merge_trains: true,
        pipelines_must_succeed: true,
        reset_approvals_on_push: true,
        author_can_approve: false,
        auto_resolve_outdated: false,
      },
      protected_branches: [{ name: "main", allowed_to_push: "maintainer", allowed_to_merge: "developer" }],
      protected_tags: [{ name: "v*", allowed_to_create: "maintainer" }],
      push_rules: { branch_name: null, commit_message: null, forbidden_files: [], required_files: [], secrets: true },
      approval_rules: [{ name: "Backend", required: 1, users: ["rin", "asha"], groups: [] }],
      protected_environments: [{ name: "production", roles: "maintainer", approvals: 1 }],
      commits: [
        {
          key: "c1", branch: "main", start_ref: null, as: "asha", timestamp: 1767225600, message: "First commit",
          actions: [{ action: "create", path: "README.md", content: "hello\n" }],
        },
        {
          key: "c2", branch: "main", start_ref: null, as: "asha", timestamp: 1767229200, message: "Add pipeline and owners",
          actions: [
            { action: "create", path: "src/app.ts", content: APP_SOURCE },
            { action: "create", path: ".spurline/OWNERS", content: "[Backend]\n/src/ @rin\n[Docs]\n*.md @asha\n" },
            { action: "create", path: "spurline.pipeline.yml", content: PIPELINE_CONFIG },
          ],
        },
        {
          key: "c3", branch: "feat/export", start_ref: "main", as: "tomas", timestamp: 1767232800, message: "Add export button",
          actions: [{ action: "update", path: "src/app.ts", content: `${APP_SOURCE}export const canExport = true;\n` }],
        },
      ],
      tags: [{ name: "v0.1.0", commit: "c2", message: "First tagged build.", as: "asha" }],
      milestones: [{ key: "sprint-1", title: "Sprint 1", start: "2026-01-05", due: "2026-01-16", time_zone: "UTC" }],
      issues: [
        {
          key: "i1", title: "Export fails on large projects", author: "odile", description: "", labels: ["priority::high", "workflow::doing"],
          assignees: [], milestone: "sprint-1", weight: 3, confidential: false, state: "opened",
        },
        {
          key: "i2", title: "Tidy the README", author: "asha", description: "", labels: ["workflow::review"],
          assignees: [], milestone: null, weight: 1, confidential: false, state: "opened",
        },
      ],
      merge_requests: [
        {
          key: "mr1", title: "Add export button", source: "feat/export", target: "main", author: "tomas", description: "Closes #1",
          assignees: [], reviewers: ["rin"], delete_source_branch: true, state: "opened", approvals: [], threads: [],
        },
      ],
      pipelines: [{ key: "pl1", ref: "main", commit: "c2", jobs: { build: "success", "test-unit": "success", "deploy-production": "success" } }],
      boards: [{ key: "development", name: "Development", kind: "label", lists: ["workflow::doing", "workflow::review"] }],
      wiki: [{ slug: "home", title: "Home", content: "# Tidepool\n\nShared notes.", author: "asha" }],
    },
  ],
};

const RETRY_MS = 2000;
const DEMO_OWNER = "asha";

// True when nothing is left to do: the demo owner exists, or the demo was just created. The demo's build artifact counts
// as kept only once file storage confirms it, so an empty database waits for storage instead of seeding without it.
async function seedOnce(): Promise<boolean> {
  try {
    return await withAdvisoryLock(DEMO_LOCK, async () => {
      if ((await db.maybe("SELECT 1 FROM users WHERE username = $1", [DEMO_OWNER])) !== undefined) return true;
      if (!(await storage.reachable())) return false;
      await withTx(async (tx) => {
        await tx.q("INSERT INTO users (username, password, time_zone, created_at) VALUES ($1, NULL, 'UTC', $2) ON CONFLICT (username) DO NOTHING", [SYSTEM_USER, now()]);
        await runSeed(tx, DEMO);
      });
      return true;
    });
  } catch (error) {
    console.error("demo seed failed", error);
    return true;
  }
}

// Idempotent and advisory-locked, so two starting instances do not both seed.
export async function seedDemoInstance(): Promise<void> {
  if (await seedOnce()) {
    markDemoSettled();
    return;
  }
  const timer = setInterval(() => {
    void seedOnce().then((done) => {
      if (!done) return;
      clearInterval(timer);
      markDemoSettled();
    });
  }, RETRY_MS);
  timer.unref();
}
