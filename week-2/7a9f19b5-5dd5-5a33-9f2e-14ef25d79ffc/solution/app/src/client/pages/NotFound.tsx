import { useEffect } from "react";
import { EmptyDrawing } from "../components/Drawings";
import { Link } from "../lib/router";

export function NotFound() {
  useEffect(() => {
    document.title = "Not found · Lightfall";
  }, []);
  return (
    <div className="not-found empty-state">
      <EmptyDrawing />
      <h1>This page isn't available.</h1>
      <p>It may have moved, or it belongs to an account other than yours.</p>
      <Link href="/catalogue" className="button button--primary">
        Browse the catalogue
      </Link>
    </div>
  );
}
