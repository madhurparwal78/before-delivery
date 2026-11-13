// The three-device plan preview: a laptop, a tablet overlapping its lower right and a phone, each showing a different plan.
import { floorPlan, type PlanDrawing } from './plans.ts';

const GRIP = 6;

function Plan({ drawing }: { drawing: PlanDrawing }) {
  return (
    <g className="plan">
      <path d={drawing.walls} />
      <path d={drawing.doors} />
      <path d={drawing.windows} />
      <path d={drawing.dimension} className="plan-dim" />
      {drawing.grips.map(([x, y]) => <rect key={`${x}-${y}`} x={x - GRIP / 2} y={y - GRIP / 2} width={GRIP} height={GRIP} className="grip-static" />)}
    </g>
  );
}

const laptopPlan = floorPlan(11, { x: 62, y: 62, width: 390, height: 180 }, 4);
const tabletPlan = floorPlan(29, { x: 378, y: 166, width: 134, height: 118 }, 3);
const phonePlan = floorPlan(47, { x: 584, y: 196, width: 52, height: 84 }, 2);

export function DevicePreview() {
  return (
    <div role="img" aria-label="Corbel Draft on a laptop, tablet and phone" className="device-preview">
      <svg viewBox="0 0 660 340" aria-hidden="true" focusable="false">
        <g className="device">
          <rect x="20" y="6" width="470" height="294" rx="14" className="bezel" />
          <rect x="32" y="18" width="446" height="270" rx="3" className="screen" />
          <path d="M44 34h64M44 42h40M418 30h44" className="plan-dim" />
          <Plan drawing={laptopPlan} />
          <path d="M6 300h498l-10 14H16z" className="laptop-base" />
          <path d="M214 300h82l-4 5h-74z" className="laptop-notch" />
        </g>
        <g className="device">
          <rect x="352" y="124" width="190" height="210" rx="12" className="bezel bezel-solid" />
          <rect x="362" y="134" width="170" height="190" rx="3" className="screen" />
          <Plan drawing={tabletPlan} />
        </g>
        <g className="device">
          <rect x="564" y="146" width="88" height="176" rx="14" className="bezel bezel-solid" />
          <rect x="572" y="156" width="72" height="156" rx="4" className="screen" />
          <rect x="598" y="150" width="20" height="3" rx="1.5" className="speaker" />
          <Plan drawing={phonePlan} />
        </g>
      </svg>
    </div>
  );
}
