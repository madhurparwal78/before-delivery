// A named polite live region; every async action writes its pending, success, error or outage copy here.

type Tone = "neutral" | "success" | "error";

export interface StatusMessage {
  tone: Tone;
  text: string;
}

export const quiet: StatusMessage = { tone: "neutral", text: "" };

export function Status({ name, message, className }: { name: string; message: StatusMessage; className?: string }) {
  return (
    <p role="status" aria-live="polite" aria-label={name} className={`status status-${message.tone} ${className ?? ""}`}>
      {message.text}
    </p>
  );
}
