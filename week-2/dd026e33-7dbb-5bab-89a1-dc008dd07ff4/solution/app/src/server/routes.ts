// The API route table (brief: API).
import { createSession, deleteSession, getHealth, getHouse, getMe, getStatus, putUnits } from "./account.js";
import { assignBay, listBays } from "./bays.js";
import { addItem, listMovements, moveItem } from "./belongings.js";
import { changeAccess, getBoard, listStaff } from "./board.js";
import { addCareEntry, getCareRound } from "./care.js";
import { getCar, listCars, listOwners, registerCar } from "./cars.js";
import type { Route } from "./http.js";
import { getInvoice, issueInvoice, listInvoices, recordTransfer } from "./invoices.js";
import {
  addReading,
  approveEstimate,
  coatStack,
  createJob,
  declineEstimate,
  editEstimate,
  finishJob,
  getJob,
  listJobs,
  logStage,
  panelReadings,
  reviseEstimate,
  sendEstimate,
} from "./jobs.js";
import {
  bookRelease,
  cancelRelease,
  completeRelease,
  getEarliestSlot,
  getRelease,
  listReleases,
  requestRelease,
  stageRelease,
} from "./releases.js";
import { downloadReport, photoContent, uploadPhoto, uploadReport } from "./uploads.js";

export const ROUTES: Route[] = [
  { method: "GET", pattern: "/api/health", body: "none", open: true, handler: getHealth },
  { method: "GET", pattern: "/api/status", body: "none", open: true, handler: getStatus },
  { method: "POST", pattern: "/api/session", body: "json", open: true, handler: createSession },
  { method: "DELETE", pattern: "/api/session", body: "json", handler: deleteSession },
  { method: "GET", pattern: "/api/me", body: "none", handler: getMe },
  { method: "PUT", pattern: "/api/me/units", body: "json", handler: putUnits },
  { method: "GET", pattern: "/api/house", body: "none", handler: getHouse },

  { method: "GET", pattern: "/api/owners", body: "none", handler: listOwners },
  { method: "GET", pattern: "/api/cars", body: "none", handler: listCars },
  { method: "POST", pattern: "/api/cars", body: "json", handler: registerCar },
  { method: "GET", pattern: "/api/cars/:id", body: "none", handler: getCar },
  { method: "GET", pattern: "/api/bays", body: "none", handler: listBays },
  { method: "POST", pattern: "/api/cars/:id/bay", body: "json", handler: assignBay },
  { method: "POST", pattern: "/api/cars/:id/belongings", body: "json", handler: addItem },
  { method: "POST", pattern: "/api/belongings/:id/movements", body: "json", handler: moveItem },
  { method: "GET", pattern: "/api/belongings/:id/movements", body: "none", handler: listMovements },
  { method: "POST", pattern: "/api/cars/:id/condition-report", body: "upload", ownTransactions: true, handler: uploadReport },
  { method: "GET", pattern: "/api/condition-reports/:id/file", body: "none", handler: downloadReport },
  { method: "POST", pattern: "/api/cars/:id/photos", body: "upload", ownTransactions: true, handler: uploadPhoto },
  { method: "GET", pattern: "/api/photos/:id/content", body: "none", handler: photoContent },

  { method: "GET", pattern: "/api/care-round", body: "none", handler: getCareRound },
  { method: "POST", pattern: "/api/cars/:id/care-entries", body: "json", idempotent: true, handler: addCareEntry },

  { method: "GET", pattern: "/api/jobs", body: "none", handler: listJobs },
  { method: "POST", pattern: "/api/jobs", body: "json", handler: createJob },
  { method: "GET", pattern: "/api/jobs/:id", body: "none", handler: getJob },
  { method: "PATCH", pattern: "/api/jobs/:id", body: "json", handler: editEstimate },
  { method: "POST", pattern: "/api/jobs/:id/send", body: "json", handler: sendEstimate },
  { method: "POST", pattern: "/api/jobs/:id/revise", body: "json", handler: reviseEstimate },
  { method: "POST", pattern: "/api/jobs/:id/approve", body: "json", handler: approveEstimate },
  { method: "POST", pattern: "/api/jobs/:id/decline", body: "json", handler: declineEstimate },
  { method: "POST", pattern: "/api/jobs/:id/stages", body: "json", handler: logStage },
  { method: "POST", pattern: "/api/jobs/:id/stages/:stage/readings", body: "json", handler: addReading },
  { method: "GET", pattern: "/api/jobs/:id/coat-stack", body: "none", handler: coatStack },
  { method: "GET", pattern: "/api/jobs/:id/panels/:panel/readings", body: "none", handler: panelReadings },
  { method: "POST", pattern: "/api/jobs/:id/finish", body: "json", handler: finishJob },
  { method: "POST", pattern: "/api/jobs/:id/invoice", body: "json", idempotent: true, handler: issueInvoice },

  { method: "GET", pattern: "/api/invoices", body: "none", handler: listInvoices },
  { method: "GET", pattern: "/api/invoices/:id", body: "none", handler: getInvoice },
  { method: "POST", pattern: "/api/invoices/:id/payments", body: "json", idempotent: true, handler: recordTransfer },

  { method: "GET", pattern: "/api/releases/earliest-slot", body: "none", handler: getEarliestSlot },
  { method: "GET", pattern: "/api/releases", body: "none", handler: listReleases },
  { method: "POST", pattern: "/api/releases", body: "json", idempotent: true, handler: requestRelease },
  { method: "GET", pattern: "/api/releases/:id", body: "none", handler: getRelease },
  { method: "POST", pattern: "/api/releases/:id/book", body: "json", handler: bookRelease },
  { method: "POST", pattern: "/api/releases/:id/stage", body: "json", handler: stageRelease },
  { method: "POST", pattern: "/api/releases/:id/complete", body: "json", handler: completeRelease },
  { method: "POST", pattern: "/api/releases/:id/cancel", body: "json", handler: cancelRelease },

  { method: "GET", pattern: "/api/board", body: "none", handler: getBoard },
  { method: "GET", pattern: "/api/staff", body: "none", handler: listStaff },
  { method: "PATCH", pattern: "/api/staff/:id", body: "json", handler: changeAccess },
];
