import { copy } from '../../shared/copy';
import type { GateError, OpenApiMeta, RedirectJson, UserRef } from '../../shared/types';
import { Icon } from './ui';

export interface GateState {
  errors: GateError[];
}

interface MarginProps {
  /** The open page has not arrived: the margin stays out of the layout, so its arrival moves nothing. */
  loading: boolean;
  presence: UserRef[];
  conflict: string | null;
  redirects: RedirectJson[];
  rewritten: number;
  gate: GateState | null;
  source: OpenApiMeta | null;
  versionId: string;
  onJump: (error: GateError) => void;
  onCloseGate: () => void;
}

export function GateRows(props: { errors: GateError[]; onJump: (error: GateError) => void }) {
  return (
    <ul class="gate-rows">
      {props.errors.map((error) => (
        <li key={`${error.file}:${error.line}:${error.code}:${error.message}`}>
          <button type="button" class="gate-row" onClick={() => props.onJump(error)}>
            {copy.problemRow(error.file, error.line, error.message)}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ProofMargin(props: MarginProps) {
  return (
    <aside class="proof-margin" aria-label="Proof margin" hidden={props.loading}>
      {props.presence.map((user) => (
        <p class="margin-note" key={user.id}>
          {copy.presence(user.name)}
        </p>
      ))}
      {props.conflict && <p class="margin-note conflict">{props.conflict}</p>}
      {props.gate && (
        <aside class="gate margin-section" aria-label="Publish check">
          <h2>{props.gate.errors.length > 0 ? copy.blockedHeading(props.gate.errors.length) : copy.noProblemsLeft}</h2>
          <GateRows errors={props.gate.errors} onJump={props.onJump} />
          <button type="button" class="button" onClick={props.onCloseGate}>
            Close
          </button>
        </aside>
      )}
      <section class="margin-section" aria-labelledby="redirects-heading">
        <h2 id="redirects-heading">Redirects</h2>
        <ul class="chips" aria-label="Redirects">
          {props.redirects.map((redirect) => (
            <li class="chip" key={redirect.from}>
              {redirect.from} → {redirect.to}
            </li>
          ))}
        </ul>
        {props.redirects.length === 0 && <p class="count-line">No redirects filed yet.</p>}
        <p class="count-line" id="links-rewritten">
          <span class="numeral">{props.rewritten}</span> {props.rewritten === 1 ? 'link' : 'links'} rewritten
        </p>
      </section>
      {props.source && (
        <section class="margin-section" aria-label="Source">
          <h2>Source</h2>
          <dl class="source-panel">
            <dt>File</dt>
            <dd>{props.source.fileName}</dd>
            <dt>Size</dt>
            <dd>{props.source.bytes.toLocaleString('en-US')} bytes</dd>
            <dt>SHA-256</dt>
            <dd>{props.source.sha256}</dd>
          </dl>
          <a class="button" href={`/api/versions/${props.versionId}/openapi/source`} download>
            <Icon name="download" size={16} />
            Download source
          </a>
        </section>
      )}
    </aside>
  );
}
