import { homeScreen } from "../../shared/types.js";
import { navigate } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { StateScreen } from "../lib/ui.js";

export function NotFound(): JSX.Element {
  const session = useSession();
  return <StateScreen line="That page isn't on the switchyard." button="Back to your desk" onClick={() => navigate(session.user ? homeScreen(session.user.roles) : "/login")} />;
}
