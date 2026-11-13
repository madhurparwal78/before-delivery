import { type KeyboardEvent, useEffect, useState } from "react";

const PAUSE_MS = 333;

/** A search box's query: applied a third of a second after typing pauses, or at once on Enter. */
export function useSearch(): {
  text: string;
  query: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
} {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (text === query) return;
    const id = setTimeout(() => setQuery(text), PAUSE_MS);
    return () => clearTimeout(id);
  }, [text, query]);
  return {
    text,
    query,
    onChange: (value) => {
      setText(value);
      if (value === "") setQuery("");
    },
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        setQuery(event.currentTarget.value);
      }
    },
  };
}
