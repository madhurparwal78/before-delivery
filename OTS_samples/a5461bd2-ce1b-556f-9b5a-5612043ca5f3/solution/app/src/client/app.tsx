import { useEffect } from "react";
import type { Route } from "../shared/routes";
import { isTextEntry } from "./focus";
import { SiteFooter, SiteHeader, SkipLink } from "./layout";
import { CaseStudyPage } from "./pages/case-study";
import { ContactPage } from "./pages/contact";
import { FaqPage } from "./pages/faq";
import { HomePage } from "./pages/home";
import { NotFoundPage } from "./pages/not-found";
import { PricingPage } from "./pages/pricing";
import { ServicesPage } from "./pages/services";
import { StudioPage } from "./pages/studio";
import { WorkPage } from "./pages/work";
import { WorldPage } from "./pages/world";
import { navigate, useRoute } from "./router";

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <HomePage />;
    case "world":
      return <WorldPage world={route.world} />;
    case "work":
      return <WorkPage />;
    case "case-study":
      return <CaseStudyPage project={route.project} />;
    case "services":
      return <ServicesPage service={route.service} />;
    case "studio":
      return <StudioPage />;
    case "pricing":
      return <PricingPage />;
    case "faq":
      return <FaqPage />;
    case "contact":
      return <ContactPage />;
    case "not-found":
      return <NotFoundPage kind={route.kind} />;
  }
}

export function App() {
  const route = useRoute();

  useEffect(() => {
    const leaveWorld = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || route.name !== "world" || event.defaultPrevented) return;
      if (document.querySelector("dialog[open]") || isTextEntry(document.activeElement)) return;
      navigate("/");
    };
    document.addEventListener("keydown", leaveWorld);
    return () => document.removeEventListener("keydown", leaveWorld);
  }, [route]);

  return (
    <>
      <SkipLink />
      <SiteHeader route={route} />
      <main id="main">
        <Page route={route} />
      </main>
      <SiteFooter />
    </>
  );
}
