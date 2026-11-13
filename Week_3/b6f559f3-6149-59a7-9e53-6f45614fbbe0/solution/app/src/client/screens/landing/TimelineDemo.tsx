import { Reveal } from './Reveal';

interface Lane {
  property: string;
  easing: string;
  from: string;
  to: string;
  start: number;
  end: number;
  keys: number[];
}

const LANES: Lane[] = [
  { property: 'Rotation Y', easing: 'Ease out', from: '0°', to: '90°', start: 0, end: 60, keys: [0, 60] },
  { property: 'Position Y', easing: 'Glide', from: '0.0', to: '2.4', start: 10, end: 80, keys: [10, 45, 80] },
  { property: 'Scale X', easing: 'Spring', from: '1.0', to: '1.6', start: 25, end: 100, keys: [25, 100] },
  { property: 'Opacity', easing: 'Linear', from: '0%', to: '100%', start: 0, end: 35, keys: [0, 35] },
];

const TICKS = ['00:00', '00:01', '00:02', '00:03', '00:04', '00:05'];

export function TimelineDemo() {
  return (
    <Reveal
      className="demo-panel"
      aria-label="Keyframe timeline demo"
      render={(entered) => (
        <>
          <div className="section-head">
            <h2>
              Keys on a <span className="serif-word">ruled</span> track
            </h2>
            <p className="muted">Sixty frames a second, one keyframe per property per frame, eased exactly.</p>
          </div>
          <div className="track-panel" data-play={entered ? 'true' : 'false'}>
            <div className="track-row track-ruler">
              <span className="track-label muted">Time</span>
              <div className="track-lane">
                {TICKS.map((tick) => (
                  <span key={tick} className="tick num">
                    {tick}
                  </span>
                ))}
              </div>
            </div>
            {LANES.map((lane, index) => (
              <div key={lane.property} className="track-row">
                <span className="track-label">{lane.property}</span>
                <div className="track-lane">
                  <span
                    className="track-bar"
                    style={{ left: `${lane.start}%`, width: `${lane.end - lane.start}%`, ['--i' as string]: index }}
                  >
                    <span className="bar-text num">
                      {lane.from} → {lane.to}
                    </span>
                    <span className="bar-easing muted">{lane.easing}</span>
                  </span>
                  {lane.keys.map((key) => (
                    <span key={key} className="key-diamond" style={{ left: `${key}%` }} aria-hidden="true" />
                  ))}
                </div>
              </div>
            ))}
            <div className="playhead-rail" aria-hidden="true">
              <span className="playhead" />
            </div>
          </div>
        </>
      )}
    />
  );
}
