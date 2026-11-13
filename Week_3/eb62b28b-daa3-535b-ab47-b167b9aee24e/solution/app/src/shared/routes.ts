// The published screens. The server answers 404 for any other path; the browser router reads the same list.

const SCREENS = {
  home: "/",
  plans: "/plans",
  markers: "/markers",
  join: "/join",
  signIn: "/signin",
  memberHome: "/me",
  membership: "/me/membership",
  memberDraws: "/me/draws",
  memberDraw: "/me/draws/:drawId",
  memberResults: "/me/results",
  memberPlan: "/me/plan",
  memberMessages: "/me/messages",
  records: "/me/records",
  account: "/me/account",
  receipt: "/receipts/:receiptId",
  members: "/staff/members",
  memberRecord: "/staff/members/:memberId",
  memberResultsStaff: "/staff/members/:memberId/results",
  memberPlanStaff: "/staff/members/:memberId/plan",
  planPage: "/staff/members/:memberId/plans/:planId",
  blend: "/staff/members/:memberId/blend",
  blendPage: "/staff/members/:memberId/blends/:blendId",
  memberMessagesStaff: "/staff/members/:memberId/messages",
  careMessages: "/staff/messages",
  calendar: "/staff/calendar",
  staffDraw: "/staff/draws/:drawId",
  resultsToRelease: "/staff/results",
  ranges: "/staff/ranges",
  receipts: "/staff/receipts",
  team: "/staff/team",
  visit: "/visit/:token",
} as const;

type ScreenName = keyof typeof SCREENS;

export interface ScreenMatch {
  name: ScreenName;
  params: Map<string, string>;
}

function matchPattern(pattern: string, path: string): Map<string, string> | null {
  const want = pattern.split("/");
  const got = path.split("/");
  if (want.length !== got.length) return null;
  const params = new Map<string, string>();
  for (const [index, piece] of want.entries()) {
    const value = got[index] ?? "";
    if (piece.startsWith(":")) {
      if (!value) return null;
      params.set(piece.slice(1), decodeURIComponent(value));
    } else if (piece !== value) {
      return null;
    }
  }
  return params;
}

function isScreenName(key: string): key is ScreenName {
  return key in SCREENS;
}

export function matchScreen(path: string): ScreenMatch | null {
  for (const [name, pattern] of Object.entries(SCREENS)) {
    const params = matchPattern(pattern, path);
    if (params && isScreenName(name)) return { name, params };
  }
  return null;
}
