import { BUILT_IN_LAYOUTS } from "../../shared/layout.ts";
import { AirfieldMap } from "../components/map.tsx";
import { useLitRun } from "../litrun.ts";
import { useReducedMotion } from "../me.ts";
import { Link } from "../router.tsx";
import { SignInForm } from "./auth.tsx";

const CLEARANCE = "GABCD TAXI HP A1 VIA A";
/** The route the literal clearance lights on the Wrenfield schematic. */
const DEMO_ROUTE = ["S1T", "W1", "A4", "A3", "A2"];
const NOTICE = "Training only. Fictional aerodromes. Not for real air traffic control.";

export function Landing() {
  const reduced = useReducedMotion();
  const run = useLitRun(DEMO_ROUTE, "A1", reduced);
  const wrenfield = BUILT_IN_LAYOUTS.wrenfield;
  return (
    <div class="landing">
      <main class="hero" aria-labelledby="hero-title">
        <h1 id="hero-title" class="hero-title">
          Type the taxi. See the line.
        </h1>
        <p class="hero-clearance mono">{CLEARANCE}</p>
        {wrenfield && (
          <div class="hero-map">
            <AirfieldMap
              name="Wrenfield schematic"
              layout={wrenfield}
              aircraft={[]}
              closed={false}
              litPreview={run.lit}
              litAccepted={[]}
              conflicts={[]}
              stopBars={run.stopBar ? [run.stopBar] : []}
              selected={null}
              emergency={null}
              glideMs={0}
              mirror="hidden"
            />
          </div>
        )}
        <Link href="/signup" class="hero-cta">
          Open your school
        </Link>
      </main>
      <section class="screen-two" aria-labelledby="screen-two-title">
        <h2 id="screen-two-title" class="screen-two-title">
          Every clearance has a <span class="bar">second</span> it was given.
        </h2>
        <p class="screen-two-notice" role="contentinfo">
          {NOTICE}
        </p>
        <Link href="/signup" class="screen-two-link">
          Create an account
        </Link>
      </section>
      <section class="sheet" aria-labelledby="sheet-title">
        <div class="sheet-inner">
          <h2 id="sheet-title">Sign in</h2>
          <SignInForm />
        </div>
      </section>
    </div>
  );
}
