import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api, type PatternData } from "../lib/api";
import { StitchGrid, WrittenLines } from "../components/Chart";
import { s } from "../../common/copy";

export function PublicPage(props: { id: string }): JSX.Element {
  const [pattern, setPattern] = useState<PatternData | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void api<PatternData>(`/api/public/${props.id}`)
      .then(setPattern)
      .catch(() => setMissing(true));
  }, [props.id]);

  if (missing) {
    return (
      <div className="panel">
        <h1 className="lead">{s.notFound}</h1>
      </div>
    );
  }
  if (!pattern) {
    return (
      <div className="panel">
        <p>{s.loading}</p>
      </div>
    );
  }
  return (
    <>
      <h1 className="lead">{pattern.name}</h1>
      <div className="panel">
        <StitchGrid pattern={pattern} cursor={null} selection={null} peers={{}} readOnly />
      </div>
      <div className="panel">
        <WrittenLines pattern={pattern} readOnly />
      </div>
      <div className="panel">
        <a className="button-primary" role="link" href={`/api/patterns/${props.id}/sheet.pdf`} style={{ display: "inline-block", padding: "8px 16px" }}>
          {s.downloadSheet}
        </a>
      </div>
    </>
  );
}
