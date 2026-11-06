// One stroke icon set, drawn for this app (24-unit grid, 1.5 stroke, round joins). Always decorative.

const PATHS = {
  image: "M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17 M15.5 9.5a1.5 1.5 0 1 0 0-.01",
  video: "M3.5 6.5h12v11h-12z M15.5 10.5l5-3v9l-5-3",
  audio: "M4 10v4 M8 7v10 M12 4v16 M16 8v8 M20 11v2",
  upload: "M12 15V4 M7.5 8.5 12 4l4.5 4.5 M5 15v5h14v-5",
  close: "M6 6l12 12 M18 6 6 18",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  catalogue: "M4 5h7v6H4z M13 5h7v6h-7z M4 13h7v6H4z M13 13h7v6h-7z",
  run: "M7 5l12 7-12 7z",
  jobs: "M5 6h14 M5 12h14 M5 18h9",
  library: "M4 4h6v16H4z M10 4h4v16h-4z M15 5l3.6-1 3 15.4-3.6 1z",
  webhooks: "M9 7a3 3 0 1 1 3 3l-3.5 6 M15 17a3 3 0 1 1 0-.01 M9.5 17h5 M6 17a3 3 0 1 1 1.5-2.6",
  finance: "M4 7h16v11H4z M4 11h16 M8 15h3",
  admin: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z M9 12l2 2 4-4",
  search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13z M15.5 15.5 20 20",
  empty: "M4 8l8-4 8 4-8 4z M4 8v8l8 4 8-4V8 M12 12v8",
  removed: "M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13",
} as const;

type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

export const mediaIcon = (mediaType: string): IconName =>
  mediaType.startsWith("video/") ? "video" : mediaType.startsWith("audio/") ? "audio" : "image";
