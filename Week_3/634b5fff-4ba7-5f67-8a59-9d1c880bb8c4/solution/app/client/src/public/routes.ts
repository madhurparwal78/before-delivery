import { EDITION } from "../../../shared/domain.js";

/** The public routes: the story (with the shelf behind `/shelf`) and the sheets. */

export type View =
  | { kind: "story"; shelf: boolean }
  | { kind: "box"; number: number }
  | { kind: "checkout" }
  | { kind: "order"; reference: string }
  | { kind: "lookup" }
  | { kind: "missing" };

export const viewOf = (pathname: string): View => {
  if (pathname === "/") return { kind: "story", shelf: false };
  if (pathname === "/shelf") return { kind: "story", shelf: true };
  if (pathname === "/checkout") return { kind: "checkout" };
  if (pathname === "/lookup") return { kind: "lookup" };
  const box = /^\/box\/(\d+)$/.exec(pathname);
  if (box) {
    const number = Number(box[1]);
    return number >= 1 && number <= EDITION ? { kind: "box", number } : { kind: "missing" };
  }
  const order = /^\/order\/([A-Za-z0-9-]+)$/.exec(pathname);
  if (order && order[1]) return { kind: "order", reference: order[1] };
  return { kind: "missing" };
};
