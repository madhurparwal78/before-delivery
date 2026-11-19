import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { ClassroomExport } from "../../shared/types";
import { api } from "../lib/api";
import { useStreamEvent, useStreamOpen } from "../lib/stream";

const sizeText = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);

/** Every Student export of the classroom, newest first, each downloadable by the Educator. */
export function HandInFiles({ classroomId }: { classroomId: string }) {
  const [files, setFiles] = useState<ClassroomExport[] | null>(null);

  const load = useCallback(() => {
    api.get<{ exports: ClassroomExport[] }>(`/api/classrooms/${classroomId}/exports`).then(
      (body) => setFiles([...body.exports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
      () => setFiles((current) => current ?? []),
    );
  }, [classroomId]);

  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);
  useStreamOpen(load);
  useStreamEvent("project-handed-in", load);
  useStreamEvent("classroom-state", load);
  useStreamEvent("student-removed", load);

  return (
    <section className="roster-section" aria-labelledby="hand-in-files-heading">
      <h2 id="hand-in-files-heading">Hand-in files</h2>
      {files?.length === 0 ? <p className="hint">Files your Students export will be listed here.</p> : null}
      <ul className="file-list" aria-label="Hand-in files">
        {(files ?? []).map((file) => (
          <li key={file.id} className="file-row">
            <span className="file-owner">{file.nickname}</span>
            <a className="file-link" href={file.downloadUrl} download={file.fileName}>
              <Download size={18} aria-hidden="true" />Download {file.fileName}
            </a>
            <span className="hint">{file.format.toUpperCase()} · {file.unit} · {sizeText(file.bytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
