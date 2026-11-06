import { blocksOf } from '../shared/doc.js';
import type { Comment, Person, Role, SaveState, Snapshot, Suggestion } from '../shared/types.js';
import { type Access, peopleWithAccess } from './access.js';
import { type LiveDocument } from './livedoc.js';
import { modeFor } from './modes.js';
import { personObject } from './people.js';

export function saveStateOf(document: LiveDocument): SaveState {
  if (document.meta.savedRevision === document.meta.revision) return 'saved';
  if (document.meta.saveFailed) return 'failed';
  return 'saving';
}

export type RoleMap = Map<string, Role>;

export async function roleMapFor(documentId: string): Promise<RoleMap> {
  const people = await peopleWithAccess(documentId);
  return new Map(people.map((entry) => [entry.personId, entry.role]));
}

export function withRole(personId: string, roles: RoleMap): Person {
  const role = roles.get(personId);
  return role ? personObject(personId, role) : personObject(personId);
}

export function projectSuggestion(suggestion: Suggestion, roles: RoleMap): Suggestion {
  return { ...suggestion, author: withRole(suggestion.author.personId, roles) };
}

export function projectComment(comment: Comment, roles: RoleMap): Comment {
  return {
    ...comment,
    author: withRole(comment.author.personId, roles),
    mentions: comment.mentions.map((person) => withRole(person.personId, roles)),
    replies: comment.replies.map((reply) => ({ ...reply, author: withRole(reply.author.personId, roles) })),
  };
}

export async function snapshotOf(document: LiveDocument, personId: string, access: Access): Promise<Snapshot> {
  const roles = await roleMapFor(document.meta.id);
  const mode = await modeFor(document.meta.id, personId, access.role);
  return {
    id: document.meta.id,
    title: document.meta.title,
    client: document.meta.client,
    revision: document.meta.revision,
    savedRevision: document.meta.savedRevision,
    saveState: saveStateOf(document),
    myAccess: { role: access.role, mode, accessEndsAt: access.accessEndsAt },
    text: document.state.text,
    blocks: blocksOf(document.state),
    marks: document.state.marks,
    suggestions: document.state.suggestions.map((suggestion) => projectSuggestion(suggestion, roles)),
    comments: document.state.comments.map((comment) => projectComment(comment, roles)),
    people: [...roles.entries()].map(([id, role]) => personObject(id, role)),
  };
}
