import { changePassword, me, serviceStatus, signIn, signOut } from './accounts.ts';
import { deleteAttachment, downloadAttachment, uploadAttachment } from './attachments.ts';
import {
  addBoardMember, changeBoardMember, createList, getBoard, listArchived, listBoardMembers, listCandidates, openEvents,
  patchBoard, removeBoardMember, renameList,
} from './boards.ts';
import {
  addChecklistItem, changeStatus, createCard, deleteCard, deleteChecklistItem, getCard, moveCard, patchCard,
  patchChecklistItem, setPrivateMembers,
} from './cards.ts';
import type { Route } from './http-types.ts';
import {
  addPerson, changePersonRole, createBoard, getPermissionLogEntry, getWorkspace, listBoards, listPeople,
  listPermissionLog, patchWorkspace, removePerson, search,
} from './workspaces.ts';

const id = '([^/]+)';
const at = (path: string): RegExp => new RegExp(`^/api/${path.replaceAll(':id', id)}$`);

export const ROUTES: Route[] = [
  { pattern: at('session'), open: { POST: signIn }, methods: { DELETE: signOut } },
  { pattern: at('me'), methods: { GET: me } },
  { pattern: at('account/password'), methods: { POST: changePassword } },
  { pattern: at('service-status'), methods: { GET: serviceStatus } },
  { pattern: at('workspaces/:id'), methods: { GET: getWorkspace, PATCH: patchWorkspace } },
  { pattern: at('workspaces/:id/members'), methods: { GET: listPeople, POST: addPerson } },
  { pattern: at('workspaces/:id/members/:id'), methods: { PATCH: changePersonRole, DELETE: removePerson } },
  { pattern: at('workspaces/:id/boards'), methods: { GET: listBoards, POST: createBoard } },
  { pattern: at('workspaces/:id/search'), methods: { GET: search } },
  { pattern: at('workspaces/:id/permission-log'), methods: { GET: listPermissionLog } },
  { pattern: at('workspaces/:id/permission-log/:id'), methods: { GET: getPermissionLogEntry } },
  { pattern: at('boards/:id'), methods: { GET: getBoard, PATCH: patchBoard } },
  { pattern: at('boards/:id/members'), methods: { GET: listBoardMembers, POST: addBoardMember } },
  { pattern: at('boards/:id/members/:id'), methods: { PATCH: changeBoardMember, DELETE: removeBoardMember } },
  { pattern: at('boards/:id/candidates'), methods: { GET: listCandidates } },
  { pattern: at('boards/:id/lists'), methods: { POST: createList } },
  { pattern: at('boards/:id/archived'), methods: { GET: listArchived } },
  { pattern: at('boards/:id/events'), methods: { GET: openEvents } },
  { pattern: at('lists/:id'), methods: { PATCH: renameList } },
  { pattern: at('lists/:id/cards'), methods: { POST: createCard } },
  { pattern: at('cards/:id'), methods: { GET: getCard, PATCH: patchCard, DELETE: deleteCard } },
  { pattern: at('cards/:id/move'), methods: { POST: moveCard } },
  { pattern: at('cards/:id/status'), methods: { POST: changeStatus } },
  { pattern: at('cards/:id/private-members'), methods: { PUT: setPrivateMembers } },
  { pattern: at('cards/:id/checklist'), methods: { POST: addChecklistItem } },
  { pattern: at('cards/:id/attachments'), upload: true, methods: { POST: uploadAttachment } },
  { pattern: at('checklist-items/:id'), methods: { PATCH: patchChecklistItem, DELETE: deleteChecklistItem } },
  { pattern: at('attachments/:id'), methods: { GET: downloadAttachment, DELETE: deleteAttachment } },
];
