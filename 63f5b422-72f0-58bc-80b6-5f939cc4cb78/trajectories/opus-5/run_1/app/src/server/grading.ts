import { isStyleKey, isValidStyleString } from '../shared/style.js';
import { cloneNode, emptyStyles } from '../shared/tree.js';
import { uniqueSlug } from '../shared/slug.js';
import type {
  Collection,
  Entry,
  NodeType,
  Page,
  PlinthDocument,
  PlinthNode,
  Props,
  SharedComponent,
  StyleMap,
  Styles,
  Token,
} from '../shared/types.js';
import { createAccount, findAccountByEmail } from './auth.js';
import { query } from './db.js';
import { invalidFields } from './errors.js';
import { newId } from './ids.js';
import { publishPage } from './publish.js';
import { loadDocument } from './workspaces.js';

interface SeedUser {
  email: string;
  name: string;
  password: string;
}

type SeedNode = {
  type: NodeType;
  name: string;
  props?: Props;
  styles?: Partial<Styles>;
  children?: SeedNode[];
  shared?: { component: string };
  bind?: Record<string, string>;
};

interface SeedPage {
  name: string;
  slug?: string;
  root?: SeedNode;
}

interface SeedDocument {
  name?: string;
  tokens?: Token[];
  pages?: SeedPage[];
  components?: { name: string; root: SeedNode }[];
  collection?: {
    name?: string;
    fields?: Collection['fields'];
    entries?: { values: Record<string, string> }[];
  };
}

interface SeedWorkspace {
  name: string;
  owner: string;
  members?: { email: string; role: 'editor' | 'viewer' }[];
  document?: SeedDocument;
  published?: string[];
}

function asArray<T>(value: unknown, path: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidFields({ [path]: 'Expected a list.' });
  return value as T[];
}

function seedStyles(given: Partial<Styles> | undefined, path: string): Styles {
  const styles = emptyStyles();
  if (!given) return styles;
  for (const bp of ['desktop', 'tablet', 'phone'] as const) {
    const map = given[bp];
    if (map === undefined) continue;
    for (const [key, value] of Object.entries(map as StyleMap)) {
      if (!isStyleKey(key)) throw invalidFields({ [`${path}.styles.${bp}.${key}`]: 'Unknown style key.' });
      if (typeof value === 'string' && !isValidStyleString(key, value)) {
        throw invalidFields({ [`${path}.styles.${bp}.${key}`]: 'That value is not valid.' });
      }
      styles[bp][key] = value as StyleMap[typeof key];
    }
  }
  return styles;
}

function buildNode(
  seed: SeedNode,
  components: Map<string, SharedComponent>,
  nodes: Record<string, string>,
  path: string,
): PlinthNode {
  if (typeof seed !== 'object' || seed === null) {
    throw invalidFields({ [path]: 'Expected a node.' });
  }
  const node: PlinthNode = {
    id: newId('n'),
    type: seed.type,
    name: seed.name,
    props: { ...(seed.props ?? {}) },
    styles: seedStyles(seed.styles, path),
    children: [],
  };
  if (seed.bind) node.bind = { ...seed.bind };
  nodes[seed.name] = node.id;
  if (seed.shared) {
    const component = components.get(seed.shared.component);
    if (!component) {
      throw invalidFields({ [`${path}.shared.component`]: 'Unknown component.' });
    }
    const instance = cloneNode(component.root, () => newId('n'));
    instance.name = seed.name;
    instance.shared = { componentId: component.id };
    nodes[seed.name] = instance.id;
    const record = (node: PlinthNode): void => {
      for (const child of node.children) {
        nodes[child.name] = child.id;
        record(child);
      }
    };
    record(instance);
    return instance;
  }
  node.children = (seed.children ?? []).map((child, i) =>
    buildNode(child, components, nodes, `${path}.children.${i}`),
  );
  return node;
}

function buildDocument(
  workspaceId: string,
  name: string,
  slug: string,
  seed: SeedDocument | undefined,
): { doc: PlinthDocument; pageNodes: Map<string, Record<string, string>>; components: Map<string, SharedComponent> } {
  const tokens = (seed?.tokens ?? [
    { name: 'ink', kind: 'color', value: 'black' },
    { name: 'paper', kind: 'color', value: 'white' },
    { name: 'space-md', kind: 'size', value: 16, unit: 'px' },
    { name: 'size-xl', kind: 'size', value: 40, unit: 'px' },
  ]) as Token[];
  const components = new Map<string, SharedComponent>();
  for (const [i, entry] of (seed?.components ?? []).entries()) {
    const nodes: Record<string, string> = {};
    const component: SharedComponent = {
      id: newId('cp'),
      name: entry.name,
      root: buildNode(entry.root, components, nodes, `components.${i}.root`),
    };
    components.set(entry.name, component);
  }
  const pageNodes = new Map<string, Record<string, string>>();
  const pages: Page[] = [];
  const seedPages = seed?.pages ?? [{ name: 'Home' }];
  for (const [i, seedPage] of seedPages.entries()) {
    const nodes: Record<string, string> = {};
    const root = seedPage.root
      ? buildNode(seedPage.root, components, nodes, `pages.${i}.root`)
      : {
          id: newId('n'),
          type: 'page' as const,
          name: seedPage.name,
          props: {},
          styles: emptyStyles(),
          children: [],
        };
    if (!seedPage.root) nodes[seedPage.name] = root.id;
    const page: Page = {
      id: newId('pg'),
      name: seedPage.name,
      slug: seedPage.slug ?? uniqueSlug(seedPage.name, pages.map((p) => p.slug)),
      order: i,
      root,
    };
    pages.push(page);
    pageNodes.set(page.id, nodes);
  }
  const entries: Entry[] = (seed?.collection?.entries ?? []).map((item, i) => ({
    id: newId('e'),
    order: i,
    values: { ...item.values },
  }));
  const doc: PlinthDocument = {
    id: workspaceId,
    name,
    slug,
    seq: 0,
    tokens,
    pages,
    components: [...components.values()],
    collection: {
      name: seed?.collection?.name ?? 'Entries',
      fields: seed?.collection?.fields ?? [],
      entries,
    },
  };
  return { doc, pageNodes, components };
}

export interface SeedResponse {
  users: { id: string; email: string }[];
  workspaces: {
    id: string;
    slug: string;
    pages: { id: string; name: string; slug: string; nodes: Record<string, string> }[];
    components: Record<string, string>;
  }[];
}

/** Creates users, workspaces and published pages in one call. */
export async function seedWorkspaces(body: Record<string, unknown>): Promise<SeedResponse> {
  const users = asArray<SeedUser>(body['users'], 'users');
  const workspaces = asArray<SeedWorkspace>(body['workspaces'], 'workspaces');
  const response: SeedResponse = { users: [], workspaces: [] };
  const accounts = new Map<string, string>();
  for (const [i, user] of users.entries()) {
    if (typeof user?.email !== 'string' || typeof user?.name !== 'string') {
      throw invalidFields({ [`users.${i}`]: 'Expected an email and a name.' });
    }
    const existing = await findAccountByEmail(user.email);
    const account =
      existing ?? (await createAccount(user.name, user.email, user.password ?? 'password-123'));
    accounts.set(account.email, account.id);
    response.users.push({ id: account.id, email: account.email });
  }
  for (const [i, seed] of workspaces.entries()) {
    if (typeof seed?.name !== 'string' || typeof seed?.owner !== 'string') {
      throw invalidFields({ [`workspaces.${i}`]: 'Expected a name and an owner.' });
    }
    const ownerId = accounts.get(seed.owner.toLowerCase()) ?? (await findAccountByEmail(seed.owner))?.id;
    if (ownerId === undefined) {
      throw invalidFields({ [`workspaces.${i}.owner`]: 'Unknown owner.' });
    }
    const taken = (await query<{ slug: string }>('select slug from workspaces')).map((r) => r.slug);
    const workspaceId = newId('w');
    const slug = uniqueSlug(seed.name, taken);
    const built = buildDocument(workspaceId, seed.name, slug, seed.document);
    await query('insert into workspaces (id, name, slug, doc, seq) values ($1, $2, $3, $4, 0)', [
      workspaceId,
      seed.name,
      slug,
      JSON.stringify(built.doc),
    ]);
    await query('insert into members (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      ownerId,
      'owner',
    ]);
    for (const member of seed.members ?? []) {
      const memberId =
        accounts.get(member.email.toLowerCase()) ?? (await findAccountByEmail(member.email))?.id;
      if (memberId === undefined) {
        throw invalidFields({ [`workspaces.${i}.members`]: `Unknown member ${member.email}.` });
      }
      if (memberId === ownerId) continue;
      await query(
        `insert into members (workspace_id, user_id, role) values ($1, $2, $3)
         on conflict (workspace_id, user_id) do nothing`,
        [workspaceId, memberId, member.role],
      );
    }
    for (const pageName of seed.published ?? []) {
      const doc = await loadDocument(workspaceId);
      const page = doc.pages.find((item) => item.name === pageName);
      if (!page) throw invalidFields({ [`workspaces.${i}.published`]: `Unknown page ${pageName}.` });
      await publishPage(doc, page, undefined);
    }
    response.workspaces.push({
      id: workspaceId,
      slug,
      pages: built.doc.pages.map((page) => ({
        id: page.id,
        name: page.name,
        slug: page.slug,
        nodes: built.pageNodes.get(page.id) ?? {},
      })),
      components: Object.fromEntries(
        [...built.components.entries()].map(([name, component]) => [name, component.id]),
      ),
    });
  }
  return response;
}
