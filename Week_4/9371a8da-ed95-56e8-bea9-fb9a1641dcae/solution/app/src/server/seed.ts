// The seed data, written once into an empty database.
import type pg from "pg";
import type { Role } from "../shared/api.ts";
import { createUser, type UserRow } from "./auth.ts";
import { commitRevision, createProject, newId } from "./projects.ts";
import { templateById, type Template } from "./templates.ts";

const PEOPLE = [
  ["Ilse Varga", "ilse.varga@varga-lab.test", "quill-owner-2026"],
  ["Noor Haddad", "noor.haddad@varga-lab.test", "quill-student-2026"],
  ["Kenji Arai", "kenji.arai@partner-uni.test", "quill-review-2026"],
  ["Marta Osei", "marta.osei@varga-lab.test", "quill-viewer-2026"],
  ["Sune Lindqvist", "sune.lindqvist@lindqvist-lab.test", "quill-other-2026"],
  ["Ada Moreau", "ada.moreau@lindqvist-lab.test", "quill-neighbour-2026"],
] as const;

const GRANT_MAIN = String.raw`\documentclass[11pt]{article}
\usepackage{graphicx}

\title{Shared Margins: Review Infrastructure for Small Labs}
\author{Ilse Varga}
\date{}

\begin{document}
\maketitle

\section{Introduction}
Prior pilots are reported in \cite{varga2024pilot}.

\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`;

const GRANT_BIB = `@techreport{varga2023pilot,
  author      = {Ilse Varga and Noor Haddad},
  title       = {Pilot Study of Margin Review in Two Labs},
  institution = {Varga Lab},
  year        = {2023}
}
`;

function template(id: string): Template {
  const found = templateById(id);
  if (!found) throw new Error(`unknown template ${id}`);
  return found;
}

async function addMember(client: pg.PoolClient, projectId: string, user: UserRow, role: Role): Promise<void> {
  await client.query("INSERT INTO memberships (project_id, user_id, role) VALUES ($1, $2, $3)", [projectId, user.id, role]);
}

async function fileId(client: pg.PoolClient, projectId: string, path: string): Promise<string> {
  const row = await client.query<{ file_id: string }>(
    "SELECT file_id FROM tree WHERE project_id = $1 AND project_revision = 1 AND path = $2",
    [projectId, path],
  );
  return row.rows[0]?.file_id ?? "";
}

export async function seed(client: pg.PoolClient): Promise<void> {
  const people: Record<string, UserRow> = {};
  for (const [name, email, password] of PEOPLE) people[name] = await createUser(client, email, name, password);
  const person = (name: string): UserRow => people[name] as UserRow;
  const ilse = person("Ilse Varga");
  const noor = person("Noor Haddad");

  const varga = newId();
  const lindqvist = newId();
  await client.query("INSERT INTO workspaces (id, name) VALUES ($1, 'Varga Lab'), ($2, 'Lindqvist Lab')", [varga, lindqvist]);
  await client.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($4, $5, 'owner'), ($4, $6, 'member')`,
    [varga, ilse.id, noor.id, lindqvist, person("Sune Lindqvist").id, person("Ada Moreau").id],
  );

  const thesisTemplate = template("thesis-numbered");
  const thesis = await createProject(client, varga, "Annotation Practice in Multilingual Labs", thesisTemplate, ilse);
  await addMember(client, thesis, noor, "editor");
  await addMember(client, thesis, person("Kenji Arai"), "reviewer");
  await addMember(client, thesis, person("Marta Osei"), "viewer");
  const method = await fileId(client, thesis, "chapters/03-method.tex");
  const methodText = thesisTemplate.files["chapters/03-method.tex"] ?? "";
  const seeded: [UserRow, string, string][] = [
    [person("Kenji Arai"), "another lab", "an independent lab"],
    [ilse, "repeat it", "reproduce it"],
  ];
  for (const [author, deleted, inserted] of seeded) {
    const from = methodText.indexOf(deleted);
    await client.query(
      `INSERT INTO suggestions (id, project_id, file_id, from_pos, to_pos, deleted, inserted, status, author_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, now())`,
      [newId(), thesis, method, from, from + deleted.length, deleted, inserted, author.id],
    );
  }
  const introduction = await fileId(client, thesis, "chapters/01-introduction.tex");
  const quote = "State the research question here.";
  const at = (thesisTemplate.files["chapters/01-introduction.tex"] ?? "").indexOf(quote);
  const threadId = newId();
  await client.query(
    `INSERT INTO threads (id, project_id, file_id, from_pos, to_pos, quote, status, orphaned, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'open', false, now())`,
    [threadId, thesis, introduction, at, at + quote.length, quote],
  );
  await client.query("INSERT INTO comments (id, thread_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, now())", [
    newId(),
    threadId,
    ilse.id,
    "Lead with the question, then the gap. @noorhaddad",
  ]);

  const grant = await createProject(client, varga, "Grant Proposal: Shared Margins", template("article-single"), ilse);
  await addMember(client, grant, noor, "editor");
  const bib = newId();
  await client.query("INSERT INTO files (id, project_id, kind) VALUES ($1, $2, 'text')", [bib, grant]);
  await client.query("INSERT INTO text_revisions (file_id, revision, content) VALUES ($1, 1, $2)", [bib, GRANT_BIB]);
  await commitRevision(client, { id: grant, revision: 1 }, { kind: "file_create", summary: "Created refs.bib" }, ilse, [
    { kind: "add", fileId: bib, path: "refs.bib", textRevision: 1 },
  ]);
  await commitRevision(client, { id: grant, revision: 2 }, { kind: "save", summary: "Saved main.tex" }, ilse, [
    { kind: "text", fileId: await fileId(client, grant, "main.tex"), content: GRANT_MAIN },
  ]);

  const rivers = await createProject(client, lindqvist, "Sediment Transport in Braided Rivers", thesisTemplate, person("Sune Lindqvist"));
  await addMember(client, rivers, person("Ada Moreau"), "editor");
}
