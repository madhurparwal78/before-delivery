import type { Craft } from '../../../src/domain/types';

/** Original drawn chart glyphs, decoration only. */
export function Glyph({ stitch, craft }: { stitch: string; craft: Craft }): JSX.Element | null {
  const common = {
    viewBox: '0 0 16 16',
    className: 'glyph',
    'aria-hidden': true as const,
    focusable: 'false' as const,
  };
  if (craft === 'knit') {
    switch (stitch) {
      case 'k':
        return (
          <svg {...common}>
            <path d="M8 3.5 V12.5" />
          </svg>
        );
      case 'p':
        return (
          <svg {...common}>
            <path d="M4 8 H12" />
          </svg>
        );
      case 'yo':
        return (
          <svg {...common}>
            <circle cx="8" cy="8" r="3.4" />
          </svg>
        );
      case 'k2tog':
        return (
          <svg {...common}>
            <path d="M4 12 L12 4" />
          </svg>
        );
      case 'ssk':
        return (
          <svg {...common}>
            <path d="M12 12 L4 4" />
          </svg>
        );
      case 'cdd':
        return (
          <svg {...common}>
            <path d="M3.5 5 L8 10 L12.5 5" />
            <path d="M8 10 V13" />
          </svg>
        );
      case 'm1l':
        return (
          <svg {...common}>
            <path d="M5 12 V7 a3 3 0 0 1 6 0" />
          </svg>
        );
      case 'm1r':
        return (
          <svg {...common}>
            <path d="M11 12 V7 a3 3 0 0 0 -6 0" />
          </svg>
        );
      case 'c22':
        return (
          <svg {...common}>
            <path d="M2 4 C7 4 9 12 14 12" />
            <path d="M2 12 C7 12 9 4 14 4" />
          </svg>
        );
      default:
        return null;
    }
  }
  switch (stitch) {
    case 'sc':
      return (
        <svg {...common}>
          <path d="M4 4 L12 12" />
          <path d="M12 4 L4 12" />
        </svg>
      );
    case 'hdc':
      return (
        <svg {...common}>
          <path d="M8 3 V13" />
          <path d="M4.5 4 H11.5" />
        </svg>
      );
    case 'dc':
      return (
        <svg {...common}>
          <path d="M8 3 V13" />
          <path d="M4.5 4 H11.5" />
          <path d="M5.5 9 L10.5 6" />
        </svg>
      );
    case 'inc':
      return (
        <svg {...common}>
          <path d="M4 4 L8 12 L12 4" />
        </svg>
      );
    case 'dec':
      return (
        <svg {...common}>
          <path d="M4 12 L8 4 L12 12" />
        </svg>
      );
    default:
      return null;
  }
}
