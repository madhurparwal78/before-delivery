import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { joinedSchema } from "../shared/schemas";
import { Field, Status, Wordmark, describedBy, type StatusMessage } from "./components";
import { ApiFailure, api, fieldErrors } from "./lib/api";
import { rememberSeat } from "./lib/seat";

const copy: Record<string, string> = {
  room_not_found: "No live room has that PIN.",
  nickname_taken: "That nickname is taken in this room.",
  room_full: "This room is full.",
  room_closed: "This night has reached the podium. Joining is closed.",
  validation_failed: "Check the highlighted fields.",
};

export function Join() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [nickname, setNickname] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>({ tone: "idle", text: "" });

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setErrors({});
    setMessage({ tone: "pending", text: "Joining…" });
    try {
      const joined = await api("/api/rooms/join", { method: "POST", body: { pin, nickname }, schema: joinedSchema });
      rememberSeat(joined.rejoinToken);
      navigate(`/play/${joined.roomId}`);
    } catch (error) {
      setErrors(fieldErrors(error));
      const code = error instanceof ApiFailure ? error.body.error : "";
      setMessage({ tone: "error", text: copy[code] ?? "Something went wrong. Try again." });
    }
  }

  return (
    <main className="join">
      <Wordmark size="var(--step-5)" />
      <form className="join-form" onSubmit={(event) => void submit(event)} noValidate>
        <Field id="pin" label="Room PIN" error={errors["pin"]}>
          <input
            id="pin"
            className="join-pin display"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            {...describedBy("pin", errors["pin"])}
          />
        </Field>
        <Field id="nickname" label="Nickname" error={errors["nickname"]}>
          <input id="nickname" autoComplete="nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} {...describedBy("nickname", errors["nickname"])} />
        </Field>
        <button type="submit" className="button-primary join-button" aria-busy={message.tone === "pending"}>
          Join the night
        </button>
        <Status name="Join status" message={message.text} tone={message.tone} />
      </form>
      <footer className="join-foot">
        <Link to="/host/login">Quizmaster sign in</Link>
      </footer>
    </main>
  );
}
