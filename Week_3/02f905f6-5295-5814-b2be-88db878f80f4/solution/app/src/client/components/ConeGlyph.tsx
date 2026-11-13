// A drawn pyrometric cone: upright before firing, bent over once fired or cooling.
export function ConeGlyph({ bent, size = 18 }: { bent: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3" y="16.5" width="14" height="2.5" rx="0.6" fill="currentColor" opacity="0.55" />
      {bent ? (
        <path d="M8 16.5 L9.6 9.2 Q11.2 3.6 16.6 5.6 L16.9 7.1 Q13.3 6.4 12.4 10.2 L11.6 16.5 Z" fill="currentColor" />
      ) : (
        <path d="M7.6 16.5 L10.4 1.5 L12.4 16.5 Z" fill="currentColor" />
      )}
    </svg>
  );
}
