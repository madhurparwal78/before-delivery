import { NotebookPen } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { deckSchema, deckSummarySchema, hostRoomSchema, type DeckSummary } from "../../shared/schemas";
import { Field, Status, describedBy, type StatusMessage } from "../components";
import { ApiFailure, api, fieldErrors } from "../lib/api";
import { HostShell } from "./HostShell";

const decksReply = z.object({ decks: z.array(deckSummarySchema) });
const createdReply = z.object({ deck: deckSchema });
const roomReply = z.object({ room: hostRoomSchema });

export function Decks() {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<DeckSummary[] | null>(null);
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>({ tone: "idle", text: "" });

  const load = useCallback(async () => {
    setDecks((await api("/api/decks", { schema: decksReply })).decks);
  }, []);
  useEffect(() => void load(), [load]);

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault();
    setErrors({});
    setMessage({ tone: "pending", text: "Creating deck…" });
    try {
      await api("/api/decks", { method: "POST", body: { title }, schema: createdReply });
      setTitle("");
      await load();
      setMessage({ tone: "success", text: "Deck created" });
    } catch (error) {
      setErrors(fieldErrors(error));
      setMessage({ tone: "error", text: "Check the deck title." });
    }
  }

  async function openRoom(deck: DeckSummary): Promise<void> {
    setMessage({ tone: "pending", text: "Opening room…" });
    try {
      const { room } = await api("/api/rooms", { method: "POST", body: { deckId: deck.id }, schema: roomReply });
      navigate(`/stage/${room.id}`);
    } catch (error) {
      const empty = error instanceof ApiFailure && error.body.fields?.["deckId"] !== undefined;
      setMessage({ tone: "error", text: empty ? "Add a question before opening a room." : "The room could not be opened. Try again." });
    }
  }

  return (
    <HostShell>
      <div className="page">
        <h1>Your decks</h1>
        <form className="deck-create" onSubmit={(event) => void create(event)} noValidate>
          <Field id="new-deck" label="New deck title" error={errors["title"]}>
            <input id="new-deck" value={title} onChange={(event) => setTitle(event.target.value)} {...describedBy("new-deck", errors["title"])} />
          </Field>
          <button type="submit" className="button-primary" aria-busy={message.tone === "pending"}>
            Create deck
          </button>
        </form>
        <Status name="Decks status" message={message.text} tone={message.tone} />
        {decks === null ? (
          <div className="skeletons" aria-busy="true">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : decks.length === 0 ? (
          <div className="empty">
            <NotebookPen size={72} strokeWidth={1} aria-hidden="true" />
            <p>No decks yet. Name one above to begin.</p>
          </div>
        ) : (
          <ul className="deck-list" aria-label="Decks">
            {decks.map((deck) => (
              <li key={deck.id} className="deck-row panel">
                <Link className="deck-title display" to={`/host/decks/${deck.id}`}>
                  {deck.title}
                </Link>
                <span className="deck-count">{deck.questionCount} questions</span>
                <button type="button" aria-label={`Open room for ${deck.title}`} onClick={() => void openRoom(deck)}>
                  Open room
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </HostShell>
  );
}
