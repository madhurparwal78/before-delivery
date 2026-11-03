import { useState } from "react";
import { convertSize, isColourName, sizeTokenProblem } from "../../../shared/styles.js";
import type { Token } from "../../../shared/types.js";
import { Icon } from "../../ui/icons.js";
import { useEditor } from "../context.js";
import { CommitInput } from "../StylePanel.js";

const NAME = /^[a-z0-9-]{1,40}$/;

function TokenRow({ token, tokens }: { token: Token; tokens: Token[] }) {
  const { act } = useEditor();
  const rename = (text: string) => {
    const next = text.trim();
    if (!NAME.test(next)) return "Use 1 to 40 lowercase letters, digits or hyphens.";
    if (tokens.some((t) => t.name === next)) return `A token named ${next} already exists.`;
    act.sendToken({ kind: "rename_token", name: token.name, newName: next });
    return null;
  };
  const setValue = (text: string) => {
    const raw = text.trim();
    if (token.kind === "color") {
      if (!isColourName(raw)) return "Enter a CSS colour name such as navy.";
      act.sendToken({ kind: "set_token", name: token.name, value: raw });
      return null;
    }
    const value = Number(raw);
    const problem = raw === "" || !Number.isFinite(value) ? "Enter a number from 0 to 999." : sizeTokenProblem(value, token.unit);
    if (problem) return problem;
    act.sendToken({ kind: "set_token", name: token.name, value, unit: token.unit });
    return null;
  };
  return (
    <tr>
      <td>
        <CommitInput label={`${token.name} name`} stored={token.name} onCommit={rename} className="pl-mono-input" />
      </td>
      <td>
        <span className="pl-token-value">
          {token.kind === "color" && <span className="pl-swatch" style={{ backgroundColor: token.value }} aria-hidden="true" />}
          <CommitInput label={`${token.name} value`} stored={String(token.value)} onCommit={setValue} className="pl-mono-input" />
        </span>
      </td>
      <td>
        {token.kind === "size" ? (
          <select
            className="pl-select"
            aria-label={`${token.name} unit`}
            value={token.unit}
            onChange={(e) => {
              const unit = e.target.value as "px" | "rem";
              act.sendToken({ kind: "set_token", name: token.name, value: convertSize(token.value, token.unit, unit), unit });
            }}
          >
            <option value="px">px</option>
            <option value="rem">rem</option>
          </select>
        ) : (
          <span className="pl-muted pl-mono">colour</span>
        )}
      </td>
      <td>
        <button type="button" className="pl-icon-button" aria-label={`Delete ${token.name}`} title={`Delete ${token.name}`} onClick={() => act.sendToken({ kind: "delete_token", name: token.name })}>
          <Icon name="trash-2" size={14} />
        </button>
      </td>
    </tr>
  );
}

export function TokensPanel() {
  const { state, act } = useEditor();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"color" | "size">("color");
  const [error, setError] = useState<string | null>(null);
  const tokens = state.doc.tokens;
  const add = () => {
    const next = name.trim();
    if (!NAME.test(next)) return setError("Use 1 to 40 lowercase letters, digits or hyphens.");
    if (tokens.some((t) => t.name === next)) return setError(`A token named ${next} already exists.`);
    if (tokens.length >= 40) return setError("A workspace holds at most 40 tokens.");
    act.sendToken(kind === "color" ? { kind: "set_token", name: next, value: "black" } : { kind: "set_token", name: next, value: 16, unit: "px" });
    setName("");
    setError(null);
  };
  return (
    <>
      <table aria-label="Tokens" className="pl-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Value</th>
            <th scope="col">Unit</th>
            <th scope="col">
              <span className="pl-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token, i) => (
            <TokenRow key={i} token={token} tokens={tokens} />
          ))}
        </tbody>
      </table>
      <div className="pl-form-row">
        <span className="pl-commit">
          <input className="pl-input pl-mono-input" aria-label="New token name" value={name} placeholder="token-name" onChange={(e) => (setName(e.target.value), setError(null))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} />
        </span>
        <select className="pl-select" aria-label="New token kind" value={kind} onChange={(e) => setKind(e.target.value as "color" | "size")}>
          <option value="color">Color</option>
          <option value="size">Size</option>
        </select>
        <button type="button" className="pl-button" onClick={add}>
          <Icon name="plus" />
          Add token
        </button>
      </div>
      {error && (
        <p className="pl-inline-error">
          <Icon name="triangle-alert" size={12} />
          {error}
        </p>
      )}
    </>
  );
}
