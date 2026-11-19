import { Download } from "lucide-react";
import { formatInZone } from "../../shared/rules";
import type { ExportRecord } from "../../shared/types";
import "./projects.css";

function size(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** The `My exports` list: one `Download <file>` link per stored export. */
export function ExportsList({ exports, zone }: { exports: ExportRecord[]; zone?: string }) {
  return (
    <ul className="export-list" aria-label="My exports">
      {exports.map((file) => (
        <li className="card export-item" key={file.id}>
          <a className="export-link" href={file.downloadUrl} download={file.fileName}>
            <Download size={18} aria-hidden="true" />
            Download {file.fileName}
          </a>
          <span className="hint figures">
            {file.format.toUpperCase()} · {file.unit === "mm" ? "millimetres" : "inches"} · {size(file.bytes)} · {formatInZone(file.createdAt, zone)}
          </span>
        </li>
      ))}
    </ul>
  );
}
