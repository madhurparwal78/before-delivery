import {
  type Connector,
  type DiagramDocument,
  type Group,
  type Layer,
  type Page,
  type Port,
  type Shape,
  type ShapeKind,
  PORTS,
  SHAPE_KINDS,
} from '../shared/document.js';
import { reroutePage } from '../shared/router.js';
import {
  type Validated,

  isPlainObject,
  joinPath,
  validateDisplayName,
  validateEmail,
  validateObjectName,
  validatePassword,
  validateTitle,
  wholeNumberInRange,
} from '../shared/validate.js';
import { LIMITS } from '../shared/document.js';
import { findUserByEmail, hashPassword } from './auth.js';
import { query, transaction } from './db.js';
import { registerObjectIds } from './diagrams.js';
import { ApiError, invalidRequest } from './errors.js';
import { clientsOfDiagram, closeClients } from './hub.js';
import { newId } from './ids.js';

interface SeededPage {
  id: string;
  name: string;
  layers: Record<string, string>;
  shapes: Record<string, string>;
  connectors: Record<string, string>;
  comments: Record<string, string[]>;
}

function fail(path: string, message: string): never {
  throw invalidRequest({ [path]: message });
}

function take<T>(result: Validated<T>): T {
  if (!result.ok) throw invalidRequest(result.fields);
  return result.value;
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(path, 'Send an object.');
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Send a list.');
  return value;
}

function expectCoordinate(value: unknown, path: string): number {
  if (!wholeNumberInRange(value, LIMITS.coordMin, LIMITS.coordMax)) {
    fail(path, `Enter a whole number from ${LIMITS.coordMin} to ${LIMITS.coordMax}.`);
  }
  return value;
}

function expectSize(value: unknown, path: string): number {
  if (!wholeNumberInRange(value, LIMITS.sizeMin, LIMITS.sizeMax)) {
    fail(path, `Enter a whole number from ${LIMITS.sizeMin} to ${LIMITS.sizeMax}.`);
  }
  return value;
}

function expectPort(value: unknown, path: string): Port {
  if (typeof value !== 'string' || !PORTS.includes(value as Port)) {
    fail(path, 'Choose the port n, e, s or w.');
  }
  return value as Port;
}

function expectLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > LIMITS.labelMax) {
    fail(path, `Use at most ${LIMITS.labelMax} characters.`);
  }
  return value;
}

interface PlannedComment {
  id: string;
  pageId: string;
  shapeId: string;
  authorEmail: string;
  text: string;
  shapeLabel: string;
}

interface PlannedDiagram {
  id: string;
  title: string;
  ownerEmail: string;
  members: { email: string; role: 'editor' | 'viewer' }[];
  document: DiagramDocument;
  comments: PlannedComment[];
  report: { id: string; pages: SeededPage[] };
}

/**
 * Builds every record in one pass so nothing is created when any part of the request is
 * invalid. Layers are listed bottom first, shapes in z order, and connectors get ids in
 * the order they are listed.
 */
function planDiagram(raw: unknown, index: number): PlannedDiagram {
  const path = `diagrams.${index}`;
  const body = expectObject(raw, path);
  const title = take(validateTitle(body['title'], joinPath(path, 'title')));
  const ownerEmail = take(validateEmail(body['owner'], joinPath(path, 'owner')));
  const members: { email: string; role: 'editor' | 'viewer' }[] = [];
  for (const [i, member] of expectArray(body['members'] ?? [], joinPath(path, 'members')).entries()) {
    const memberPath = `${path}.members.${i}`;
    const entry = expectObject(member, memberPath);
    const email = take(validateEmail(entry['email'], joinPath(memberPath, 'email')));
    const role = entry['role'];
    if (role !== 'editor' && role !== 'viewer') fail(joinPath(memberPath, 'role'), 'Choose editor or viewer.');
    members.push({ email, role });
  }

  const diagramId = newId('d');
  const documentPath = joinPath(path, 'document');
  const rawPages = expectArray(expectObject(body['document'] ?? {}, documentPath)['pages'] ?? [], joinPath(documentPath, 'pages'));
  if (rawPages.length === 0 || rawPages.length > LIMITS.pagesPerDiagram) {
    fail(joinPath(documentPath, 'pages'), `Send 1 to ${LIMITS.pagesPerDiagram} pages.`);
  }

  const pages: Page[] = [];
  const report: SeededPage[] = [];
  const comments: PlannedComment[] = [];

  for (const [pageIndex, rawPage] of rawPages.entries()) {
    const pagePath = `${documentPath}.pages.${pageIndex}`;
    const pageBody = expectObject(rawPage, pagePath);
    const name = take(validateObjectName(pageBody['name'], joinPath(pagePath, 'name')));
    const page: Page = {
      id: newId('p'),
      name,
      order: pageIndex,
      layers: [],
      shapes: [],
      connectors: [],
      groups: [],
    };
    const layerIds: Record<string, string> = {};
    const rawLayers = expectArray(pageBody['layers'] ?? [], joinPath(pagePath, 'layers'));
    if (rawLayers.length === 0 || rawLayers.length > LIMITS.layersPerPage) {
      fail(joinPath(pagePath, 'layers'), `Send 1 to ${LIMITS.layersPerPage} layers.`);
    }
    for (const [layerIndex, rawLayer] of rawLayers.entries()) {
      const layerPath = `${pagePath}.layers.${layerIndex}`;
      const layerBody = expectObject(rawLayer, layerPath);
      const layerName = take(validateObjectName(layerBody['name'], joinPath(layerPath, 'name')));
      if (layerIds[layerName] !== undefined) fail(joinPath(layerPath, 'name'), 'Name each layer once.');
      const layer: Layer = {
        id: newId('l'),
        name: layerName,
        order: layerIndex,
        visible: layerBody['visible'] !== false,
        locked: layerBody['locked'] === true,
      };
      page.layers.push(layer);
      layerIds[layerName] = layer.id;
    }

    const shapeIds: Record<string, string> = {};
    const rawShapes = expectArray(pageBody['shapes'] ?? [], joinPath(pagePath, 'shapes'));
    for (const [shapeIndex, rawShape] of rawShapes.entries()) {
      const shapePath = `${pagePath}.shapes.${shapeIndex}`;
      const shapeBody = expectObject(rawShape, shapePath);
      const kind = shapeBody['kind'];
      if (typeof kind !== 'string' || !SHAPE_KINDS.includes(kind as ShapeKind)) {
        fail(joinPath(shapePath, 'kind'), 'Choose rectangle, ellipse, diamond or text.');
      }
      const layerName = shapeBody['layer'];
      const layerId = typeof layerName === 'string' ? layerIds[layerName] : undefined;
      if (layerId === undefined) fail(joinPath(shapePath, 'layer'), 'Name a layer of this page.');
      const label = expectLabel(shapeBody['label'] ?? '', joinPath(shapePath, 'label'));
      if (label.length > 0 && shapeIds[label] !== undefined) {
        fail(joinPath(shapePath, 'label'), 'Labels must be unique within a page.');
      }
      const shape: Shape = {
        id: newId('s'),
        kind: kind as ShapeKind,
        layer: layerId,
        x: expectCoordinate(shapeBody['x'], joinPath(shapePath, 'x')),
        y: expectCoordinate(shapeBody['y'], joinPath(shapePath, 'y')),
        w: expectSize(shapeBody['w'], joinPath(shapePath, 'w')),
        h: expectSize(shapeBody['h'], joinPath(shapePath, 'h')),
        label,
        z: shapeIndex + 1,
        group: null,
      };
      page.shapes.push(shape);
      shapeIds[label] = shape.id;
    }

    const connectorIds: Record<string, string> = {};
    const rawConnectors = expectArray(pageBody['connectors'] ?? [], joinPath(pagePath, 'connectors'));
    for (const [connectorIndex, rawConnector] of rawConnectors.entries()) {
      const connectorPath = `${pagePath}.connectors.${connectorIndex}`;
      const connectorBody = expectObject(rawConnector, connectorPath);
      const fromBody = expectObject(connectorBody['from'], joinPath(connectorPath, 'from'));
      const toBody = expectObject(connectorBody['to'], joinPath(connectorPath, 'to'));
      const fromLabel = fromBody['shape'];
      const toLabel = toBody['shape'];
      const fromId = typeof fromLabel === 'string' ? shapeIds[fromLabel] : undefined;
      const toId = typeof toLabel === 'string' ? shapeIds[toLabel] : undefined;
      if (fromId === undefined) fail(joinPath(connectorPath, 'from.shape'), 'Name a shape of this page.');
      if (toId === undefined) fail(joinPath(connectorPath, 'to.shape'), 'Name a shape of this page.');
      if (fromId === toId) fail(joinPath(connectorPath, 'to.shape'), 'Connect two different shapes.');
      const source = page.shapes.find((s) => s.id === fromId);
      const connector: Connector = {
        id: newId('c'),
        layer: source?.layer ?? '',
        from: { shape: fromId, port: expectPort(fromBody['port'], joinPath(connectorPath, 'from.port')) },
        to: { shape: toId, port: expectPort(toBody['port'], joinPath(connectorPath, 'to.port')) },
        label: expectLabel(connectorBody['label'] ?? '', joinPath(connectorPath, 'label')),
        route: [],
      };
      page.connectors.push(connector);
      connectorIds[`${String(fromLabel)}->${String(toLabel)}`] = connector.id;
    }

    for (const [groupIndex, rawGroup] of expectArray(pageBody['groups'] ?? [], joinPath(pagePath, 'groups')).entries()) {
      const groupPath = `${pagePath}.groups.${groupIndex}`;
      const groupBody = expectObject(rawGroup, groupPath);
      const memberLabels = expectArray(groupBody['members'], joinPath(groupPath, 'members'));
      if (memberLabels.length < 2) fail(joinPath(groupPath, 'members'), 'Group two or more shapes.');
      const group: Group = { id: newId('g'), members: [] };
      for (const [memberIndex, memberLabel] of memberLabels.entries()) {
        const shapeId = typeof memberLabel === 'string' ? shapeIds[memberLabel] : undefined;
        if (shapeId === undefined) {
          fail(`${groupPath}.members.${memberIndex}`, 'Name a shape of this page.');
        }
        const shape = page.shapes.find((s) => s.id === shapeId);
        if (!shape) fail(`${groupPath}.members.${memberIndex}`, 'Name a shape of this page.');
        shape.group = group.id;
        group.members.push(shapeId);
      }
      page.groups.push(group);
    }

    const commentIds: Record<string, string[]> = {};
    for (const [commentIndex, rawComment] of expectArray(pageBody['comments'] ?? [], joinPath(pagePath, 'comments')).entries()) {
      const commentPath = `${pagePath}.comments.${commentIndex}`;
      const commentBody = expectObject(rawComment, commentPath);
      const shapeLabel = commentBody['shape'];
      const shapeId = typeof shapeLabel === 'string' ? shapeIds[shapeLabel] : undefined;
      if (shapeId === undefined) fail(joinPath(commentPath, 'shape'), 'Name a shape of this page.');
      const author = take(validateEmail(commentBody['author'], joinPath(commentPath, 'author')));
      const text = commentBody['text'];
      if (typeof text !== 'string' || text.length < 1 || text.length > LIMITS.commentMax) {
        fail(joinPath(commentPath, 'text'), `Use 1 to ${LIMITS.commentMax} characters.`);
      }
      const id = newId('m');
      comments.push({
        id,
        pageId: page.id,
        shapeId,
        authorEmail: author,
        text,
        shapeLabel: String(shapeLabel),
      });
      const existing = commentIds[String(shapeLabel)] ?? [];
      existing.push(id);
      commentIds[String(shapeLabel)] = existing;
    }

    reroutePage(page);
    pages.push(page);
    report.push({
      id: page.id,
      name: page.name,
      layers: layerIds,
      shapes: shapeIds,
      connectors: connectorIds,
      comments: commentIds,
    });
  }

  return {
    id: diagramId,
    title,
    ownerEmail,
    members,
    document: { id: diagramId, title, seq: 0, pages },
    comments,
    report: { id: diagramId, pages: report },
  };
}

/** Creates users and diagrams in one call. Nothing is created when anything is invalid. */
export async function seedDiagrams(raw: unknown): Promise<unknown> {
  const body = expectObject(raw, '');
  const rawUsers = expectArray(body['users'] ?? [], 'users');
  const planned: { email: string; name: string; password: string }[] = [];
  for (const [index, rawUser] of rawUsers.entries()) {
    const path = `users.${index}`;
    const entry = expectObject(rawUser, path);
    planned.push({
      name: take(validateDisplayName(entry['name'], joinPath(path, 'name'))),
      email: take(validateEmail(entry['email'], joinPath(path, 'email'))),
      password: take(validatePassword(entry['password'], joinPath(path, 'password'))),
    });
  }
  for (const [index, user] of planned.entries()) {
    if (await findUserByEmail(user.email)) {
      throw new ApiError(409, 'email_taken', 'An account with this email already exists.', {
        [`users.${index}.email`]: 'An account with this email already exists.',
      });
    }
  }

  const diagrams = expectArray(body['diagrams'] ?? [], 'diagrams').map((entry, index) =>
    planDiagram(entry, index),
  );

  const created: { id: string; email: string }[] = [];
  await transaction(async (client) => {
    const idByEmail = new Map<string, string>();
    for (const user of planned) {
      const id = newId('u');
      await client.query(
        'INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)',
        [id, user.email, user.name, await hashPassword(user.password)],
      );
      idByEmail.set(user.email, id);
      created.push({ id, email: user.email });
    }
    const resolve = async (email: string, path: string): Promise<string> => {
      const known = idByEmail.get(email);
      if (known !== undefined) return known;
      const found = await findUserByEmail(email);
      if (!found) fail(path, 'Name a user of this request or an existing account.');
      idByEmail.set(email, found.id);
      return found.id;
    };

    for (const [index, diagram] of diagrams.entries()) {
      const ownerId = await resolve(diagram.ownerEmail, `diagrams.${index}.owner`);
      await client.query(
        'INSERT INTO diagrams (id, title, owner_id, document, seq) VALUES ($1, $2, $3, $4, 0)',
        [diagram.id, diagram.title, ownerId, JSON.stringify(diagram.document)],
      );
      await client.query('INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)', [
        diagram.id,
        ownerId,
        'owner',
      ]);
      const objects: { id: string; kind: string }[] = [{ id: ownerId, kind: 'member' }];
      for (const [memberIndex, member] of diagram.members.entries()) {
        const memberId = await resolve(
          member.email,
          `diagrams.${index}.members.${memberIndex}.email`,
        );
        if (memberId === ownerId) continue;
        await client.query(
          `INSERT INTO members (diagram_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (diagram_id, user_id) DO UPDATE SET role = excluded.role`,
          [diagram.id, memberId, member.role],
        );
        objects.push({ id: memberId, kind: 'member' });
      }
      for (const page of diagram.document.pages) {
        objects.push({ id: page.id, kind: 'page' });
        for (const layer of page.layers) objects.push({ id: layer.id, kind: 'layer' });
        for (const shape of page.shapes) objects.push({ id: shape.id, kind: 'shape' });
        for (const connector of page.connectors) objects.push({ id: connector.id, kind: 'connector' });
        for (const group of page.groups) objects.push({ id: group.id, kind: 'group' });
      }
      for (const comment of diagram.comments) {
        const authorId = await resolve(comment.authorEmail, 'diagrams.author');
        await client.query(
          `INSERT INTO comments (id, diagram_id, page_id, shape_id, author_id, body)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [comment.id, diagram.id, comment.pageId, comment.shapeId, authorId, comment.text],
        );
        objects.push({ id: comment.id, kind: 'comment' });
      }
      await registerObjectIds(client, diagram.id, objects);
    }
  });

  return { users: created, diagrams: diagrams.map((d) => d.report) };
}

/**
 * Closes every socket on the diagram, then refuses new sockets and answers its operations
 * with 503 for the requested span of server time.
 */
export async function startSaveOutage(diagramId: string, ms: number): Promise<string> {
  const until = new Date(Date.now() + ms);
  await query(
    `INSERT INTO save_outages (diagram_id, until) VALUES ($1, $2)
     ON CONFLICT (diagram_id) DO UPDATE SET until = excluded.until`,
    [diagramId, until.toISOString()],
  );
  closeClients(clientsOfDiagram(diagramId), 4503);
  return until.toISOString();
}
