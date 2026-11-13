// Every published endpoint, with what the pipeline needs to judge it.
import { bookAppointment, bookingLimit, appointmentPage, appointmentTokenExists, cancelAppointment, listAppointments, slotsWeek } from "./handlers/appointments";
import { consignorExists, createConsignor, endPageAddress, eraseConsignor, getConsignor, listConsignors, portal, portalPageIsOpen, portalPiece, saveChoices, sendPageAddress, updateConsignor } from "./handlers/consignors";
import { getHold, holdExists, holdPageByToken, holdTokenExists, letHoldGo, listHolds, placeHold, releaseHold } from "./handlers/holds";
import { previewImport, saveImport } from "./handlers/imports";
import { createLadder, listLadders } from "./handlers/ladders";
import { getRun, listRuns, runExists, runFile, startRun } from "./handlers/payouts";
import { addPhoto, archivePiece, changePrice, createPiece, getPiece, listPieces, lookupPiece, markCollected, originalPhoto, photoExists, photoIsPublic, pieceExists, publicPhoto, restorePiece } from "./handlers/pieces";
import { listRail, publicPiece, publicPieceExists } from "./handlers/rail";
import { checkDownloadLimit, downloadSalesBook, getSale, recordSale, refundSale, saleExists, salesOfMonth } from "./handlers/sales";
import { addMember, changeMemberRole, currentSession, getMember, listMembers, memberExists, removeMember, signIn, signOut } from "./handlers/session";
import { BODY, reply, type Route } from "./pipeline";

export const ROUTES: Route[] = [
  { method: "GET", path: "/api/health", access: "public", handler: async () => reply(200, { status: "ok" }) },

  { method: "POST", path: "/api/session", access: "public", body: BODY.json, bookkeeperMayWrite: true, handler: signIn },
  { method: "GET", path: "/api/session", access: "staff", handler: currentSession },
  { method: "DELETE", path: "/api/session", access: "staff", bookkeeperMayWrite: true, handler: signOut },

  { method: "GET", path: "/api/members", access: "owner", handler: listMembers },
  { method: "POST", path: "/api/members", access: "owner", body: BODY.json, handler: addMember },
  { method: "GET", path: "/api/members/{id}", access: "owner", resource: memberExists, handler: getMember },
  { method: "PATCH", path: "/api/members/{id}", access: "owner", resource: memberExists, body: BODY.json, handler: changeMemberRole },
  { method: "DELETE", path: "/api/members/{id}", access: "owner", resource: memberExists, handler: removeMember },

  { method: "GET", path: "/api/rail", access: "public", handler: listRail },
  { method: "GET", path: "/api/public/pieces/{id}", access: "public", resource: publicPieceExists, handler: publicPiece },

  { method: "GET", path: "/api/pieces", access: "desk", handler: listPieces },
  { method: "POST", path: "/api/pieces", access: "desk", body: BODY.json, handler: createPiece },
  { method: "GET", path: "/api/pieces/lookup", access: "desk", handler: lookupPiece },
  { method: "GET", path: "/api/pieces/{id}", access: "desk", resource: pieceExists, handler: getPiece },
  { method: "PATCH", path: "/api/pieces/{id}", access: "owner", resource: pieceExists, body: BODY.json, handler: changePrice },
  { method: "POST", path: "/api/pieces/{id}/photos", access: "desk", resource: pieceExists, body: BODY.photo, handler: addPhoto },
  { method: "POST", path: "/api/pieces/{id}/archive", access: "owner", resource: pieceExists, handler: archivePiece },
  { method: "POST", path: "/api/pieces/{id}/restore", access: "owner", resource: pieceExists, handler: restorePiece },
  { method: "POST", path: "/api/pieces/{id}/collected", access: "desk", resource: pieceExists, handler: markCollected },
  { method: "POST", path: "/api/pieces/{id}/holds", access: "public", resource: pieceExists, body: BODY.json, handler: placeHold },

  { method: "GET", path: "/api/photos/{id}", access: "public", deskUnless: photoIsPublic, resource: photoExists, handler: publicPhoto },
  { method: "GET", path: "/api/photos/{id}/original", access: "owner", resource: photoExists, handler: originalPhoto },

  { method: "GET", path: "/api/ladders", access: "owner", handler: listLadders },
  { method: "POST", path: "/api/ladders", access: "owner", body: BODY.json, handler: createLadder },

  { method: "GET", path: "/api/holds", access: "desk", handler: listHolds },
  { method: "GET", path: "/api/holds/by-token/{token}", access: "public", resource: holdTokenExists, handler: holdPageByToken },
  { method: "POST", path: "/api/holds/by-token/{token}/release", access: "public", resource: holdTokenExists, handler: letHoldGo },
  { method: "GET", path: "/api/holds/{id}", access: "desk", resource: holdExists, handler: getHold },
  { method: "POST", path: "/api/holds/{id}/release", access: "desk", resource: holdExists, handler: releaseHold },

  { method: "POST", path: "/api/sales", access: "desk", body: BODY.json, requestKey: true, handler: recordSale },
  { method: "GET", path: "/api/sales", access: "books", handler: salesOfMonth },
  { method: "GET", path: "/api/sales/{id}", access: "staff", resource: saleExists, handler: getSale },
  { method: "POST", path: "/api/sales/{id}/refund", access: "desk", resource: saleExists, handler: refundSale },
  { method: "GET", path: "/api/sales-book", access: "books", memberLimit: checkDownloadLimit, handler: downloadSalesBook },

  { method: "GET", path: "/api/payout-runs", access: "books", handler: listRuns },
  { method: "POST", path: "/api/payout-runs", access: "owner", body: BODY.json, handler: startRun },
  { method: "GET", path: "/api/payout-runs/{month}", access: "books", resource: runExists, handler: getRun },
  { method: "GET", path: "/api/payout-runs/{month}/file", access: "books", resource: runExists, handler: runFile },

  { method: "GET", path: "/api/consignors", access: "desk", handler: listConsignors },
  { method: "POST", path: "/api/consignors", access: "desk", body: BODY.json, handler: createConsignor },
  { method: "GET", path: "/api/consignors/{id}", access: "desk", resource: consignorExists, handler: getConsignor },
  { method: "PATCH", path: "/api/consignors/{id}", access: "desk", resource: consignorExists, body: BODY.json, handler: updateConsignor },
  { method: "POST", path: "/api/consignors/{id}/portal-link", access: "desk", resource: consignorExists, handler: sendPageAddress },
  { method: "DELETE", path: "/api/consignors/{id}/portal-link", access: "owner", resource: consignorExists, handler: endPageAddress },
  { method: "POST", path: "/api/consignors/{id}/erase", access: "owner", resource: consignorExists, handler: eraseConsignor },

  { method: "GET", path: "/api/portal/{token}", access: "public", resource: portalPageIsOpen, handler: portal },
  { method: "GET", path: "/api/portal/{token}/pieces/{pieceId}", access: "public", resource: portalPageIsOpen, handler: portalPiece },
  { method: "PUT", path: "/api/portal/{token}/choices", access: "public", resource: portalPageIsOpen, body: BODY.json, handler: saveChoices },

  { method: "GET", path: "/api/appointment-slots", access: "public", handler: slotsWeek },
  { method: "POST", path: "/api/appointments", access: "public", body: BODY.json, bodyLimit: bookingLimit, handler: bookAppointment },
  { method: "GET", path: "/api/appointments", access: "desk", handler: listAppointments },
  { method: "GET", path: "/api/appointments/by-token/{token}", access: "public", resource: appointmentTokenExists, handler: appointmentPage },
  { method: "POST", path: "/api/appointments/by-token/{token}/cancel", access: "public", resource: appointmentTokenExists, handler: cancelAppointment },

  { method: "POST", path: "/api/imports/preview", access: "owner", body: BODY.sheet, handler: previewImport },
  { method: "POST", path: "/api/imports", access: "owner", body: BODY.sheet, handler: saveImport },
];
