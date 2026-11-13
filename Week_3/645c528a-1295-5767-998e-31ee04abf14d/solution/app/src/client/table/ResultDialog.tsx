import { useEffect, useState, type ReactNode } from 'react';
import { formatNumber } from '../../shared/domain';
import { navigate } from '../router';
import { reducedMotion } from '../store';
import { Figures, Modal } from '../ui';
import type { ResultView } from './model';

const COUNT_MS = 900;

function useCountUp(target: number): number {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0));
  useEffect(() => {
    if (reducedMotion()) return undefined;
    const started = performance.now();
    let frame = requestAnimationFrame(function step(): void {
      const share = Math.min(1, (performance.now() - started) / COUNT_MS);
      setShown(Math.round(target * (1 - (1 - share) ** 3)));
      if (share < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

function CountedLine({ text }: { text: string }): ReactNode {
  const figure = /\d[\d,]*/.exec(text);
  const target = figure === null ? 0 : Number(figure[0].replaceAll(',', ''));
  const shown = useCountUp(target);
  return <Figures text={figure === null ? text : text.replace(figure[0], formatNumber(shown))} />;
}

export function ResultDialog({ result }: { result: ResultView }): ReactNode {
  return (
    <Modal label="Match result">
      <h2>{result.line}</h2>
      <div className="result-lines">
        <p role="status" aria-label="Coin change" className="result-figure"><CountedLine text={result.coinChange} /></p>
        <p role="status" aria-label="XP gained" className="result-figure"><CountedLine text={`+${formatNumber(result.xpGained)} XP`} /></p>
        {result.levelUps.map((line) => <p key={line}>{line}</p>)}
      </div>
      {result.rematch !== null && (
        <>
          <button type="button" disabled={result.rematch.disabled} onClick={result.rematch.onPress}>Rematch</button>
          {result.rematch.label !== null && <p className="note">{result.rematch.label}</p>}
        </>
      )}
      <button type="button" className="primary" onClick={() => navigate('/home')}>Back to lobby</button>
    </Modal>
  );
}
