// A talent portrait: the stored photo over a drawn portrait frame, which shows with initials until the first
// photo and stays behind a photo that is still loading, so a card never shows an empty box.

export function Portrait({ src, alt, name }: { src: string | null; alt: string; name: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  return (
    <div className="portrait-frame" {...(src ? {} : { role: "img", "aria-label": alt })}>
      <svg viewBox="0 0 300 400" aria-hidden="true" focusable="false">
        <rect width="300" height="400" fill="#d9ccb6" />
        <ellipse cx="150" cy="150" rx="58" ry="70" fill="#3a322b" />
        <path d="M40 400 C50 300 100 262 150 262 C200 262 250 300 260 400 Z" fill="#1f1a15" />
      </svg>
      {src ? <img src={src} alt={alt} loading="eager" decoding="async" /> : (
        <span className="portrait-initials" aria-hidden="true">{initials}</span>
      )}
    </div>
  );
}
