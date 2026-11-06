// One file field and its button. The screen owns the single Upload updates region and progress bar.
import { useId, useRef, useState } from "react";
import { HttpError, Interrupted, NoAnswer } from "../api.js";
import { SIGNED_IN_AGAIN } from "../labels.js";
import { upload } from "../upload.js";

interface UploadProgress {
  value: number | null;
  set: (value: number | null) => void;
}

const UPLOAD_ERRORS: Record<string, string> = {
  report_already_signed: "A signed condition report is already stored for this stay.",
};

export function UploadField<T>({
  label,
  button,
  accept,
  path,
  fields,
  pending,
  success,
  say,
  progress,
  onStored,
}: {
  label: string;
  button: string;
  accept: string;
  path: string;
  fields: [string, string][];
  pending: (fileName: string) => string;
  success: string;
  say: (text: string, tone?: "info" | "error") => void;
  progress: UploadProgress;
  onStored: (answer: T) => void;
}): JSX.Element {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState("");

  const send = async (): Promise<void> => {
    const file = input.current?.files?.[0] ?? null;
    say(pending(file?.name ?? ""));
    progress.set(0);
    try {
      const answer = await upload<T>(path, fields, file, (percent) => progress.set(percent));
      progress.set(100);
      onStored(answer);
      say(success);
      if (input.current) input.current.value = "";
      setChosen("");
      window.setTimeout(() => progress.set(null), 600);
    } catch (error) {
      progress.set(null);
      if (error instanceof NoAnswer) say("The upload was cut off. Nothing was stored; upload it again.", "error");
      else if (error instanceof Interrupted) say(SIGNED_IN_AGAIN);
      else if (error instanceof HttpError) {
        if (error.status === 413) say("That file is too large to upload.", "error");
        else if (error.status === 503) say("Photo storage is unreachable. Nothing was uploaded; try again when the notice clears.", "error");
        else say((error.code && UPLOAD_ERRORS[error.code]) ?? Object.values(error.fields)[0] ?? "", "error");
      }
    }
  };

  return (
    <div className="upload-field">
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <span className="file-picker">
          <input
            ref={input}
            id={id}
            type="file"
            accept={accept}
            className="file-input"
            onChange={(event) => setChosen(event.target.files?.[0]?.name ?? "")}
          />
          <span className="file-picker-button" aria-hidden="true">
            Choose file
          </span>
          <span className="file-picker-name" aria-hidden="true">
            {chosen || "No file chosen"}
          </span>
        </span>
      </div>
      <button type="button" className="button" onClick={() => void send()}>
        {button}
      </button>
    </div>
  );
}

export function ProgressBar({ value }: { value: number | null }): JSX.Element | null {
  if (value === null) return null;
  return (
    <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="progress">
      <span className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}
