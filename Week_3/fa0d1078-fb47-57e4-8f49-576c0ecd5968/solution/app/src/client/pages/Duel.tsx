import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import { LEVELS, LEVEL_NAMES, type Level } from "../../shared/levels";
import type { Room } from "../../shared/protocol";
import { ApiFailure, get, post } from "../api";
import { announce } from "../announcer";
import { M40, M56 } from "../messages";
import { navigate } from "../router";

const JOIN_ERRORS: Record<string, string> = {
  NOT_VERIFIED: "Confirm your email to join duels.",
  RATE_LIMITED: "Too many tries. Wait a minute and try again.",
  ROOM_NOT_FOUND: "No room has that code.",
  ROOM_FULL: "This room already has two players.",
};

/** Codes are typed in lower case with spaces or hyphens; they show in upper case without them. */
const tidy = (value: string): string => value.replace(/[\s-]/g, "").toUpperCase();

export function Duel(): JSX.Element {
  const [level, setLevel] = useState<Level>("easy");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useLayoutEffect(() => {
    get<{ status: string; down?: string[] }>("/api/health").then(
      (health) => {
        if (health.down?.includes("valkey")) {
          setUnavailable(true);
          announce(M40);
        }
      },
      () => undefined,
    );
  }, []);

  const enter = (request: () => Promise<{ room: Room }>): void => {
    if (pending) return;
    setPending(true);
    setFieldError(null);
    announce("Opening the room.");
    request().then(
      ({ room }) => navigate(`/duel/${room.code}`),
      (error: unknown) => {
        setPending(false);
        const failure = error instanceof ApiFailure ? error : new ApiFailure(0, "NETWORK");
        if (failure.code === "LIVE_UNAVAILABLE") {
          setUnavailable(true);
          announce(M40);
          return;
        }
        const sentence = JOIN_ERRORS[failure.code] ?? M56;
        setFieldError(sentence);
        announce(sentence);
      },
    );
  };

  return (
    <section class="duel">
      <h1 class="page-title">Duel</h1>
      {unavailable && (
        <p id="duel-notice" class="voice-line">
          {M40}
        </p>
      )}
      <div class="tile duel-tile">
        <div role="radiogroup" aria-label="Level" class="levels">
          {LEVELS.map((name) => (
            <label key={name} class="radio">
              <input type="radio" name="level" value={name} checked={level === name} onChange={() => setLevel(name)} />
              <span>{LEVEL_NAMES[name]}</span>
            </label>
          ))}
        </div>
        <button type="button" class="button" disabled={unavailable} aria-disabled={pending ? "true" : undefined} onClick={() => enter(() => post<{ room: Room }>("/api/duels", { level }))}>
          Create room
        </button>
        <form
          class="join"
          onSubmit={(event) => {
            event.preventDefault();
            enter(() => post<{ room: Room }>("/api/duels/join", { code }));
          }}
        >
          <div class="field">
            <label for="field-code">Room code</label>
            <input
              id="field-code"
              type="text"
              value={code}
              autoComplete="off"
              spellcheck={false}
              aria-invalid={fieldError ? "true" : undefined}
              aria-describedby={fieldError ? "field-code-error" : undefined}
              onInput={(event) => setCode(tidy(event.currentTarget.value))}
            />
            {fieldError && (
              <p class="field-error" id="field-code-error">
                {fieldError}
              </p>
            )}
          </div>
          <button type="submit" class="button" disabled={unavailable} aria-disabled={pending ? "true" : undefined}>
            Join room
          </button>
        </form>
      </div>
    </section>
  );
}
