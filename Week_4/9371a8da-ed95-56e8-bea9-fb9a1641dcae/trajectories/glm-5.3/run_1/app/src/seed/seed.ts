import type { Queryable } from '../server/db.js';
import { hashPassword, newId, sha256Hex } from '../server/ids.js';
import { THESIS_FILES, ARTICLE_MAIN_TEX } from '../server/templates.js';

/** The seed, written only into an empty database. */

interface SeedUser {
  displayName: string;
  email: string;
  password: string;
  handle: string;
}

const USERS: SeedUser[] = [
  { displayName: 'Ilse Varga', email: 'ilse.varga@varga-lab.test', password: 'quill-owner-2026', handle: 'ilsevarga' },
  { displayName: 'Noor Haddad', email: 'noor.haddad@varga-lab.test', password: 'quill-student-2026', handle: 'noorhaddad' },
  { displayName: 'Kenji Arai', email: 'kenji.arai@partner-uni.test', password: 'quill-review-2026', handle: 'kenjiarai' },
  { displayName: 'Marta Osei', email: 'marta.osei@varga-lab.test', password: 'quill-viewer-2026', handle: 'martaosei' },
  { displayName: 'Sune Lindqvist', email: 'sune.lindqvist@lindqvist-lab.test', password: 'quill-other-2026', handle: 'sunelindqvist' },
  { displayName: 'Ada Moreau', email: 'ada.moreau@lindqvist-lab.test', password: 'quill-neighbour-2026', handle: 'adamoreau' },
];

const GRANT_MAIN_TEX = `\\documentclass[11pt]{article}\n\\usepackage{graphicx}\n\n\\title{Shared Margins: Review Infrastructure for Small Labs}\n\\author{Ilse Varga}\n\\date{}\n\n\\begin{document}\n\\maketitle\n\n\\section{Introduction}\nPrior pilots are reported in \\cite{varga2024pilot}.\n\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n`;

const GRANT_REFS_BIB = `@techreport{varga2023pilot,\n  author      = {Ilse Varga and Noor Haddad},\n  title       = {Pilot Study of Margin Review in Two Labs},\n  institution = {Varga Lab},\n  year        = {2023}\n}\n`;

export async function seed(sql: Queryable): Promise<void> {
  // The seed is written only into an empty database, and several instances may start together.
  const marker = await sql<{ t: string | null }>`SELECT to_regclass('public.workspaces') AS t`;
  if (!marker[0]?.t) return;
  const existing = await sql<{ n: number }>`SELECT count(*)::int AS n FROM users`;
  if (existing[0].n > 0) return;
  await sql.begin(async (tx) => {
    const again = await tx<{ n: number }>`SELECT count(*)::int AS n FROM users`;
    if (again[0].n > 0) return;

    const wsIds = { varga: newId('w'), lindqvist: newId('w') };
    await tx`INSERT INTO workspaces (id, name) VALUES (${wsIds.varga}, 'Varga Lab')`;
    await tx`INSERT INTO workspaces (id, name) VALUES (${wsIds.lindqvist}, 'Lindqvist Lab')`;

    const ids: Record<string, string> = {};
    for (const u of USERS) {
      const id = newId('u');
      ids[u.handle] = id;
      await tx`
        INSERT INTO users (id, email, email_lower, display_name, handle, password_hash)
        VALUES (${id}, ${u.email}, ${u.email.toLowerCase()}, ${u.displayName}, ${u.handle}, ${hashPassword(u.password)})`;
    }
    await tx`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${wsIds.varga}, ${ids.ilsevarga}, 'owner')`;
    await tx`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${wsIds.varga}, ${ids.noorhaddad}, 'member')`;
    await tx`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${wsIds.lindqvist}, ${ids.sunelindqvist}, 'owner')`;
    await tx`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${wsIds.lindqvist}, ${ids.adamoreau}, 'member')`;

    // ---- Project 1: Annotation Practice in Multilingual Labs ----
    const p1 = newId('p');
    await tx`INSERT INTO projects (id, workspace_id, title, template, revision) VALUES (${p1}, ${wsIds.varga}, 'Annotation Practice in Multilingual Labs', 'thesis-numbered', 1)`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p1}, ${ids.ilsevarga}, 'owner')`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p1}, ${ids.noorhaddad}, 'editor')`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p1}, ${ids.kenjiarai}, 'reviewer')`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p1}, ${ids.martaosei}, 'viewer')`;
    const p1Files: Record<string, string> = {};
    for (const [path, content] of Object.entries(THESIS_FILES)) p1Files[path] = content;
    await writeProjectFiles(tx, p1, p1Files, 1);
    await tx`
      INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
      VALUES (${p1}, 1, 'created', 'Created from template Thesis, numbered chapters', ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', now())`;

    // Seeded review, against file revision 1.
    const methodPath = 'chapters/03-method.tex';
    const methodFile = await tx`SELECT id FROM files WHERE project_id = ${p1} AND path = ${methodPath}`;
    const methodText = THESIS_FILES[methodPath];
    const anchor1 = methodText.indexOf('another lab');
    const anchor2 = methodText.indexOf('repeat it');
    await tx`
      INSERT INTO suggestions (id, project_id, file_id, from_pos, to_pos, deleted, inserted, status, author_id, author_name, author_handle, created_at)
      VALUES (${newId('s')}, ${p1}, ${methodFile[0].id}, ${anchor1}, ${anchor1 + 'another lab'.length}, 'another lab', 'an independent lab', 'open', ${ids.kenjiarai}, 'Kenji Arai', 'kenjiarai', now() - interval '2 days')`;
    await tx`
      INSERT INTO suggestions (id, project_id, file_id, from_pos, to_pos, deleted, inserted, status, author_id, author_name, author_handle, created_at)
      VALUES (${newId('s')}, ${p1}, ${methodFile[0].id}, ${anchor2}, ${anchor2 + 'repeat it'.length}, 'repeat it', 'reproduce it', 'open', ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', now() - interval '1 day')`;
    const introPath = 'chapters/01-introduction.tex';
    const introFile = await tx`SELECT id FROM files WHERE project_id = ${p1} AND path = ${introPath}`;
    const introText = THESIS_FILES[introPath];
    const q1 = introText.indexOf('State the research question here.');
    const tid = newId('t');
    await tx`
      INSERT INTO threads (id, project_id, file_id, from_pos, to_pos, quote, status, orphaned, created_at)
      VALUES (${tid}, ${p1}, ${introFile[0].id}, ${q1}, ${q1 + 'State the research question here.'.length}, 'State the research question here.', 'open', false, now() - interval '3 days')`;
    await tx`
      INSERT INTO comments (id, thread_id, author_id, author_name, author_handle, body, created_at)
      VALUES (${newId('c')}, ${tid}, ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', 'Lead with the question, then the gap. @noorhaddad', now() - interval '3 days')`;

    // ---- Project 2: Grant Proposal: Shared Margins ----
    const p2 = newId('p');
    await tx`INSERT INTO projects (id, workspace_id, title, template, revision) VALUES (${p2}, ${wsIds.varga}, 'Grant Proposal: Shared Margins', 'article-single', 3)`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p2}, ${ids.ilsevarga}, 'owner')`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p2}, ${ids.noorhaddad}, 'editor')`;
    await writeProjectFiles(tx, p2, { 'main.tex': ARTICLE_MAIN_TEX }, 1);
    await tx`
      INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
      VALUES (${p2}, 1, 'created', 'Created from template Article, single file', ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', now() - interval '10 days')`;
    // r2: file_create of refs.bib
    const refsId = newId('f');
    const refsBuf = Buffer.from(GRANT_REFS_BIB, 'utf8');
    await tx`
      INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
      VALUES (${refsId}, ${p2}, 'refs.bib', 'text', 1, ${refsBuf.length}, 'text/plain', ${sha256Hex(refsBuf)})`;
    await tx`
      INSERT INTO file_versions (file_id, revision, content, sha256)
      VALUES (${refsId}, 1, ${refsBuf}, ${sha256Hex(refsBuf)})`;
    await tx`
      INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
      VALUES (${p2}, 2, 'file_create', 'Created refs.bib', ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', now() - interval '9 days')`;
    // r3: save of main.tex (file revision 2)
    const mainBuf = Buffer.from(GRANT_MAIN_TEX, 'utf8');
    const mainRow = await tx`SELECT id, revision FROM files WHERE project_id = ${p2} AND path = 'main.tex'`;
    await tx`
      INSERT INTO file_versions (file_id, revision, content, sha256)
      VALUES (${mainRow[0].id}, 2, ${mainBuf}, ${sha256Hex(mainBuf)})`;
    await tx`UPDATE files SET revision = 2, size = ${mainBuf.length} WHERE id = ${mainRow[0].id}`;
    await tx`
      INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
      VALUES (${p2}, 3, 'save', 'Saved main.tex', ${ids.ilsevarga}, 'Ilse Varga', 'ilsevarga', now() - interval '8 days')`;
    // File set snapshots at each revision.
    await snapshotProjectRevision(tx, p2, 2);
    await snapshotProjectRevision(tx, p2, 3);

    // ---- Project 3: Sediment Transport in Braided Rivers ----
    const p3 = newId('p');
    await tx`INSERT INTO projects (id, workspace_id, title, template, revision) VALUES (${p3}, ${wsIds.lindqvist}, 'Sediment Transport in Braided Rivers', 'thesis-numbered', 1)`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p3}, ${ids.sunelindqvist}, 'owner')`;
    await tx`INSERT INTO memberships (project_id, user_id, role) VALUES (${p3}, ${ids.adamoreau}, 'editor')`;
    await writeProjectFiles(tx, p3, THESIS_FILES, 1);
    await tx`
      INSERT INTO ledger_entries (project_id, revision, kind, summary, actor_id, actor_name, actor_handle, at)
      VALUES (${p3}, 1, 'created', 'Created from template Thesis, numbered chapters', ${ids.sunelindqvist}, 'Sune Lindqvist', 'sunelindqvist', now())`;
  });
}

async function writeProjectFiles(
  tx: Queryable,
  projectId: string,
  files: Record<string, string>,
  revision: number,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const id = newId('f');
    const buf = Buffer.from(content, 'utf8');
    const sha = sha256Hex(buf);
    await tx`
      INSERT INTO files (id, project_id, path, kind, revision, size, content_type, sha256)
      VALUES (${id}, ${projectId}, ${path}, 'text', 1, ${buf.length}, 'text/plain', ${sha})`;
    await tx`
      INSERT INTO file_versions (file_id, revision, content, sha256)
      VALUES (${id}, 1, ${buf}, ${sha})`;
    await tx`
      INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
      VALUES (${projectId}, ${revision}, ${id}, ${path}, 'text', ${buf.length}, ${sha})`;
  }
}

async function snapshotProjectRevision(tx: Queryable, projectId: string, revision: number): Promise<void> {
  const files = await tx`
    SELECT id, path, kind, size, sha256 FROM files WHERE project_id = ${projectId} AND deleted_at IS NULL`;
  for (const f of files) {
    await tx`
      INSERT INTO project_revisions (project_id, revision, file_id, path, kind, size, sha256)
      VALUES (${projectId}, ${revision}, ${f.id}, ${f.path}, ${f.kind}, ${f.size}, ${f.sha256})`;
  }
}
