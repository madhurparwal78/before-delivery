import { Ring } from "../components/Ring.tsx";
import { useEffect, useRef, useState } from "react";
import type { BlockSummary, LightNode, NodeSamples, Sample } from "../../shared/api.ts";
import { Page } from "../components/Page.tsx";
import { useRoleGate } from "../components/forms.tsx";
import { Empty, Loading } from "../components/StrandCanvas.tsx";
import { api, ApiError } from "../lib/api.ts";
import { sampleText } from "../lib/format.ts";
import { useJson } from "../lib/resource.ts";
import { useWorkspace } from "../lib/workspace.tsx";
import { NotFoundContent } from "./NotFound.tsx";

const ANNOUNCEMENTS_KEPT = 24;
const ANNOUNCEMENTS_SHOWN = 4;

export function NodePage({ nodeId }: { nodeId: string }) {
  const { id, sampled } = useWorkspace();
  const nodes = useJson<LightNode[]>(`/api/w/${id}/light-nodes`);
  const blocks = useJson<BlockSummary[]>(`/api/w/${id}/blocks`);
  const gate = useRoleGate("write");
  const [picked, setPicked] = useState<number | null>(null);
  const [alert, setAlert] = useState("");
  const [announced, setAnnounced] = useState<Array<{ height: number; text: string }>>([]);
  const [autoChoice, setAutoChoice] = useState<boolean | null>(null);
  const seen = useRef(new Set<string>());

  const node = nodes.data?.find((item) => item.id === nodeId);
  const height = picked ?? blocks.data?.[0]?.height ?? null;
  const samples = useJson<NodeSamples>(height === null ? null : `/api/w/${id}/light-nodes/${nodeId}/samples?height=${height}`);

  const announce = (forHeight: number, sample: Sample) => {
    const key = `${forHeight}:${sample.index}`;
    if (seen.current.has(key)) return;
    seen.current.add(key);
    setAnnounced((old) => [...old, { height: forHeight, text: sampleText(forHeight, sample) }].slice(-ANNOUNCEMENTS_KEPT));
  };
  const announceRef = useRef(announce);
  announceRef.current = announce;

  useEffect(() => {
    sampled.filter((event) => event.node === nodeId).forEach((event) => announceRef.current(event.height, event.sample));
  }, [sampled, nodeId]);

  useEffect(() => {
    if (node && node.autoSample === autoChoice) setAutoChoice(null);
  }, [node, autoChoice]);

  if (nodes.data && !node) return <NotFoundContent />;
  if (!node || !blocks.data) return <Page title="Light node"><Loading label="Light node loading" /></Page>;

  const auto = autoChoice ?? node.autoSample;
  const takeSample = async () => {
    setAlert("");
    try {
      const sample = await api<Sample>("POST", `/api/w/${id}/light-nodes/${nodeId}/samples`, { height });
      announce(height as number, sample);
      samples.reload();
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      setAlert(caught.message);
    }
  };
  const toggleAuto = async (next: boolean) => {
    setAlert("");
    setAutoChoice(next);
    try {
      await api("PATCH", `/api/w/${id}/light-nodes/${nodeId}`, { autoSample: next });
      nodes.reload();
    } catch (caught) {
      if (!(caught instanceof ApiError)) throw caught;
      setAlert(caught.message);
      setAutoChoice(null);
    }
  };

  return (
    <Page title={node.name}>
      <section className="panel spotlight spotlight--node">
        <div className="spotlight__copy">
          {gate.note}
          <div className="field">
            <label htmlFor="node-block">Block</label>
            <select id="node-block" value={height ?? ""} onChange={(e) => setPicked(Number(e.target.value))}>
              {blocks.data.map((block) => <option key={block.height} value={block.height}>Block {block.height}</option>)}
            </select>
          </div>
          <div className="row">
            <button type="button" className="pill pill--solid" disabled={gate.disabled || height === null} aria-describedby={gate.describedBy}
              onClick={() => void takeSample()}>Take sample</button>
            <label className="choice choice--switch">
              <input type="checkbox" role="switch" checked={auto} disabled={gate.disabled} aria-describedby={gate.describedBy}
                onChange={(e) => void toggleAuto(e.target.checked)} />
              <span className="choice__mark" aria-hidden="true" />
              Auto-sample
            </label>
          </div>
          <p role="alert" className="form-alert">{alert}</p>
          <p className="readout readout--big">Confidence {samples.data?.confidence ?? "0.0000"}%</p>
          <div role="status" aria-label="Sampling updates" className="sr-only">
            {announced.filter((line) => line.height === height).slice(-ANNOUNCEMENTS_SHOWN).map((line, index) => <p key={index}>{line.text}</p>)}
          </div>
        </div>
        <div className="spotlight__art" aria-hidden="true"><Ring /></div>
      </section>
      <section className="panel" tabIndex={0}>
        <h2 className="section-title">Samples</h2>
        <table aria-label="Samples">
          <thead><tr><th scope="col">Sample</th><th scope="col">Share</th><th scope="col">Result</th><th scope="col" className="num">Confidence</th></tr></thead>
          <tbody>
            {samples.data?.samples.map((sample) => (
              <tr key={sample.index}>
                <td>{sample.index}</td>
                <td>({sample.row}, {sample.col})</td>
                <td>{sample.served ? "Served" : "Withheld"}</td>
                <td className="num">{sample.confidence}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {samples.data?.samples.length === 0 && <Empty sentence="No samples yet for this block." />}
      </section>
    </Page>
  );
}
