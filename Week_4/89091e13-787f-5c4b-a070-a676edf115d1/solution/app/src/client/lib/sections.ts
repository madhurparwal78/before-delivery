interface Section {
  label: string;
  path: string;
}

export const SECTIONS: Section[] = [
  { label: "Explorer", path: "explorer" },
  { label: "Submit", path: "submit" },
  { label: "Nodes", path: "nodes" },
  { label: "Stake", path: "stake" },
  { label: "Vote", path: "vote" },
];

/** Which workspace section a path belongs to (blob pages belong to the explorer). */
export function currentSection(path: string, workspaceId: string): string | null {
  const rest = path.slice(`/w/${workspaceId}/`.length).split("/")[0];
  if (rest === "blobs") return "explorer";
  return SECTIONS.find((section) => section.path === rest)?.path ?? null;
}
