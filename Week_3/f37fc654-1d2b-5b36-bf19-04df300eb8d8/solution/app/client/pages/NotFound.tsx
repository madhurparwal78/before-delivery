import { Missing, useScene } from "./common";

export function NotFound() {
  useScene("working");
  return <Missing />;
}
