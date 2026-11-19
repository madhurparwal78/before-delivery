import { barOfBeat } from "../../shared/beat.ts";
import type { ScriptDoc } from "../../shared/types.ts";

const CALL_LIMIT_MS = 50;
const WATCHDOG_MS = 200;

const NETWORK_NAMES = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "WebTransport", "BroadcastChannel",
  "indexedDB", "caches", "Worker", "SharedWorker", "RTCPeerConnection", "navigator", "FontFace",
];

/** Runs once, on a single line, before the script's own text so that script line numbers stay one-based. */
const PRELUDE = `(function(){
var post=self.postMessage.bind(self);var listen=self.addEventListener.bind(self);var defs=Object.create(null);
var refuse=function(){var e=new Error("network access is not allowed");e.name="NetworkRefused";throw e};
var names=${JSON.stringify(NETWORK_NAMES)};
for(var o=self;o;o=Object.getPrototypeOf(o)){names.forEach(function(n){try{delete o[n]}catch(x){}})}
names.forEach(function(n){Object.defineProperty(self,n,{value:refuse,writable:false,configurable:false})});
["postMessage","addEventListener","removeEventListener","dispatchEvent","close"].forEach(function(n){try{Object.defineProperty(self,n,{value:undefined,writable:false,configurable:false})}catch(x){}});
var lineOf=function(e){var s=String(e&&e.stack||"");var re=/blob:[^\\s)]+:(\\d+):\\d+/g;var m;while((m=re.exec(s))){if(Number(m[1])>=2)return Number(m[1])-1}return null};
var fail=function(e){post({kind:"error",name:String(e&&e.name||"Error"),message:String(e&&e.message||e),line:lineOf(e)})};
Object.defineProperty(self,"console",{value:{log:function(){post({kind:"log",text:Array.prototype.map.call(arguments,function(v){return String(v)}).join(" ")})}},writable:false,configurable:false});
Object.defineProperty(self,"registerNode",{value:function(typeName,def){
if(typeof typeName!=="string"||typeName.length<1||typeName.length>40)throw new Error("registerNode needs a name of 1 to 40 characters");
if(!def||!Array.isArray(def.inputs)||!Array.isArray(def.outputs)||typeof def.run!=="function")throw new Error("registerNode needs inputs, outputs and run");
defs[typeName]=def;post({kind:"node",typeName:typeName,inputs:def.inputs.map(String),outputs:def.outputs.map(String)})},writable:false,configurable:false});
listen("error",function(ev){ev.preventDefault();post({kind:"error",name:"Error",message:String(ev.message||"error").replace(/^Uncaught (\\w+: )?/,""),line:ev.lineno>1?ev.lineno-1:null})});
listen("message",function(ev){var m=ev.data;
if(m.kind==="beat"){var sets=[];var t=performance.now();
try{if(typeof onBeat==="function")onBeat({beat:m.beat,bar:m.bar,bpm:m.bpm,set:function(l,p,v){sets.push([String(l),String(p),Number(v)])}})}catch(e){fail(e);return}
post({kind:"beat-done",sets:sets,elapsed:performance.now()-t})}
else if(m.kind==="ping"){post({kind:"ready"})}
else if(m.kind==="run"){var def=defs[m.typeName];var out={};
try{var r=def.run(m.inputs)||{};def.outputs.forEach(function(n){var v=Number(r[n]);out[n]=Number.isFinite(v)?v:0})}catch(e){fail(e);return}
post({kind:"result",typeName:m.typeName,outputs:out})}});
post({kind:"hello"})})();`.replace(/\n/g, "");

type WorkerMessage =
  | { kind: "hello" }
  | { kind: "ready" }
  | { kind: "log"; text: string }
  | { kind: "node"; typeName: string; inputs: string[]; outputs: string[] }
  | { kind: "error"; name: string; message: string; line: number | null }
  | { kind: "beat-done"; sets: [string, string, number][]; elapsed: number }
  | { kind: "result"; typeName: string; outputs: Record<string, number> };

interface NodeType {
  typeName: string;
  inputs: string[];
  outputs: string[];
}

interface ScriptEvents {
  console(line: string): void;
  problem(line: string): void;
  nodesChanged(): void;
}

interface Running {
  script: ScriptDoc;
  worker: Worker;
  url: string;
  ready: boolean;
  waiting: ReturnType<typeof setTimeout> | null;
  nodes: NodeType[];
}

function sandboxWorker(source: string): { worker: Worker; url: string } {
  const url = URL.createObjectURL(new Blob([`${PRELUDE}\n${source}`], { type: "text/javascript" }));
  return { worker: new Worker(url), url };
}

export class ScriptHost {
  private readonly running = new Map<string, Running>();
  private readonly versions = new Map<string, number>();
  private readonly drivenValues = new Map<string, Map<string, number>>();
  private readonly lastOutputs = new Map<string, Record<string, number>>();
  private readonly events: ScriptEvents;
  private merged = new Map<string, number>();

  constructor(events: ScriptEvents) {
    this.events = events;
  }

  /** Starts a script's worker when it is new or newer than the one running; stops workers of removed scripts. */
  sync(scripts: readonly ScriptDoc[]): void {
    const ids = new Set(scripts.map((script) => script.id));
    for (const id of [...this.running.keys()]) if (!ids.has(id)) this.stop(id);
    for (const script of scripts) {
      if (this.versions.get(script.id) === script.version) continue;
      this.versions.set(script.id, script.version);
      this.stop(script.id);
      this.start(script);
    }
    for (const id of [...this.versions.keys()]) if (!ids.has(id)) this.versions.delete(id);
  }

  private start(script: ScriptDoc): void {
    const { worker, url } = sandboxWorker(script.source);
    const entry: Running = { script, worker, url, ready: false, waiting: null, nodes: [] };
    this.running.set(script.id, entry);
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.receive(entry, event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      const where = event.lineno > 1 ? `line ${event.lineno - 1}: ` : "";
      this.halt(entry, `${script.name}: ${where}${event.message.replace(/^Uncaught (\w+: )?/, "")}`);
    };
  }

  private stop(id: string): void {
    const entry = this.running.get(id);
    if (!entry) return;
    if (entry.waiting) clearTimeout(entry.waiting);
    entry.worker.terminate();
    URL.revokeObjectURL(entry.url);
    this.running.delete(id);
    this.drivenValues.delete(id);
    this.mergeOverrides();
    if (entry.nodes.length > 0) this.events.nodesChanged();
  }

  private halt(entry: Running, line: string): void {
    this.events.console(line);
    this.events.problem(line);
    entry.ready = false;
    if (entry.waiting) clearTimeout(entry.waiting);
    entry.waiting = null;
    entry.worker.terminate();
  }

  private receive(entry: Running, message: WorkerMessage): void {
    const { script } = entry;
    switch (message.kind) {
      case "hello":
        entry.worker.postMessage({ kind: "ping" });
        this.watch(entry, "top level");
        break;
      case "ready":
        this.finish(entry);
        entry.ready = true;
        break;
      case "log":
        this.events.console(`${script.name}: ${message.text}`);
        break;
      case "node":
        entry.nodes = [...entry.nodes.filter((node) => node.typeName !== message.typeName), message];
        this.events.nodesChanged();
        break;
      case "error": {
        if (message.name === "NetworkRefused") {
          this.halt(entry, `${script.name} stopped: network access is not allowed`);
        } else {
          const where = message.line === null ? "" : `line ${message.line}: `;
          this.halt(entry, `${script.name}: ${where}${message.message}`);
        }
        break;
      }
      case "beat-done":
        this.finish(entry);
        if (message.elapsed > CALL_LIMIT_MS) {
          this.halt(entry, `${script.name} stopped: onBeat took longer than ${CALL_LIMIT_MS} ms`);
        } else {
          const values = this.drivenValues.get(script.id) ?? new Map<string, number>();
          for (const [layer, path, value] of message.sets) values.set(`${layer}\u0000${path}`, value);
          this.drivenValues.set(script.id, values);
          this.mergeOverrides();
        }
        break;
      case "result":
        this.finish(entry);
        this.lastOutputs.set(message.typeName, message.outputs);
        break;
    }
  }

  private finish(entry: Running): void {
    if (entry.waiting) clearTimeout(entry.waiting);
    entry.waiting = null;
  }

  private mergeOverrides(): void {
    this.merged = new Map<string, number>();
    for (const values of this.drivenValues.values()) for (const [key, value] of values) this.merged.set(key, value);
  }

  private watch(entry: Running, label: string): void {
    entry.waiting = setTimeout(() => {
      entry.waiting = null;
      this.halt(entry, `${entry.script.name} stopped: ${label} took longer than ${CALL_LIMIT_MS} ms`);
    }, WATCHDOG_MS);
  }

  /** Called once per beat while the transport plays. */
  fireBeat(beat: number, bpm: number): void {
    for (const entry of this.running.values()) {
      if (!entry.ready || entry.waiting) continue;
      entry.worker.postMessage({ kind: "beat", beat, bar: barOfBeat(beat), bpm });
      this.watch(entry, "onBeat");
    }
  }

  nodeTypes(): NodeType[] {
    return [...this.running.values()].flatMap((entry) => entry.nodes);
  }

  run(typeName: string, inputs: Record<string, number>): Record<string, number> {
    const owner = [...this.running.values()].find((entry) => entry.nodes.some((node) => node.typeName === typeName));
    if (!owner) return {};
    if (owner.ready && !owner.waiting) {
      owner.worker.postMessage({ kind: "run", typeName, inputs });
      this.watch(owner, "run");
    }
    return this.lastOutputs.get(typeName) ?? {};
  }

  overrides(): ReadonlyMap<string, number> {
    return this.merged;
  }

  dispose(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
    this.versions.clear();
  }
}
