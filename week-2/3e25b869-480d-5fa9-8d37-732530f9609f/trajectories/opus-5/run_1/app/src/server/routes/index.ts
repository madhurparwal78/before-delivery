import { Router } from '../http/router.js';
import { getAccount, getOwnOrder, getOwnSubscription } from './account.js';
import { requestCode, signOut, verifyCode } from './auth.js';
import { postCheckout } from './checkout.js';
import { postContact } from './contact.js';
import { createHold, releaseHold } from './holds.js';
import { getBatch, getCart, getDrop, getStatus } from './public.js';
import {
  cancelSubscription,
  patchSubscription,
  pauseSubscription,
  resumeSubscription,
  skipSubscription,
  startSubscription,
  unskipSubscription,
} from './subscriptions.js';
import { auditImmutable, staffMe, staffSignIn, staffSignOut } from './staff/auth.js';
import {
  batchMovements,
  cutBatch,
  getSettings,
  listStaffBatches,
  logLoaf,
  openBatch,
  putSettings,
  scheduleBatch,
  withdrawBatch,
} from './staff/batches.js';
import {
  addCredit,
  getStaffOrder,
  getStaffSubscription,
  issueRefund,
  listAudit,
  searchRecords,
} from './staff/finance.js';
import { getNotices, postResendNotice } from './staff/notices.js';
import { getPacking, shipOrder } from './staff/packing.js';
import {
  acceptKillBillFigure,
  getReconciliation,
  refundOrphanPayment,
} from './staff/reconciliation.js';

export const apiRouter = new Router()
  .add('GET', '/api/status', 'none', getStatus)
  .add('GET', '/api/drop', 'none', getDrop)
  .add('GET', '/api/batches/{code}', 'none', getBatch)
  .add('POST', '/api/holds', 'none', createHold)
  .add('DELETE', '/api/holds/{id}', 'none', releaseHold)
  .add('GET', '/api/cart', 'none', getCart)
  .add('POST', '/api/auth/code', 'none', requestCode)
  .add('POST', '/api/auth/verify', 'none', verifyCode)
  .add('POST', '/api/auth/sign-out', 'none', signOut)
  .add('POST', '/api/checkout', 'customer', postCheckout)
  .add('GET', '/api/account', 'customer', getAccount)
  .add('GET', '/api/account/orders/{number}', 'customer', getOwnOrder)
  .add('POST', '/api/subscriptions', 'customer', startSubscription)
  .add('GET', '/api/account/subscriptions/{number}', 'customer', getOwnSubscription)
  .add('PATCH', '/api/account/subscriptions/{number}', 'customer', patchSubscription)
  .add('POST', '/api/account/subscriptions/{number}/skip', 'customer', skipSubscription)
  .add('POST', '/api/account/subscriptions/{number}/unskip', 'customer', unskipSubscription)
  .add('POST', '/api/account/subscriptions/{number}/pause', 'customer', pauseSubscription)
  .add('POST', '/api/account/subscriptions/{number}/resume', 'customer', resumeSubscription)
  .add('POST', '/api/account/subscriptions/{number}/cancel', 'customer', cancelSubscription)
  .add('POST', '/api/contact', 'none', postContact)
  .add('POST', '/api/staff/sign-in', 'none', staffSignIn)
  .add('POST', '/api/staff/sign-out', 'staff', staffSignOut)
  .add('GET', '/api/staff/me', 'staff', staffMe)
  .add('GET', '/api/staff/batches', 'staff', listStaffBatches)
  .add('POST', '/api/staff/batches', 'staff', logLoaf)
  .add('POST', '/api/staff/batches/{code}/cut', 'staff', cutBatch)
  .add('POST', '/api/staff/batches/{code}/schedule', 'staff', scheduleBatch)
  .add('POST', '/api/staff/batches/{code}/open', 'staff', openBatch)
  .add('POST', '/api/staff/batches/{code}/withdraw', 'staff', withdrawBatch)
  .add('GET', '/api/staff/batches/{code}/movements', 'staff', batchMovements)
  .add('GET', '/api/staff/settings', 'staff', getSettings)
  .add('PUT', '/api/staff/settings', 'staff', putSettings)
  .add('GET', '/api/staff/packing', 'staff', getPacking)
  .add('POST', '/api/staff/orders/{number}/ship', 'staff', shipOrder)
  .add('GET', '/api/staff/search', 'staff', searchRecords)
  .add('GET', '/api/staff/orders/{number}', 'staff', getStaffOrder)
  .add('GET', '/api/staff/subscriptions/{number}', 'staff', getStaffSubscription)
  .add('POST', '/api/staff/orders/{number}/refunds', 'staff', issueRefund)
  .add('POST', '/api/staff/credits', 'staff', addCredit)
  .add('GET', '/api/staff/audit', 'staff', listAudit)
  .add('POST', '/api/staff/audit', 'staff', auditImmutable)
  .add('PUT', '/api/staff/audit', 'staff', auditImmutable)
  .add('PATCH', '/api/staff/audit', 'staff', auditImmutable)
  .add('DELETE', '/api/staff/audit', 'staff', auditImmutable)
  .add('PUT', '/api/staff/audit/{id}', 'staff', auditImmutable)
  .add('PATCH', '/api/staff/audit/{id}', 'staff', auditImmutable)
  .add('DELETE', '/api/staff/audit/{id}', 'staff', auditImmutable)
  .add('GET', '/api/staff/reconciliation', 'staff', getReconciliation)
  .add('POST', '/api/staff/reconciliation/accept', 'staff', acceptKillBillFigure)
  .add('POST', '/api/staff/reconciliation/refund-orphan', 'staff', refundOrphanPayment)
  .add('GET', '/api/staff/notices', 'staff', getNotices)
  .add('POST', '/api/staff/notices/{number}/resend', 'staff', postResendNotice);
