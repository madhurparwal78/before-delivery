import { route, type Route } from '../http/router';
import {
  addBoardMember,
  boardEvents,
  createList,
  listArchived,
  listBoardMembers,
  listCandidates,
  patchBoard,
  patchBoardMember,
  patchList,
  readBoard,
  removeBoardMember,
} from './boards';
import {
  addChecklistItem,
  changeStatus,
  createCard,
  deleteAttachment,
  deleteCard,
  deleteChecklistItem,
  downloadAttachment,
  moveCard,
  patchCard,
  patchChecklistItem,
  readCard,
  setPrivateMembers,
  uploadAttachment,
} from './cards';
import { changePassword, health, me, serviceStatus, signIn, signOut } from './session';
import {
  addWorkspaceMember,
  createBoard,
  listWorkspaceBoards,
  listWorkspaceMembers,
  patchWorkspace,
  patchWorkspaceMember,
  readPermissionLog,
  readPermissionLogEntry,
  readWorkspace,
  removeWorkspaceMember,
  searchWorkspace,
} from './workspaces';

export const routes: readonly Route[] = [
  route('/api/health', { GET: health }, { open: true }),
  route('/api/session', { POST: signIn, DELETE: signOut }, { open: true }),
  route('/api/me', { GET: me }),
  route('/api/account/password', { POST: changePassword }),
  route('/api/service-status', { GET: serviceStatus }),

  route('/api/workspaces/:workspaceId', { GET: readWorkspace, PATCH: patchWorkspace }),
  route('/api/workspaces/:workspaceId/members', { GET: listWorkspaceMembers, POST: addWorkspaceMember }),
  route('/api/workspaces/:workspaceId/members/:userId', {
    PATCH: patchWorkspaceMember,
    DELETE: removeWorkspaceMember,
  }),
  route('/api/workspaces/:workspaceId/boards', { GET: listWorkspaceBoards, POST: createBoard }),
  route('/api/workspaces/:workspaceId/search', { GET: searchWorkspace }),
  route('/api/workspaces/:workspaceId/permission-log', { GET: readPermissionLog }),
  route('/api/workspaces/:workspaceId/permission-log/:entryId', { GET: readPermissionLogEntry }),

  route('/api/boards/:boardId', { GET: readBoard, PATCH: patchBoard }),
  route('/api/boards/:boardId/members', { GET: listBoardMembers, POST: addBoardMember }),
  route('/api/boards/:boardId/members/:userId', { PATCH: patchBoardMember, DELETE: removeBoardMember }),
  route('/api/boards/:boardId/candidates', { GET: listCandidates }),
  route('/api/boards/:boardId/lists', { POST: createList }),
  route('/api/boards/:boardId/archived', { GET: listArchived }),
  route('/api/boards/:boardId/events', { GET: boardEvents }),

  route('/api/lists/:listId', { PATCH: patchList }),
  route('/api/lists/:listId/cards', { POST: createCard }),

  route('/api/cards/:cardId', { GET: readCard, PATCH: patchCard, DELETE: deleteCard }),
  route('/api/cards/:cardId/move', { POST: moveCard }),
  route('/api/cards/:cardId/status', { POST: changeStatus }),
  route('/api/cards/:cardId/private-members', { PUT: setPrivateMembers }),
  route('/api/cards/:cardId/checklist', { POST: addChecklistItem }),
  route('/api/cards/:cardId/attachments', { POST: uploadAttachment }, { upload: true }),

  route('/api/checklist-items/:itemId', { PATCH: patchChecklistItem, DELETE: deleteChecklistItem }),
  route('/api/attachments/:attachmentId', { GET: downloadAttachment, DELETE: deleteAttachment }),
];
