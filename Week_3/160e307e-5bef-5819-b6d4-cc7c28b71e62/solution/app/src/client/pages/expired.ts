import type { Mount } from "../router";
import { deniedPage } from "../ui/shell";

/** A used, unknown or expired sign-in link. */
const expired: Mount = ({ root }) => {
  root.replaceChildren(deniedPage("This link has expired"));
  return undefined;
};

export const notFound: Mount = ({ root }) => {
  root.replaceChildren(deniedPage("Page not found"));
  return undefined;
};

export default expired;
