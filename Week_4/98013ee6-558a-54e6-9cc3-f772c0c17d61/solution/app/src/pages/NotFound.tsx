import { EmptyPrint } from "../ui/Prints";

export type NotFoundHeading = "Board not found" | "Pin not found" | "Page not found";

/** The not-found view: the heading and one lit procedural print. Hidden records look exactly like missing ones. */
export function NotFound({ heading, titleId }: { heading: NotFoundHeading; titleId?: string }) {
  return (
    <section className="empty-state">
      <EmptyPrint seed={heading} />
      <h1 id={titleId} className="empty-title">{heading}</h1>
    </section>
  );
}
