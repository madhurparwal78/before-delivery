import type { ReactNode } from 'react';
import { aimVector, type Contact } from '../../shared/physics';

const SIZE = 148;
const CENTRE = SIZE / 2;
const MAGNIFIED = 22;

/** The magnified circular overlay: ghost ball, impact line and the tangent line at right angles to it. */
export function LoupeView({ contact, aimDegrees, tangent, locked, label }: { contact: Contact; aimDegrees: number; tangent: number; locked: boolean; label: string }): ReactNode {
  const blocked = contact.ball === null;
  const [dx, dy] = aimVector(aimDegrees);
  const cutRadians = (contact.cut * Math.PI) / 180;
  const impactX = dx * Math.cos(cutRadians) - dy * Math.sin(cutRadians);
  const impactY = -(dy * Math.cos(cutRadians) + dx * Math.sin(cutRadians));
  const tipX = CENTRE + impactX * (MAGNIFIED * 2);
  const tipY = CENTRE + impactY * (MAGNIFIED * 2);
  const reach = (MAGNIFIED * 2.6 * tangent) / 100;
  return (
    <div className="loupe" role="img" aria-label="Contact loupe view">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle cx={CENTRE} cy={CENTRE} r={CENTRE - 2} fill="#0d1115" fillOpacity="0.9" stroke="#c9a24b" strokeWidth={locked ? 4 : 2} strokeDasharray={locked ? undefined : '10 6'} />
        {!blocked && (
          <>
            <circle cx={tipX} cy={tipY} r={MAGNIFIED} fill="#f1e9da" fillOpacity="0.2" stroke="#f1e9da" />
            <line x1={CENTRE} y1={CENTRE} x2={tipX} y2={tipY} stroke="#f1e9da" strokeWidth="1.5" />
            <line
              x1={(CENTRE + tipX) / 2 - impactY * reach}
              y1={(CENTRE + tipY) / 2 + impactX * reach}
              x2={(CENTRE + tipX) / 2 + impactY * reach}
              y2={(CENTRE + tipY) / 2 - impactX * reach}
              stroke="#c9a24b"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </>
        )}
        <circle cx={CENTRE} cy={CENTRE} r={MAGNIFIED} fill="none" stroke="#c9a24b" strokeWidth="1.5" strokeDasharray="4 3" />
        <text x={CENTRE} y={SIZE - 16} textAnchor="middle" fill="#f1e9da" fontFamily="var(--display)" fontWeight="700" fontSize="17">{label}</text>
      </svg>
    </div>
  );
}
