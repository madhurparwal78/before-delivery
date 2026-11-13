export type Route =
  | { name: "landing" }
  | { name: "sign-in" }
  | { name: "sign-up" }
  | { name: "new-workspace" }
  | { name: "workspace"; wid: string }
  | { name: "project"; wid: string; pid: string }
  | { name: "editor"; wid: string; sid: string }
  | { name: "settings"; wid: string }
  | { name: "activity"; wid: string }
  | { name: "invite"; token: string }
  | { name: "lab"; token: string }
  | { name: "view-project"; token: string }
  | { name: "view-scene"; token: string; sid: string }
  | { name: "not-found" };

const ID = "([A-Za-z0-9_-]+)";
const TABLE: Array<[RegExp, (m: RegExpMatchArray) => Route]> = [
  [/^\/$/, () => ({ name: "landing" })],
  [/^\/sign-in$/, () => ({ name: "sign-in" })],
  [/^\/sign-up$/, () => ({ name: "sign-up" })],
  [/^\/workspaces\/new$/, () => ({ name: "new-workspace" })],
  [new RegExp(`^/w/${ID}$`), (m) => ({ name: "workspace", wid: m[1] })],
  [new RegExp(`^/w/${ID}/p/${ID}$`), (m) => ({ name: "project", wid: m[1], pid: m[2] })],
  [new RegExp(`^/w/${ID}/s/${ID}$`), (m) => ({ name: "editor", wid: m[1], sid: m[2] })],
  [new RegExp(`^/w/${ID}/settings$`), (m) => ({ name: "settings", wid: m[1] })],
  [new RegExp(`^/w/${ID}/activity$`), (m) => ({ name: "activity", wid: m[1] })],
  [new RegExp(`^/invite/${ID}$`), (m) => ({ name: "invite", token: m[1] })],
  [new RegExp(`^/lab/${ID}$`), (m) => ({ name: "lab", token: m[1] })],
  [new RegExp(`^/view/${ID}$`), (m) => ({ name: "view-project", token: m[1] })],
  [new RegExp(`^/view/${ID}/s/${ID}$`), (m) => ({ name: "view-scene", token: m[1], sid: m[2] })],
];

export function matchRoute(pathname: string): Route {
  for (const [pattern, build] of TABLE) {
    const found = pathname.match(pattern);
    if (found) return build(found);
  }
  return { name: "not-found" };
}
