import { useEffect, useState, type ReactNode } from "react";
import type { RuleView } from "../../shared/api.ts";
import { ApiFailure, get } from "../lib/api.ts";
import { useHeadingFocus, useTitle } from "../lib/focus.ts";
import { Link } from "../lib/router.tsx";
import { Loading } from "../ui/Feedback.tsx";
import { ChapterView } from "./Chapter.tsx";
import { NotFound } from "./NotFound.tsx";

/** `/rules/<identifier>`: a live rule shows its chapter with the statement focused; a withdrawn one names its replacement. */
export function RuleScreen({ params }: { params: string[] }): ReactNode {
  const identifier = params[0];
  const [rule, setRule] = useState<RuleView | "missing" | null>(null);
  useEffect(() => {
    get<RuleView>(`/api/rules/${identifier}`).then(setRule, (error: unknown) => {
      if (!(error instanceof ApiFailure) || error.status !== 404) throw error;
      setRule("missing");
    });
  }, [identifier]);
  useTitle(identifier);
  useHeadingFocus(rule !== null && rule !== "missing" && rule.status === "withdrawn");

  if (rule === null) return <Loading />;
  if (rule === "missing") return <NotFound />;
  if (rule.status === "live") return <ChapterView slug={identifier.split(".")[0]} focusId={identifier} />;
  return (
    <div className="cell cell-pad withdrawn" data-frame>
      <h1>{identifier}</h1>
      <p>
        This rule was withdrawn in version {rule.withdrawnInVersion}. It is replaced by <Link to={`/rules/${rule.replacedBy}`}>{rule.replacedBy}</Link>.
      </p>
    </div>
  );
}
