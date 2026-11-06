import type { Route } from "../http/routes";
import { registerRoutes } from "../http/routes";
import * as session from "./session";
import * as invites from "./invites";
import * as studio from "./studio";
import * as pieces from "./pieces";
import * as loads from "./loads";
import * as credit from "./credit";
import * as members from "./members";
import * as reports from "./reports";

const routes: Route[] = [
  { method: "POST", pattern: "/api/session", auth: "any", bodyKind: "json", handler: session.postSession },
  { method: "GET", pattern: "/api/me", auth: "signed_in", bodyKind: "none", handler: session.getMe },
  { method: "DELETE", pattern: "/api/session", auth: "signed_in", bodyKind: "json", handler: session.deleteSession },

  { method: "GET", pattern: "/api/studio", auth: "signed_in", bodyKind: "none", handler: studio.getStudio },
  { method: "PUT", pattern: "/api/studio/settings", auth: "owner", bodyKind: "json", handler: studio.putSettings },
  { method: "POST", pattern: "/api/invites", auth: "owner", bodyKind: "json", handler: invites.postInvite },
  { method: "GET", pattern: "/api/invites/{token}", auth: "any", bodyKind: "none", handler: invites.getInvite },
  { method: "POST", pattern: "/api/invites/{token}/accept", auth: "any", bodyKind: "json", handler: invites.acceptInvite },
  { method: "GET", pattern: "/api/clay-bodies", auth: "signed_in", bodyKind: "none", handler: studio.getClayBodies },
  { method: "GET", pattern: "/api/kilns", auth: "staff", bodyKind: "none", handler: studio.getKilns },
  { method: "GET", pattern: "/api/credit-packs", auth: "signed_in", bodyKind: "none", handler: studio.getCreditPacks },
  { method: "POST", pattern: "/api/quotes", auth: "member", bodyKind: "json", handler: studio.postQuote },
  { method: "GET", pattern: "/api/rate-schedules", auth: "owner", bodyKind: "none", handler: studio.getRateSchedules },
  { method: "POST", pattern: "/api/rate-schedules", auth: "owner", bodyKind: "json", handler: studio.postRateSchedule },

  { method: "POST", pattern: "/api/pieces", auth: "member", bodyKind: "json", handler: pieces.postPiece },
  { method: "GET", pattern: "/api/pieces", auth: "signed_in", bodyKind: "none", handler: pieces.listPieces },
  { method: "PUT", pattern: "/api/pieces/{id}/photo", auth: "signed_in", bodyKind: "photo", handler: pieces.putPhoto },
  { method: "GET", pattern: "/api/pieces/{id}/photo", auth: "signed_in", bodyKind: "none", handler: pieces.getPhoto },
  { method: "POST", pattern: "/api/pieces/{id}/check-in", auth: "staff", bodyKind: "json", handler: pieces.checkIn },
  { method: "POST", pattern: "/api/pieces/{id}/collect", auth: "staff", bodyKind: "json", handler: pieces.collect },
  { method: "POST", pattern: "/api/pieces/{id}/mark-uncollected", auth: "staff", bodyKind: "json", handler: pieces.markUncollected },
  { method: "GET", pattern: "/api/pieces/{id}", auth: "signed_in", bodyKind: "none", handler: pieces.getPiece },

  { method: "POST", pattern: "/api/loads", auth: "staff", bodyKind: "json", handler: loads.postLoad },
  { method: "GET", pattern: "/api/loads", auth: "staff", bodyKind: "none", handler: loads.listLoads },
  { method: "POST", pattern: "/api/loads/{id}/decks", auth: "staff", bodyKind: "json", handler: loads.addDeck },
  { method: "DELETE", pattern: "/api/loads/{id}/decks/{number}", auth: "staff", bodyKind: "none", handler: loads.removeDeck },
  { method: "POST", pattern: "/api/loads/{id}/placements", auth: "staff", bodyKind: "json", handler: loads.postPlacement },
  { method: "POST", pattern: "/api/loads/{id}/moves", auth: "staff", bodyKind: "json", handler: loads.postMove },
  { method: "DELETE", pattern: "/api/loads/{id}/placements/{piece_id}", auth: "staff", bodyKind: "none", handler: loads.deletePlacement },
  { method: "POST", pattern: "/api/loads/{id}/status", auth: "staff", bodyKind: "json", handler: loads.postStatus },
  { method: "POST", pattern: "/api/loads/{id}/unload", auth: "staff", bodyKind: "json", handler: loads.postUnload },
  { method: "GET", pattern: "/api/loads/{id}", auth: "staff", bodyKind: "none", handler: loads.getLoad },

  { method: "GET", pattern: "/api/me/credit", auth: "member", bodyKind: "none", handler: credit.getCredit },
  { method: "POST", pattern: "/api/credit-packs/{id}/purchase", auth: "member", bodyKind: "json", handler: credit.purchasePack },

  { method: "GET", pattern: "/api/members", auth: "owner", bodyKind: "none", handler: members.listMembers },
  { method: "POST", pattern: "/api/members/{id}/deactivate", auth: "signed_in", bodyKind: "json", handler: members.deactivateMember },
  { method: "POST", pattern: "/api/members/{id}/reactivate", auth: "signed_in", bodyKind: "json", handler: members.reactivateMember },
  { method: "POST", pattern: "/api/members/{id}/adjustments", auth: "signed_in", bodyKind: "json", handler: members.postAdjustment },
  { method: "GET", pattern: "/api/members/{id}", auth: "signed_in", bodyKind: "none", handler: members.getMember },

  { method: "POST", pattern: "/api/charges/{id}/refund", auth: "signed_in", bodyKind: "json", handler: members.refundChargeRoute },

  { method: "GET", pattern: "/api/dashboard", auth: "owner", bodyKind: "none", handler: reports.getDashboard },
  { method: "GET", pattern: "/api/reports/revenue", auth: "owner", bodyKind: "none", handler: reports.getRevenue },
  { method: "POST", pattern: "/api/reports/months/{month}/close", auth: "owner", bodyKind: "json", handler: reports.closeMonth },
  { method: "GET", pattern: "/api/reports/statement.csv", auth: "owner", bodyKind: "none", handler: reports.getStatement },
  { method: "GET", pattern: "/api/firing-log", auth: "owner", bodyKind: "none", handler: reports.getFiringLog },
];

registerRoutes(routes);
