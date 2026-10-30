import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { checkpointUploadDeadline } from './domain/expiry.js';
import { sha256Hex } from './services/storage.js';
import { attemptUpload } from './services/checkpointUpload.js';

const README = `# Tip Calculator

Split a bill and add a tip. Run the tests with \`node src/tip.test.js\`.
`;

const TIP_CURRENT = `export function tip(bill, percent) {
  return Math.round(bill * percent) / 100;
}
`;

const TIP_STARTER = `export function tip(bill, percent) {
  return 0;
}
`;

const TIP_TEST = `import { tip } from "./tip.js";

console.assert(tip(50, 20) === 10, "20% of 50 is 10");
`;

const INDEX_HTML = `<!doctype html>
<title>Tip Calculator</title>
<script type="module" src="src/tip.js"></script>
`;

const SAMPLE_FILES = [
  { path: 'README.md', content: README },
  { path: 'index.html', content: INDEX_HTML },
  { path: 'src/tip.js', content: TIP_CURRENT },
  { path: 'src/tip.test.js', content: TIP_TEST },
] as const;

const SAMPLE_PROJECT_TITLE = 'Sample: Tip Calculator';
const DEMO_LEARNER_NAME = 'Robin Vale';
const SAMPLE_SESSION_TITLE = 'Sample session';
const DAY_MS = 24 * 60 * 60 * 1000;

async function stageCheckpoint(
  client: PoolClient,
  input: {
    projectId: string;
    mentorId: string;
    mentorName: string;
    name: string;
    createdAt: Date;
    files: { fileId: string; path: string; content: string }[];
  },
): Promise<string> {
  const checkpointId = randomUUID();
  await client.query(
    `insert into checkpoints (id, project_id, name, state, created_by, created_by_name,
                              created_at, deadline_at)
     values ($1, $2, $3, 'pending_upload', $4, $5, $6, $7)`,
    [
      checkpointId,
      input.projectId,
      input.name,
      input.mentorId,
      input.mentorName,
      input.createdAt,
      checkpointUploadDeadline(input.createdAt),
    ],
  );
  for (const file of input.files) {
    const bytes = Buffer.from(file.content, 'utf8');
    await client.query(
      `insert into checkpoint_files (checkpoint_id, file_id, path, sha256, size, staged)
       values ($1, $2, $3, $4, $5, $6)`,
      [checkpointId, file.fileId, file.path, sha256Hex(bytes), bytes.length, bytes],
    );
  }
  return checkpointId;
}

/**
 * Builds the sample workspace a new mentor receives, in the same transaction as
 * their account. The two checkpoints are uploaded afterwards and follow the
 * checkpoint rules if storage is unreachable.
 */
export async function createSampleWorkspace(
  client: PoolClient,
  mentor: { id: string; name: string },
  signedInAt: Date,
): Promise<{ projectId: string; checkpointIds: string[] }> {
  const projectId = randomUUID();
  await client.query(
    `insert into projects (id, title, kind, owner_id) values ($1, $2, 'one_to_one', $3)`,
    [projectId, SAMPLE_PROJECT_TITLE, mentor.id],
  );
  await client.query(
    `insert into memberships (project_id, user_id, role, email_status)
     values ($1, $2, 'mentor', 'none')`,
    [projectId, mentor.id],
  );

  const demoLearnerId = randomUUID();
  await client.query(
    `insert into users (id, email, name, kind) values ($1, null, $2, 'learner')`,
    [demoLearnerId, DEMO_LEARNER_NAME],
  );
  await client.query(
    `insert into memberships (project_id, user_id, role, email_status)
     values ($1, $2, 'student', 'none')`,
    [projectId, demoLearnerId],
  );

  await client.query(
    `insert into project_sessions (id, project_id, title, state, scheduled_for, driver_id, version)
     values ($1, $2, $3, 'scheduled', $4, null, 0)`,
    [randomUUID(), projectId, SAMPLE_SESSION_TITLE, new Date(signedInAt.getTime() + DAY_MS)],
  );

  const created: { fileId: string; path: string; content: string }[] = [];
  for (const file of SAMPLE_FILES) {
    const fileId = randomUUID();
    created.push({ fileId, path: file.path, content: file.content });
    const bytes = Buffer.from(file.content, 'utf8');
    await client.query(
      `insert into files (id, project_id, path, content, revision, sha256, size)
       values ($1, $2, $3, $4, 1, $5, $6)`,
      [fileId, projectId, file.path, bytes, sha256Hex(bytes), bytes.length],
    );
  }

  const withContent = (overrides: Record<string, string>) =>
    created.map((file) => ({ ...file, content: overrides[file.path] ?? file.content }));

  const starterId = await stageCheckpoint(client, {
    projectId,
    mentorId: mentor.id,
    mentorName: mentor.name,
    name: 'Starter',
    createdAt: new Date(signedInAt.getTime() - 2000),
    files: withContent({ 'src/tip.js': TIP_STARTER }),
  });
  const minuteFortyId = await stageCheckpoint(client, {
    projectId,
    mentorId: mentor.id,
    mentorName: mentor.name,
    name: 'Minute 40',
    createdAt: new Date(signedInAt.getTime() - 1000),
    files: withContent({}),
  });

  return { projectId, checkpointIds: [starterId, minuteFortyId] };
}

export async function uploadSampleCheckpoints(checkpointIds: readonly string[]): Promise<void> {
  for (const id of checkpointIds) {
    await attemptUpload(id);
  }
}
