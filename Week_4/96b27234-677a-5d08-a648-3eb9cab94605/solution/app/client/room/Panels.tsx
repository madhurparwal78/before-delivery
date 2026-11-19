import { useRef, useState, type FormEvent } from "react";
import type { ChatMessage, FeatureView, PersonView } from "../../shared/protocol";
import type { Result } from "../lib/useAction";
import { Chip, Status } from "../ui/Bits";
import { Icon } from "../ui/Icon";

export function PeopleList({ people, selfId, onActions }: { people: PersonView[]; selfId: string; onActions: (person: PersonView, opener: HTMLElement) => void }) {
  return (
    <section aria-labelledby="people-heading">
      <h2 id="people-heading">People here</h2>
      <ul aria-label="People here" className="cards compact">
        {people.map((person) => (
          <li
            key={person.personId}
            data-person-id={person.personId}
            data-display-name={person.displayName}
            data-tile-x={person.x}
            data-tile-y={person.y}
            data-facing={person.facing}
            data-seated={String(person.seated)}
            data-avatar={person.avatar}
            data-host={String(person.host)}
            className="row-card"
          >
            <div>
              <strong>{person.displayName}</strong>
              {person.personId === selfId ? <span className="muted"> (you)</span> : null}
              <div className="row tight">
                {person.host ? <Chip tone="accent">host</Chip> : null}
                <span className="muted">
                  tile {person.x}, {person.y}, facing {person.facing}
                  {person.seated ? ", seated" : ""}
                </span>
              </div>
            </div>
            <button type="button" className="button" aria-label={`Actions for ${person.displayName}`} onClick={(event) => onActions(person, event.currentTarget)}>
              Actions
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FeatureList({ features, people }: { features: FeatureView[]; people: PersonView[] }) {
  return (
    <section aria-labelledby="features-heading">
      <h2 id="features-heading">Room features</h2>
      <ul aria-label="Room features" className="cards compact">
        {features.map((feature) => {
          const holder = people.find((person) => person.personId === feature.occupiedBy);
          return (
            <li key={feature.id} data-feature-id={feature.id} data-kind={feature.kind} data-tile-x={feature.x} data-tile-y={feature.y} data-occupied-by={feature.occupiedBy ?? ""} className="row-card">
              <div>
                <strong>{feature.kind === "exit" ? "Exit" : "Seat"}</strong> <span className="muted">{feature.id} at tile {feature.x}, {feature.y}</span>
                {feature.kind === "seat" ? <div className="muted">{holder ? `Taken by ${holder.displayName}` : "Free"}</div> : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ChatPanel({
  chat,
  result,
  send,
  onFieldFocus,
  fieldRef,
}: {
  chat: ChatMessage[];
  result: Result;
  send: (text: string) => Promise<boolean>;
  onFieldFocus: (previous: HTMLElement | null) => void;
  fieldRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState("");
  const busy = useRef(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    const sent = await send(text);
    busy.current = false;
    if (sent) setText("");
  };
  return (
    <section aria-labelledby="chat-heading" className="chat">
      <h2 id="chat-heading">Nearby chat</h2>
      <div role="log" aria-label="Nearby chat" className="chat-log">
        {chat.map((message) => (
          <p key={message.id}>
            {message.fromName}: {message.text}
          </p>
        ))}
      </div>
      <form onSubmit={submit} className="chat-form">
        <input
          ref={fieldRef}
          type="text"
          aria-label="Say something nearby"
          autoComplete="off"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={(event) => onFieldFocus(event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null)}
          placeholder="Say something nearby"
        />
        <button type="submit" className="button primary">
          <Icon name="send" size={18} /> Send
        </button>
      </form>
      <Status name="Chat result" result={result} />
    </section>
  );
}
