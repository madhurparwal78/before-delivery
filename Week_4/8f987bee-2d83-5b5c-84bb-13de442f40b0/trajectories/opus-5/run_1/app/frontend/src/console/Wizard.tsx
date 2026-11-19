import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Field, LiveStatus } from "../components/ui";
import { api, RequestError } from "../lib/api";
import { DRAFT_RESTORED_COPY } from "../lib/copy";
import { keepDraft, takeDraft, type WizardDraft } from "../lib/draft";
import { useIntentKey } from "../lib/intent";
import { useSession } from "../lib/session";
import { useRefusalAlert } from "./Shell";
import { SYNC_MODE_LABELS } from "../lib/format";

const STEPS = ["Source", "Destination", "Streams", "Schedule"];
const TIME_ZONES = ["UTC", ...Intl.supportedValuesOf("timeZone")];
const POLICIES: { value: string; label: string }[] = [
  { value: "propagate", label: "Propagate" },
  { value: "ignore", label: "Ignore" },
  { value: "pause", label: "Pause" },
];

interface Stream {
  name: string;
  fields: string[];
  cursor_field: string | null;
  supported_sync_modes: string[];
}

const STEP_OF_FIELD: Record<string, number> = {
  source_id: 0,
  destination_id: 1,
  streams: 2,
  name: 3,
  namespace_prefix: 3,
  schedule: 3,
  schema_change_policy: 3,
};

function stepForField(key: string): number {
  if (key.startsWith("streams")) return 2;
  if (key.startsWith("schedule")) return 3;
  return STEP_OF_FIELD[key] ?? 3;
}

export function Wizard(): JSX.Element {
  const navigate = useNavigate();
  const session = useSession();
  const [step, setStep] = useState(0);
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>([]);
  const [catalog, setCatalog] = useState<Stream[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [streams, setStreams] = useState<Record<string, { selected: boolean; sync_mode: string }>>({});
  const [scheduleType, setScheduleType] = useState("manual");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [cronExpression, setCronExpression] = useState("0 * * * *");
  const [timeZone, setTimeZone] = useState("UTC");
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [policy, setPolicy] = useState("propagate");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const intent = useIntentKey();
  const alertFor = useRefusalAlert();
  const restored = useRef(false);

  useEffect(() => {
    void api<{ sources: { id: string; name: string }[] }>("GET", "/api/sources")
      .then((answer) => {
        setSources(answer.sources);
        setSourceId((held) => held || answer.sources[0]?.id || "");
      })
      .catch(() => undefined);
    void api<{ destinations: { id: string; name: string }[] }>("GET", "/api/destinations")
      .then((answer) => {
        setDestinations(answer.destinations);
        setDestinationId((held) => held || answer.destinations[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!sourceId) return;
    void api<{ streams: Stream[] }>("GET", `/api/sources/${sourceId}/catalog`)
      .then((answer) => {
        setCatalog(answer.streams);
        setStreams((held) =>
          Object.fromEntries(
            answer.streams.map((stream) => [
              stream.name,
              held[stream.name] ?? { selected: false, sync_mode: stream.supported_sync_modes[0] },
            ]),
          ),
        );
      })
      .catch(() => undefined);
  }, [sourceId]);

  useEffect(() => {
    const user = session.user;
    if (!user || restored.current) return;
    restored.current = true;
    const draft = takeDraft(user.id);
    if (!draft) return;
    setStep(draft.step);
    setSourceId(draft.source_id);
    setDestinationId(draft.destination_id);
    setStreams(draft.streams);
    setScheduleType(draft.schedule_type);
    setIntervalMinutes(draft.interval_minutes);
    setCronExpression(draft.cron_expression);
    setTimeZone(draft.time_zone);
    setName(draft.name);
    setPrefix(draft.namespace_prefix);
    setPolicy(draft.schema_change_policy);
    setMessage(DRAFT_RESTORED_COPY);
    intent.answered();
  }, [session.user, intent]);

  const draftNow = (): WizardDraft => ({
    user_id: session.user?.id ?? "",
    step,
    source_id: sourceId,
    destination_id: destinationId,
    streams,
    schedule_type: scheduleType,
    interval_minutes: intervalMinutes,
    cron_expression: cronExpression,
    time_zone: timeZone,
    name,
    namespace_prefix: prefix,
    schema_change_policy: policy,
  });

  const changed = () => intent.answered();

  const schedule = () => {
    if (scheduleType === "manual") return { type: "manual" };
    if (scheduleType === "interval") return { type: "interval", interval_minutes: Number(intervalMinutes) };
    return { type: "cron", cron_expression: cronExpression, time_zone: timeZone };
  };

  const create = async () => {
    setPending(true);
    setMessage("Creating connection…");
    setFields({});
    const body = {
      name,
      source_id: sourceId,
      destination_id: destinationId,
      namespace_prefix: prefix,
      streams: catalog.map((stream) => {
        const chosen = streams[stream.name];
        const mode = chosen?.sync_mode ?? stream.supported_sync_modes[0];
        const incremental = mode.startsWith("incremental");
        return {
          name: stream.name,
          selected: chosen?.selected ?? false,
          sync_mode: mode,
          cursor_field: incremental ? stream.cursor_field : null,
          primary_key: ["id"],
        };
      }),
      schedule: schedule(),
      schema_change_policy: policy,
    };
    try {
      const answer = await api<{ connection: { id: string } }>("POST", "/api/connections", {
        body,
        idempotencyKey: intent.key(),
      });
      intent.answered();
      setMessage("Connection created");
      navigate(`/app/connections/${answer.connection.id}`);
    } catch (error) {
      const refusal = error as RequestError;
      intent.keepForRetry(refusal);
      if (refusal.status === 401) {
        keepDraft(draftNow());
        return;
      }
      if (refusal.code === "validation") {
        setFields(refusal.fields);
        const first = Object.keys(refusal.fields)[0];
        setStep(stepForField(first));
        setMessage("");
        window.setTimeout(() => {
          const node = document.querySelector<HTMLElement>("[data-field-error='true']");
          node?.focus();
        }, 0);
      } else if (refusal.code === "name_taken") {
        setMessage("A connection with this name already exists.");
      } else if (refusal.code === "table_conflict") {
        const table = `${prefix}${Object.keys(streams).find((key) => streams[key].selected) ?? ""}`;
        setMessage(`Another connection already writes ${table} in this destination.`);
      } else if (refusal.code === "frequency_exceeds_plan") {
        const workspace = await api<{ workspace: { min_interval_minutes: number } }>("GET", "/api/workspace");
        setMessage(
          `Your plan allows syncs at most every ${workspace.workspace.min_interval_minutes} minutes.`,
        );
      } else {
        setMessage(alertFor(refusal) ?? "Wayline couldn't confirm this action.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <h1>New connection</h1>
      <ol className="wizard-steps">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined}>
            {label}
          </li>
        ))}
      </ol>
      <div className="panel">
        {step === 0 ? (
          <Field label="Source" error={fields.source_id}>
            {(attributes) => (
              <select
                {...attributes}
                data-field-error={fields.source_id ? "true" : undefined}
                value={sourceId}
                onChange={(event) => {
                  setSourceId(event.target.value);
                  changed();
                }}
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {step === 1 ? (
          <Field label="Destination" error={fields.destination_id}>
            {(attributes) => (
              <select
                {...attributes}
                data-field-error={fields.destination_id ? "true" : undefined}
                value={destinationId}
                onChange={(event) => {
                  setDestinationId(event.target.value);
                  changed();
                }}
              >
                {destinations.map((destination) => (
                  <option key={destination.id} value={destination.id}>
                    {destination.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : null}

        {step === 2 ? (
          <div>
            {fields.streams ? <p className="field-error">{fields.streams}</p> : null}
            {catalog.map((stream) => (
              <div className="stream-row-controls" key={stream.name}>
                <div className="check-row">
                  <input
                    type="checkbox"
                    id={`stream-${stream.name}`}
                    checked={streams[stream.name]?.selected ?? false}
                    onChange={(event) => {
                      setStreams((held) => ({
                        ...held,
                        [stream.name]: {
                          selected: event.target.checked,
                          sync_mode: held[stream.name]?.sync_mode ?? stream.supported_sync_modes[0],
                        },
                      }));
                      changed();
                    }}
                  />
                  <label htmlFor={`stream-${stream.name}`}>{`Sync ${stream.name}`}</label>
                </div>
                <Field label={`Sync mode for ${stream.name}`}>
                  {(attributes) => (
                    <select
                      {...attributes}
                      value={streams[stream.name]?.sync_mode ?? stream.supported_sync_modes[0]}
                      onChange={(event) => {
                        setStreams((held) => ({
                          ...held,
                          [stream.name]: {
                            selected: held[stream.name]?.selected ?? false,
                            sync_mode: event.target.value,
                          },
                        }));
                        changed();
                      }}
                    >
                      {stream.supported_sync_modes.map((mode) => (
                        <option key={mode} value={mode}>
                          {SYNC_MODE_LABELS[mode]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            ))}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <Field label="Schedule">
              {(attributes) => (
                <select
                  {...attributes}
                  value={scheduleType}
                  onChange={(event) => {
                    setScheduleType(event.target.value);
                    changed();
                  }}
                >
                  <option value="manual">Manual</option>
                  <option value="interval">Every N minutes</option>
                  <option value="cron">Cron</option>
                </select>
              )}
            </Field>
            {scheduleType === "interval" ? (
              <Field label="Interval minutes" error={fields["schedule.interval_minutes"]}>
                {(attributes) => (
                  <input
                    {...attributes}
                    type="number"
                    min={1}
                    max={1440}
                    data-field-error={fields["schedule.interval_minutes"] ? "true" : undefined}
                    value={intervalMinutes}
                    onChange={(event) => {
                      setIntervalMinutes(event.target.value);
                      changed();
                    }}
                  />
                )}
              </Field>
            ) : null}
            {scheduleType === "cron" ? (
              <>
                <Field label="Cron expression" error={fields["schedule.cron_expression"]}>
                  {(attributes) => (
                    <input
                      {...attributes}
                      type="text"
                      data-field-error={fields["schedule.cron_expression"] ? "true" : undefined}
                      value={cronExpression}
                      onChange={(event) => {
                        setCronExpression(event.target.value);
                        changed();
                      }}
                    />
                  )}
                </Field>
                <Field label="Time zone" error={fields["schedule.time_zone"]}>
                  {(attributes) => (
                    <select
                      {...attributes}
                      value={timeZone}
                      onChange={(event) => {
                        setTimeZone(event.target.value);
                        changed();
                      }}
                    >
                      {TIME_ZONES.map((zone) => (
                        <option key={zone} value={zone}>
                          {zone}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </>
            ) : null}
            <Field label="Connection name" error={fields.name}>
              {(attributes) => (
                <input
                  {...attributes}
                  type="text"
                  data-field-error={fields.name ? "true" : undefined}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    changed();
                  }}
                />
              )}
            </Field>
            <Field label="Namespace prefix" error={fields.namespace_prefix} hint="Such as shop_">
              {(attributes) => (
                <input
                  {...attributes}
                  type="text"
                  data-field-error={fields.namespace_prefix ? "true" : undefined}
                  value={prefix}
                  onChange={(event) => {
                    setPrefix(event.target.value);
                    changed();
                  }}
                />
              )}
            </Field>
            <Field label="Schema change policy">
              {(attributes) => (
                <select
                  {...attributes}
                  value={policy}
                  onChange={(event) => {
                    setPolicy(event.target.value);
                    changed();
                  }}
                >
                  {POLICIES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        ) : null}

        <div className="button-row">
          {step > 0 ? (
            <button type="button" className="button outline" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : null}
          {step < 3 ? (
            <button type="button" className="button" onClick={() => setStep(step + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="button" disabled={pending} onClick={() => void create()}>
              Create connection
            </button>
          )}
        </div>
        <LiveStatus name="Connection form status" message={message} />
      </div>
    </>
  );
}
