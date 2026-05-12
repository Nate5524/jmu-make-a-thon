import { useJarvis } from "../context/JarvisProvider.jsx";
import { isBlindsDevice } from "../lib/normalizeSmartHome.js";

export function SmartHomeCard({ prepend, reorderDropTargetProps = {} }) {
  const { state, dispatch, setStatus, smartHomeMutationPendingRef } = useJarvis();
  const devices = state.remoteSmartHome.devices || [];

  const applyDevices = (rawDevices, revision) => {
    dispatch({ type: "SET_SMARTHOME_FROM_DEVICES", payload: rawDevices, revision });
  };

  const toggleLights = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    smartHomeMutationPendingRef.current = true;
    let ok = false;
    try {
      const r = await fetch("/api/smart-home/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "ambient" }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(data.error || "Lights command failed");
        return;
      }
      if (data.smartHome?.devices) applyDevices(data.smartHome.devices, data.revision);
      ok = true;
    } catch (err) {
      console.warn("Lights toggle failed", err);
      setStatus("Lights command failed — is the server running?");
    } finally {
      smartHomeMutationPendingRef.current = false;
      if (!ok) btn.disabled = false;
    }
    if (ok) setStatus("Ready");
  };

  const blindsAction = async (e, open) => {
    const container = e.currentTarget.closest(".smart-home-blinds-actions");
    const buttons = container ? Array.from(container.querySelectorAll("button")) : [e.currentTarget];
    for (const b of buttons) b.disabled = true;
    smartHomeMutationPendingRef.current = true;
    let ok = false;
    try {
      const path = open ? "/api/smart-home/blinds/open" : "/api/smart-home/blinds/close";
      const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setStatus(data.error || "Blinds command failed");
        return;
      }
      if (data.smartHome?.devices) applyDevices(data.smartHome.devices, data.revision);
      ok = true;
    } catch (err) {
      console.warn("Blinds command failed", err);
      setStatus("Blinds command failed — is the server running?");
    } finally {
      smartHomeMutationPendingRef.current = false;
      for (const b of buttons) b.disabled = false;
    }
    if (ok) setStatus("Ready");
  };

  return (
    <div className="card" id="smartHomeCard" {...reorderDropTargetProps}>
      {prepend}
      <h3>Smart home (demo)</h3>
      <div id="smartHomeContent">
        {!devices.length ? (
          <span className="no-items">
            {state.lastDemoRevision < 0 ? "Demo server unavailable (run npm run dev)" : "No devices (demo)"}
          </span>
        ) : (
          <div className="smart-home-list">
            {devices.map((d) =>
              isBlindsDevice(d) ? (
                <div className="smart-home-row" key={d.id}>
                  <div className="smart-home-row__name">{d.name}</div>
                  <div className="smart-home-row__controls smart-home-blinds-actions">
                    <button type="button" className="smart-home-blinds-btn" aria-label="Close blinds" onClick={(e) => blindsAction(e, false)}>
                      Close
                    </button>
                    <button type="button" className="smart-home-blinds-btn" aria-label="Open blinds" onClick={(e) => blindsAction(e, true)}>
                      Open
                    </button>
                  </div>
                </div>
              ) : (
                <div className="smart-home-row" key={d.id}>
                  <div className="smart-home-row__name">{d.name}</div>
                  <div className="smart-home-row__controls">
                    <button type="button" className="smart-home-blinds-btn" aria-label="Toggle lights" onClick={toggleLights}>
                      Toggle
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
