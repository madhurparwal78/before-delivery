import { useEffect } from "react";
import { COPY } from "../deck";
import { useField } from "../field";
import { useDocumentTitle } from "../hooks";

export function NotFoundScreen() {
  useDocumentTitle("Not found");
  const field = useField();
  useEffect(() => {
    field.show(null, COPY.unknown);
    return () => field.show(null);
  }, [field]);
  return (
    <>
      <h1>Not found</h1>
      <p className="muted">{COPY.unknown}</p>
    </>
  );
}
