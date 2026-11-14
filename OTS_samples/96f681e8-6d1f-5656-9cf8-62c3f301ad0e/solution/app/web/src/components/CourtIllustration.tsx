/** The stepped-mask court illustration, drawn in code: a top-down padel court with glass walls, a net and two balls. */
export function CourtIllustration() {
  return (
    <svg className="court-illustration" viewBox="0 0 565 400" role="img" aria-label="Court illustration" preserveAspectRatio="xMidYMid slice">
      <defs>
        <clipPath id="stepped-mask">
          <path d="M126 0H565V300A100 100 0 0 1 465 400H0V126H126Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#stepped-mask)">
        <rect width="565" height="400" fill="#1d3aa8" />
        <rect x="22" y="22" width="521" height="356" rx="10" fill="#2a4fd6" stroke="#9db4ff" strokeWidth="10" />
        <rect x="52" y="52" width="461" height="296" fill="#3a66ff" stroke="#ffffff" strokeWidth="4" />
        <path d="M282 52V348" stroke="#ffffff" strokeWidth="10" strokeDasharray="6 8" />
        <path d="M52 200H513" stroke="#ffffff" strokeWidth="3" opacity="0.0" />
        <path d="M142 52V348M422 52V348M142 200H422" stroke="#ffffff" strokeWidth="3" opacity="0.85" />
        <rect x="270" y="38" width="24" height="14" rx="3" fill="#0e2433" />
        <rect x="270" y="348" width="24" height="14" rx="3" fill="#0e2433" />
        <g transform="translate(176 130)">
          <circle r="17" fill="#d4ff1a" />
          <path d="M-12 -9c8 5 8 13 0 18M12 -9c-8 5 -8 13 0 18" fill="none" stroke="#0e2433" strokeWidth="2.4" strokeLinecap="round" />
        </g>
        <g transform="translate(372 266)">
          <circle r="17" fill="#d4ff1a" />
          <path d="M-12 -9c8 5 8 13 0 18M12 -9c-8 5 -8 13 0 18" fill="none" stroke="#0e2433" strokeWidth="2.4" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}
