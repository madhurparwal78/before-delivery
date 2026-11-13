import { useEffect, useState } from "react";
import { AdminApp } from "./admin/AdminApp";
import { Storefront } from "./components/Storefront";
import { Loading, ServerError } from "./components/Panel";
import { startLive } from "./lib/live";
import { useReducedMotion } from "./lib/motion";
import { ScrollToTop, usePath } from "./lib/router";
import { boot, useApp } from "./lib/store";
import { renderRoute } from "./routes";

export function App() {
  const path = usePath();
  const { ready } = useApp();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-motion", reduced ? "reduced" : "full");
  }, [reduced]);

  useEffect(() => {
    boot()
      .then(startLive)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <ServerError />;
  if (!ready && !path.startsWith("/checkout/")) return <Loading />;
  return (
    <>
      <ScrollToTop />
      {path.startsWith("/admin") ? <AdminApp /> : <Storefront>{renderRoute(path)}</Storefront>}
    </>
  );
}
