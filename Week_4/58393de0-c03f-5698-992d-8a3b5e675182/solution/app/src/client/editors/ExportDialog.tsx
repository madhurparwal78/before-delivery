import { useEffect, useId, useState } from "react";
import { copy } from "../../shared/copy";
import { MM_PER_INCH } from "../../shared/limits";
import { exportFileName } from "../../shared/rules";
import type { ExportFormat, ExportRecord, ExportUnit, Vec3 } from "../../shared/types";
import { geometryJob } from "../geometry";
import { api, ApiError } from "../lib/api";
import { useNotices } from "../lib/notices";
import { useStatus } from "../lib/status";
import { Dialog } from "../ui/Dialog";
import type { ExportSource } from "./contract";
import { NOTICE } from "./useEditorSession";

export type ExportPhase = "idle" | "working" | "done" | "failed";

/** What the hidden `#qy-export` element publishes. */
export interface ExportReport {
  state: ExportPhase;
  format: ExportFormat;
  unit: ExportUnit;
  triangleCount: number | null;
  bytes: number | null;
}

interface ExportDialogProps {
  source: ExportSource;
  open: boolean;
  /** The project name the file name comes from. */
  name: string;
  /** The project the stored export is attached to; none for a design that was never saved. */
  projectId: string | null;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  onReport: (report: ExportReport) => void;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "stl", label: "STL" },
  { value: "obj", label: "OBJ" },
  { value: "svg", label: "SVG" },
];
const UNITS: { value: ExportUnit; label: string }[] = [
  { value: "mm", label: "Millimetres" },
  { value: "in", label: "Inches" },
];

function handToBrowser(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Mounted afresh for every opening, so a new opening starts from the defaults for this project kind. */
export function ExportDialog({ source, open, name, projectId, onClose, returnFocus, onReport }: ExportDialogProps) {
  const { announce } = useStatus();
  const { setNotice, clearNotice } = useNotices();
  const circuit = source.kind === "circuit";
  const formatLabel = useId();
  const unitLabel = useId();
  const [format, setFormat] = useState<ExportFormat>(circuit ? "svg" : "stl");
  const [unit, setUnit] = useState<ExportUnit>("mm");
  /** Extents in millimetres; undefined while the worker measures, null when there is no solid. */
  const [size, setSize] = useState<Vec3 | null | undefined>(undefined);
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [built, setBuilt] = useState<{ triangleCount: number | null; bytes: number } | null>(null);

  useEffect(() => {
    if (source.kind === "circuit") return undefined;
    let cancelled = false;
    void geometryJob("summariseDesign", source.objects).then((summary) => {
      if (!cancelled) setSize(summary.empty ? null : summary.size);
    });
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    onReport({ state: phase, format, unit, triangleCount: built?.triangleCount ?? null, bytes: built?.bytes ?? null });
  }, [onReport, phase, format, unit, built]);

  const empty = source.kind === "circuit" ? source.snapshot.components.length === 0 : size === null;
  const ready = source.kind === "circuit" ? !empty : size !== undefined && size !== null;
  const inUnit = (mm: number) => (unit === "in" ? mm / MM_PER_INCH : mm);
  let sizeLine: string | null = null;
  if (source.kind === "circuit") sizeLine = copy.sizeLineCircuit;
  else if (size) sizeLine = copy.sizeLine([inUnit(size[0]), inUnit(size[1]), inUnit(size[2])], unit);

  const download = async () => {
    const file = exportFileName(name, format);
    clearNotice(NOTICE.exportFailed);
    setPhase("working");
    setBuilt(null);
    announce(copy.preparing(file));
    try {
      const output = source.kind === "circuit" ? await geometryJob("buildCircuitFile", source.snapshot) : await geometryJob("buildDesignFile", { objects: source.objects, format, unit });
      setBuilt({ triangleCount: output.triangleCount, bytes: output.bytes.length });
      const query = new URLSearchParams({ format, unit, name: file });
      if (projectId) query.set("projectId", projectId);
      const stored = await api.upload<ExportRecord>(`/api/exports?${query.toString()}`, output.bytes);
      handToBrowser(await api.download(stored.downloadUrl), stored.fileName);
      setPhase("done");
      onClose();
      announce(copy.exported(stored.fileName, stored.unit));
      announce(copy.savedToLibrary);
    } catch (error) {
      setPhase("failed");
      if (error instanceof ApiError && error.code === "storage_unavailable") setNotice({ id: NOTICE.exportFailed, message: copy.exportStorage });
      else if (error instanceof ApiError && error.code === "mesh_not_closed") announce(copy.meshNotClosed);
      else if (error instanceof ApiError && error.code === "email_unverified") announce(copy.unverifiedExport);
      else announce(error instanceof ApiError ? error.message : copy.serverError);
    }
  };

  return (
    <Dialog open={open} title="Export" onClose={onClose} returnFocus={returnFocus} className="export-dialog">
      <div className="field">
        <span className="label" id={formatLabel}>Format</span>
        <div className="radio-row" role="radiogroup" aria-labelledby={formatLabel}>
          {FORMATS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="export-format"
                checked={format === option.value}
                disabled={circuit && option.value !== "svg"}
                onChange={() => setFormat(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="label" id={unitLabel}>Unit</span>
        <div className="radio-row" role="radiogroup" aria-labelledby={unitLabel}>
          {UNITS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="export-unit"
                checked={unit === option.value}
                disabled={circuit && option.value !== "mm"}
                onChange={() => setUnit(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      {empty ? (
        <p className="export-size">{circuit ? copy.nothingToExportCircuit : copy.nothingToExport3d}</p>
      ) : (
        <p className="export-size figures">{sizeLine}</p>
      )}
      <div className="dialog-actions">
        <button type="button" className="pill" disabled={!ready || phase === "working"} onClick={() => void download()}>Download</button>
        <button type="button" className="pill pill--outline" onClick={onClose}>Cancel</button>
      </div>
    </Dialog>
  );
}
