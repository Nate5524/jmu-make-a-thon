/** Canonical blinds + lights demo devices (matches server reconciliation). */
export function normalizeSmartHomeClient(rawDevices) {
  if (!Array.isArray(rawDevices) || rawDevices.length === 0) {
    return {
      devices: [
        { id: "blinds", name: "Blinds", on: false },
        { id: "ambient", name: "Lights", on: false },
      ],
    };
  }
  const map = new Map();
  for (const d of rawDevices) {
    if (d && d.id) map.set(String(d.id).toLowerCase(), d);
  }
  const desk = map.get("desk");
  const blinds = map.get("blinds");
  const ambient = map.get("ambient");
  let blindsOn = false;
  if (blinds) blindsOn = !!blinds.on;
  else if (desk) blindsOn = !!desk.on;
  let ambientOn = false;
  if (ambient) ambientOn = !!ambient.on;
  return {
    devices: [
      { id: "blinds", name: "Blinds", on: blindsOn },
      { id: "ambient", name: "Lights", on: ambientOn },
    ],
  };
}

export function isBlindsDevice(d) {
  if (!d) return false;
  if (String(d.id || "").toLowerCase() === "blinds") return true;
  return (
    String(d.name || "")
      .trim()
      .toLowerCase() === "blinds"
  );
}
