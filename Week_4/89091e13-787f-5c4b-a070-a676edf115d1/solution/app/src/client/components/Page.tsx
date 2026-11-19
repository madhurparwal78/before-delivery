import type { ReactNode } from "react";

export function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container page-body">
      <h1 className="page-title">{title}</h1>
      {children}
    </div>
  );
}
