const KEY_STORAGE = "powersleep_admin_key";

function setStatus(msg, kind) {
  const el = document.getElementById("status");
  el.textContent = msg || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function renderDevices(devices) {
  const root = document.getElementById("devicesRoot");
  if (!devices || !devices.length) {
    root.innerHTML = '<p class="hint">No devices</p>';
    return;
  }
  root.innerHTML = devices
    .map(
      (d) => `
        <div class="device-row" data-id="${escapeHtml(d.id)}">
          <span>${escapeHtml(d.name)}</span>
          <label><input type="checkbox" class="dev-on" ${d.on ? "checked" : ""} /> On</label>
        </div>
      `,
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function collectDevices() {
  const rows = document.querySelectorAll(".device-row");
  const out = [];
  rows.forEach((row) => {
    const cb = row.querySelector(".dev-on");
    const nameEl = row.querySelector("span");
    const id = row.dataset.id || "device";
    const name = nameEl ? nameEl.textContent : "Device";
    out.push({ id, name, on: cb ? cb.checked : false });
  });
  return out;
}

async function loadState() {
  setStatus("Loading…");
  try {
    const r = await fetch("/api/state");
    if (!r.ok) throw new Error("GET failed");
    const data = await r.json();
    renderDevices(data.smartHome?.devices || []);
    document.getElementById("revLine").textContent =
      "revision " + data.revision + " · " + (data.updatedAt || "");
    setStatus("", "");
  } catch (e) {
    setStatus("Could not load state. Is the app server running?", "err");
  }
}

async function save() {
  const token = document.getElementById("adminKey").value.trim();
  if (!token) {
    setStatus("Enter the admin key.", "err");
    return;
  }
  sessionStorage.setItem(KEY_STORAGE, token);
  setStatus("Saving…");
  try {
    const body = {
      smartHome: { devices: collectDevices() },
    };
    const r = await fetch("/api/state", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      throw new Error(data.error || r.statusText);
    }
    setStatus("Saved.", "ok");
    document.getElementById("revLine").textContent =
      "revision " + data.revision + " · " + (data.updatedAt || "");
  } catch (e) {
    setStatus(String(e.message || e), "err");
  }
}

document.getElementById("saveBtn").addEventListener("click", save);

const saved = sessionStorage.getItem(KEY_STORAGE);
if (saved) document.getElementById("adminKey").value = saved;

loadState();
