import { useEffect } from "react";
import { useInterval } from "../ui";
import { useShell } from "../shell";

export function DevicesPage() {
  const { deviceId, deviceName, devices, refreshDevices, chooseDevice, presence } = useShell();
  useEffect(() => { void presence().then(() => refreshDevices().catch(() => undefined)); }, [presence, refreshDevices]);
  useInterval(() => void refreshDevices().catch(() => undefined), 5000);
  return (
    <div className="devices-page">
      <h1>Devices</h1>
      <p className="device-line">{deviceName ? `This browser is ${deviceName}` : ""}</p>
      <ul role="list" className="plain device-list">
        {devices.map((d) => (
          <li key={d.id}>
            <span className="device-state">{`${d.name} — ${d.online ? "Online" : "Offline"}`}</span>
            <button type="button" className="btn" aria-label={`Use this browser as ${d.name}`} disabled={d.id === deviceId} onClick={() => chooseDevice(d.id)}>
              Use this browser as {d.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
