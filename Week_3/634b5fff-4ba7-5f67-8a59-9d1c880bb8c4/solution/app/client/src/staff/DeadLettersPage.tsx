import { useCallback, useEffect, useState } from "react";
import { STAFF_COPY } from "../../../shared/copy.js";
import type { RequestInitJson } from "../api.js";
import { Button, TextField } from "../ui.js";
import { call, failureText, say } from "./desk.js";
import { formatInstant } from "./format.js";
import { StaffList, type Column } from "./List.js";
import type { DeadLetter } from "./types.js";

/** A small drawn match that was never struck: the empty state of the list. */
const UnlitMatch = () => (
  <svg className="staff-match" viewBox="0 0 160 40" role="img" aria-label="An unlit match">
    <path d="M6 20.8 L6 19.2 L136 17 L136 23 Z" className="staff-match__stick" />
    <ellipse cx="143" cy="20" rx="10" ry="8" className="staff-match__head" />
  </svg>
);

export const DeadLettersPage = () => {
  const [events, setEvents] = useState<DeadLetter[]>([]);
  const [listed, setListed] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const reply = await call<{ events: DeadLetter[] }>("GET", "/api/staff/dead-letters");
      setEvents(reply.body.events);
      setListed(true);
      return reply.body.events.length > 0;
    } catch (error) {
      say(failureText(error), true);
      return true;
    }
  }, []);

  useEffect(() => {
    void load().then((hasEvents) => {
      if (!hasEvents) say(STAFF_COPY.noDeadLetters);
    });
  }, [load]);

  const settle = async (path: string, init: RequestInitJson | undefined, done: string): Promise<void> => {
    try {
      await call("POST", path, init);
      say(done);
    } catch (error) {
      say(failureText(error), true);
    }
    await load();
  };

  const columns: Column<DeadLetter>[] = [
    { header: "Event", cell: (event) => <code>{event.eventId}</code> },
    { header: "Type", cell: (event) => event.type },
    { header: "Reference", cell: (event) => event.reference },
    { header: "Box", cell: (event) => event.boxNumber },
    { header: "Failed", cell: (event) => formatInstant(event.failedAt) },
    { header: "Last error", cell: (event) => event.lastError },
    {
      header: "Actions",
      actions: true,
      cell: (event) => (
        <div className="staff-actions">
          <Button onClick={() => void settle(`/api/staff/dead-letters/${event.eventId}/retry`, undefined, STAFF_COPY.retried)}>Retry</Button>
          <TextField
            label="Dismissal note"
            id={`note-${event.eventId}`}
            value={notes[event.eventId] ?? ""}
            onChange={(change) => setNotes({ ...notes, [event.eventId]: change.target.value })}
          />
          <Button onClick={() => void settle(`/api/staff/dead-letters/${event.eventId}/dismiss`, { json: { note: notes[event.eventId] ?? "" } }, STAFF_COPY.dismissed)}>Dismiss</Button>
        </div>
      ),
    },
  ];

  return events.length === 0 && listed
    ? <UnlitMatch />
    : <StaffList label="Dead letters" rows={events} rowKey={(event) => event.eventId} columns={columns} />;
};
