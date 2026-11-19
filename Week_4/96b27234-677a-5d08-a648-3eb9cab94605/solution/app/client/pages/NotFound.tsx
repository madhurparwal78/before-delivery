import { useEffect, useRef } from "react";
import { Link } from "../lib/router";
import { Lantern } from "../ui/Drawings";

/** The denied pages: one heading, an unlit lantern, nothing that says why. Focus lands on the heading. */
export function Denied({ heading }: { heading: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  return (
    <section className="panel denied">
      <Lantern lit={false} size={72} />
      <div>
        <h1 ref={title} tabIndex={-1}>
          {heading}
        </h1>
        <Link to="/" className="button">
          Back to Hearthtile
        </Link>
      </div>
    </section>
  );
}

export const NotFound = () => <Denied heading="Page not found." />;
