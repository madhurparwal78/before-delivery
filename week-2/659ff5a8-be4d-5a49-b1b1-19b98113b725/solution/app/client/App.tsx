import { useEffect } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { EventFrame } from "./components/EventFrame.js";
import { Skeleton } from "./components/ui.js";
import { Events } from "./pages/Events.js";
import { IndexTables } from "./pages/IndexTables.js";
import { Join } from "./pages/Join.js";
import { Operator } from "./pages/Operator.js";
import { Season } from "./pages/Season.js";
import { SignIn } from "./pages/SignIn.js";
import { useNavigation } from "./router.js";
import { useSession } from "./session.js";

export function App() {
  const { route, navigate } = useNavigation();
  const { user, ready } = useSession();
  const isOperator = user?.roles.includes("operator") ?? false;
  const open = route.name === "signin" || route.name === "join";

  useEffect(() => {
    if (!ready) return;
    if (!user && !open) navigate("/signin", true);
    else if (user && route.name === "operator" && !isOperator) navigate("/events", true);
    else if (user && isOperator && route.name !== "operator" && !open) navigate("/operator", true);
    else if (route.name === "unknown") navigate(user ? "/events" : "/signin", true);
  }, [ready, user, open, isOperator, route.name, navigate]);

  if (!ready) return <Skeleton />;
  if (open) return route.name === "join" ? <Join slug={route.slug} /> : <SignIn />;
  if (!user) return null;
  if (route.name === "event") return <EventFrame id={route.id} section={route.section} />;
  return (
    <>
      <AppHeader />
      <main className="main" id="main">
        {route.name === "events" && <Events />}
        {route.name === "index-tables" && <IndexTables />}
        {route.name === "season" && <Season />}
        {route.name === "operator" && <Operator />}
      </main>
    </>
  );
}
