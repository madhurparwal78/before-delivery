import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type User } from "../api.js";
import { ApiError } from "../api.js";

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }): React.ReactElement {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const data = await api.post<{ user: User }>("/api/session", { email, password });
      const role = data.user.role;
      onSignedIn();
      navigate(role === "owner" ? "/studio" : role === "tech" ? "/board" : "/intake");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? "Email or password is wrong." : err.message);
      } else {
        setError("Email or password is wrong.");
      }
    }
  };

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <h1>Shelfmark</h1>
        <p className="small-note">Brickfield Lane Clayhouse firing desk</p>
        {error ? (
          <div className="banner" role="alert">
            {error}
          </div>
        ) : null}
        <form
          aria-label="Sign in"
          onSubmit={(e) => {
            void submit(e);
          }}
        >
          <div className="field">
            <label htmlFor="signin-email">Email</label>
            <input
              id="signin-email"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="signin-password">Password</label>
            <input
              id="signin-password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="primary" style={{ width: "100%", marginTop: "0.5rem" }}>
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
