import type { Ctx } from '../http/context.ts';
import { Router } from '../http/router.ts';
import { sendJson } from '../http/respond.ts';
import {
  acceptInvitation,
  completePasswordReset,
  requestPasswordReset,
  session,
  signIn,
  signOut,
} from './auth.ts';
import {
  changeMemberRole,
  getMember,
  inviteMember,
  listMembers,
  removeMember,
} from './members.ts';
import {
  confirmWaitlist,
  createClaim,
  getHold,
  getPublicDrop,
  getPublicLookImage,
  joinWaitlist,
  listPublicDrops,
  sitemap,
} from './publicdrops.ts';
import {
  addVipMembers,
  checkDropFields,
  createDrop,
  createRestock,
  getDrop,
  listDrops,
  listRestocks,
  listWaitlist,
  patchDrop,
  scheduleDrop,
  withdrawDrop,
} from './drops.ts';
import {
  applySplit,
  confirmAllocation,
  createAllocation,
  getAllocation,
  getQuote,
  getSplit,
  listAllocations,
  listDropAllocations,
  patchAllocation,
  recordRequest,
} from './allocations.ts';
import { createPriceList, listPriceLists } from './pricelists.ts';
import {
  exportAllocationLineSheet,
  exportDropLineSheet,
  importLineSheet,
} from './linesheets.ts';
import { getLookImage, listLooks, reorderLooks, uploadLook } from './looks.ts';
import { getStory, publishStory, putStory } from './stories.ts';
import {
  createPreview,
  getPressLookImage,
  getPressPayload,
  getPressZip,
  listPreviews,
  regeneratePreview,
  revokePreview,
} from './previews.ts';
import {
  archiveStockist,
  createStockist,
  eraseStockistContact,
  exportStockists,
  getStockist,
  listStockists,
  restoreStockist,
} from './stockists.ts';

async function health(ctx: Ctx): Promise<void> {
  sendJson(ctx.response, 200, { status: 'ok' });
}

/** Paths that are rate limited at step 3 of the error ladder. */
export const RATE_LIMITED_WRITES: ReadonlyArray<{ pattern: RegExp; method: string }> = [
  { pattern: /^\/api\/public\/drops\/[^/]+\/waitlist$/, method: 'POST' },
];

export const apiRouter = new Router()
  .add('/api/health', { get: health })
  .add('/sitemap.xml', { get: sitemap })

  .add('/api/auth/sign-in', { post: signIn })
  .add('/api/auth/sign-out', { post: signOut })
  .add('/api/auth/session', { get: session })
  .add('/api/auth/password-reset', { post: requestPasswordReset })
  .add('/api/auth/password-reset/complete', { post: completePasswordReset })
  .add('/api/auth/invitations/accept', { post: acceptInvitation })

  .add('/api/members', { get: listMembers })
  .add('/api/members/invitations', { post: inviteMember })
  .add('/api/members/:memberId', {
    get: getMember,
    patch: changeMemberRole,
    delete: removeMember,
  })

  .add('/api/public/drops', { get: listPublicDrops })
  .add('/api/public/drops/:slug', { get: getPublicDrop })
  .add('/api/public/drops/:slug/looks/:lookId/image', { get: getPublicLookImage })
  .add('/api/public/drops/:slug/waitlist', { post: joinWaitlist })
  .add('/api/public/drops/:slug/claims', { post: createClaim })
  .add('/api/public/waitlist/confirm', { post: confirmWaitlist })
  .add('/api/public/holds/:holdToken', { get: getHold })

  .add('/api/drops', { get: listDrops, post: createDrop })
  .add('/api/drops/checks', { post: checkDropFields })
  .add('/api/drops/:dropId', { get: getDrop, patch: patchDrop })
  .add('/api/drops/:dropId/schedule', { post: scheduleDrop })
  .add('/api/drops/:dropId/withdraw', { post: withdrawDrop })
  .add('/api/drops/:dropId/restocks', { get: listRestocks, post: createRestock })
  .add('/api/drops/:dropId/waitlist', { get: listWaitlist })
  .add('/api/drops/:dropId/waitlist/vip', { post: addVipMembers })

  .add('/api/drops/:dropId/requests', { post: recordRequest })
  .add('/api/drops/:dropId/allocations', { get: listDropAllocations })
  .add('/api/drops/:dropId/split', { get: getSplit, post: applySplit })
  .add('/api/allocations', { get: listAllocations, post: createAllocation })
  .add('/api/allocations/:id', { get: getAllocation, patch: patchAllocation })
  .add('/api/allocations/:id/quote', { get: getQuote })
  .add('/api/allocations/:id/confirm', { post: confirmAllocation })
  .add('/api/allocations/:id/line-sheet.csv', { get: exportAllocationLineSheet })

  .add('/api/price-lists', { get: listPriceLists, post: createPriceList })

  .add('/api/drops/:dropId/line-sheet.csv', { get: exportDropLineSheet })
  .add('/api/drops/:dropId/line-sheet/import', { post: importLineSheet })

  .add('/api/drops/:dropId/looks', { get: listLooks, post: uploadLook })
  .add('/api/drops/:dropId/looks/order', { put: reorderLooks })
  .add('/api/drops/:dropId/looks/:lookId/image', { get: getLookImage })

  .add('/api/drops/:dropId/story', { get: getStory, put: putStory })
  .add('/api/drops/:dropId/story/publish', { post: publishStory })

  .add('/api/drops/:dropId/previews', { get: listPreviews, post: createPreview })
  .add('/api/previews/:previewId/revoke', { post: revokePreview })
  .add('/api/previews/:previewId/regenerate', { post: regeneratePreview })
  .add('/api/press/:token', { get: getPressPayload })
  .add('/api/press/:token/looks/:lookId/image', { get: getPressLookImage })
  .add('/api/press/:token/zip', { get: getPressZip })

  .add('/api/stockists', { get: listStockists, post: createStockist })
  .add('/api/stockists.csv', { get: exportStockists })
  .add('/api/stockists/:id', { get: getStockist })
  .add('/api/stockists/:id/archive', { post: archiveStockist })
  .add('/api/stockists/:id/restore', { post: restoreStockist })
  .add('/api/stockists/:id/erase-contact', { post: eraseStockistContact });
