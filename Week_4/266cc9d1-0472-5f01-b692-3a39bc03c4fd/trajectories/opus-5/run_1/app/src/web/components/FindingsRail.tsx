import { useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  assetKindLabel,
  chainage,
  countOf,
  measure,
  statusWord,
} from "../../shared/format.js";
import { NO_FINDINGS_SET, railSummary } from "../../shared/copy.js";
import { Check, ChevronDown, Upload, WarningTriangle } from "./icons.jsx";
import type { Asset, Finding, FindingsSet, Staff } from "../lib/types.js";

export function StatusTag({ status }: { status: "violation" | "clear" }): ReactNode {
  return (
    <span className={status === "violation" ? "tag tag--violation" : "tag tag--clear"}>
      {status === "violation" ? <WarningTriangle /> : <Check />}
      <span>{statusWord(status)}</span>
    </span>
  );
}

export interface RailProps {
  findings: Finding[];
  set: FindingsSet | null;
  staff: Staff;
  assets: Asset[];
  selectedId: string | null;
  nearIds: Set<string>;
  tab: "findings" | "assets";
  expandedAssets: Set<string>;
  onTab: (tab: "findings" | "assets") => void;
  onToggleAsset: (assetId: string) => void;
  onSelect: (findingId: string) => void;
  onOpenEditor: () => void;
  onNewFinding: () => void;
  onUpload: () => void;
  actions: ReactNode;
  startSet: ReactNode;
  readout?: ReactNode;
}

export function FindingsRail(props: RailProps): ReactNode {
  const listbox = useRef<HTMLDivElement | null>(null);
  const isAnalyst = props.staff.role === "vegetation_analyst";
  const isDraft = props.set?.state === "draft";
  const violations = props.findings.filter((finding) => finding.status === "violation").length;

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
    const index = props.findings.findIndex((finding) => finding.id === props.selectedId);
    if (event.key === "Enter") {
      if (index >= 0 && isAnalyst && isDraft) {
        event.preventDefault();
        props.onOpenEditor();
      }
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = index < 0 ? (step === 1 ? 0 : props.findings.length - 1) : index + step;
    if (next < 0 || next >= props.findings.length) return;
    props.onSelect(props.findings[next].id);
  };

  return (
    <div className="rail__inner">
      {props.readout}
      <div className="tabs" role="tablist" aria-label="Rail sections">
        <button
          type="button"
          role="tab"
          id="tab-findings"
          aria-selected={props.tab === "findings"}
          aria-controls="panel-findings"
          tabIndex={props.tab === "findings" ? 0 : -1}
          className="tab"
          onClick={() => props.onTab("findings")}
        >
          Findings
        </button>
        <button
          type="button"
          role="tab"
          id="tab-assets"
          aria-selected={props.tab === "assets"}
          aria-controls="panel-assets"
          tabIndex={props.tab === "assets" ? 0 : -1}
          className="tab"
          onClick={() => props.onTab("assets")}
        >
          Assets
        </button>
      </div>

      {props.tab === "findings" ? (
        <div className="rail__panel" role="tabpanel" id="panel-findings" aria-labelledby="tab-findings">
          {props.set === null ? (
            <p className="rail__empty">{NO_FINDINGS_SET}</p>
          ) : (
            <>
              <p className="rail__summary mono">
                {railSummary(
                  props.set.frozen?.finding_count ?? props.findings.length,
                  props.set.frozen?.violation_count ?? violations,
                )}
              </p>
              <div className="rail__actions">
                {isAnalyst && isDraft ? (
                  <>
                    <button type="button" className="button" onClick={props.onNewFinding}>
                      New finding at playhead
                    </button>
                    <button
                      type="button"
                      className="button"
                      onClick={props.onOpenEditor}
                      disabled={props.selectedId === null}
                    >
                      Edit finding
                    </button>
                  </>
                ) : null}
                {props.actions}
              </div>
              <div
                className="listbox"
                role="listbox"
                aria-label="Findings"
                tabIndex={0}
                ref={listbox}
                onKeyDown={onListKeyDown}
              >
                {props.findings.map((finding) => (
                  <div
                    key={finding.id}
                    role="option"
                    aria-selected={props.selectedId === finding.id}
                    className={
                      props.nearIds.has(finding.id) ? "option option--near" : "option"
                    }
                    onClick={() => props.onSelect(finding.id)}
                  >
                    <span className="option__label mono">{finding.label}</span>
                    <StatusTag status={finding.status} />
                    <span className="mono">{measure(finding.clearance_m)} m</span>
                    <span className="option__span">{finding.span.label}</span>
                    <span className="mono">{chainage(finding.chainage_m)} m</span>
                    {props.nearIds.has(finding.id) ? (
                      <span className="near-tag">Near playhead</span>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
          {props.set === null && props.startSet ? (
            <div className="rail__actions">{props.startSet}</div>
          ) : null}
        </div>
      ) : (
        <div className="rail__panel" role="tabpanel" id="panel-assets" aria-labelledby="tab-assets">
          <section className="assets" aria-label="Survey assets">
            {props.assets.map((asset) => (
              <article key={asset.id} className="asset">
                <p className="asset__line mono">
                  {assetKindLabel(asset.kind)} {"\u00b7"} {countOf(asset.files.length, "file")}{" "}
                  {"\u00b7"}{" "}
                  <span className={`asset__state asset__state--${asset.state}`}>
                    {asset.state === "stored"
                      ? "Stored"
                      : asset.state === "rejected"
                        ? "Rejected"
                        : "Pending"}
                  </span>
                </p>
                <button
                  type="button"
                  className="button button--quiet"
                  aria-expanded={props.expandedAssets.has(asset.id)}
                  onClick={() => props.onToggleAsset(asset.id)}
                >
                  <ChevronDown /> Files
                </button>
                {props.expandedAssets.has(asset.id) ? (
                  <ul className="asset__files">
                    {asset.files.map((file) => (
                      <li key={file.path} className="mono">
                        {file.state === "stored" ? (
                          <a
                            href={`/api/assets/${asset.id}/files/${file.path}?download=1`}
                            download
                          >
                            Download {file.path}
                          </a>
                        ) : (
                          <span>{file.path}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
            {props.staff.role === "survey_processor" ? (
              <button type="button" className="button button--primary" onClick={props.onUpload}>
                <Upload /> Upload assets
              </button>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
