// The live region of a page: a notice and its announcement use exactly the same characters.
import { useCallback, useState } from "react";

/** Guest pages keep the latest announcement; the host floor keeps the last few, one element each. */
export function useAnnouncer(keep: number): { messages: { id: number; text: string }[]; announce: (text: string) => void } {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  const announce = useCallback(
    (text: string) => setMessages((current) => [...current, { id: (current.at(-1)?.id ?? 0) + 1, text }].slice(-keep)),
    [keep],
  );
  return { messages, announce };
}

export function LiveRegion({ label, messages }: { label: string; messages: { id: number; text: string }[] }) {
  return (
    <div role="status" aria-label={label} aria-live="polite" className="live-region">
      {messages.map((message) => (
        <p key={message.id}>{message.text}</p>
      ))}
    </div>
  );
}
