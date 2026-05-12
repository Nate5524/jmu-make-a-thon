import { useState } from "react";
import { useJarvis } from "../context/JarvisProvider.jsx";
import { clientTimezone, wallClockToUtcIso } from "../lib/scheduleTime.js";
import { localIsoDate } from "../lib/calendarDates.js";

export function SchedulesCard({ prepend, reorderDropTargetProps = {} }) {
  const { state, dispatch, setStatus } = useJarvis();
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [dateVal, setDateVal] = useState("");
  const [timeVal, setTimeVal] = useState("");
  const [repeat, setRepeat] = useState("once");
  const [weekday, setWeekday] = useState(1);
  const [mode, setMode] = useState("static");
  const [text, setText] = useState("");

  const openForm = () => {
    if (formOpen) {
      setFormOpen(false);
      return;
    }
    setFormOpen(true);
    setDateVal(localIsoDate());
    setTimeVal(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  };

  const submit = async () => {
    if (!label.trim()) {
      setStatus("Schedule needs a label");
      return;
    }
    if (!dateVal || !timeVal) {
      setStatus("Pick a date and time");
      return;
    }
    if (!text.trim()) {
      setStatus("Enter a message or instruction");
      return;
    }
    const tz = clientTimezone();
    const nextRunAt = wallClockToUtcIso(dateVal, timeVal, tz);
    const body = {
      label: label.trim(),
      nextRunAt,
      timezone: tz,
      repeat,
      wallClockTime: timeVal.slice(0, 5),
      createdBy: "user",
      mode,
      speak: true,
    };
    if (repeat === "weekly") body.weekday = weekday;
    if (mode === "static") body.storedAssistantText = text.trim();
    else body.storedInstruction = text.trim();
    try {
      const r = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setStatus(data.error || "Failed to create schedule");
        return;
      }
      if (data.schedule) dispatch({ type: "ADD_SCHEDULE", payload: data.schedule });
      setFormOpen(false);
      setLabel("");
      setText("");
      setStatus("Schedule created");
    } catch (err) {
      setStatus("Failed to create schedule");
      console.warn(err);
    }
  };

  const remove = async (id) => {
    try {
      await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
      dispatch({ type: "REMOVE_SCHEDULE", payload: id });
    } catch (err) {
      console.warn("Delete schedule failed:", err);
    }
  };

  return (
    <div className="card" id="schedulesCard" {...reorderDropTargetProps}>
      {prepend}
      <h3>Scheduled</h3>
      <div id="schedulesContent">
        {!state.remoteSchedules.length ? (
          <span className="no-items">No scheduled items</span>
        ) : (
          state.remoteSchedules.map((s) => {
            const when = new Date(s.nextRunAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <div className="schedule-item" key={s.id}>
                <div className="schedule-item-info">
                  <div className="schedule-item-label">{s.label || "(no label)"}</div>
                  <div className="schedule-item-meta">
                    <span>{when}</span>
                    {s.repeat !== "once" && <span className="schedule-badge schedule-badge--repeat">{s.repeat}</span>}
                    {s.createdBy === "jarvis" && <span className="schedule-badge schedule-badge--jarvis">Jarvis</span>}
                    {s.mode === "llm_followup" && <span className="schedule-badge schedule-badge--llm">AI</span>}
                  </div>
                </div>
                <button type="button" className="schedule-delete-btn" title="Delete" onClick={() => remove(s.id)}>
                  &times;
                </button>
              </div>
            );
          })
        )}
      </div>
      <div id="addScheduleArea">
        <button className="add-event-btn" type="button" onClick={openForm}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Schedule
        </button>
        {formOpen && (
          <div id="scheduleFormContainer">
            <div className="event-form">
              <input type="text" id="schedLabel" placeholder="Label (e.g. Morning briefing)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <div className="row">
                <input type="date" id="schedDate" value={dateVal} onChange={(e) => setDateVal(e.target.value)} />
                <input type="time" id="schedTime" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} />
              </div>
              <select id="schedRepeat" value={repeat} onChange={(e) => setRepeat(e.target.value)}>
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              <select id="schedWeekday" style={{ display: repeat === "weekly" ? "" : "none" }} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                <option value={0}>Sunday</option>
                <option value={1}>Monday</option>
                <option value={2}>Tuesday</option>
                <option value={3}>Wednesday</option>
                <option value={4}>Thursday</option>
                <option value={5}>Friday</option>
                <option value={6}>Saturday</option>
              </select>
              <div className="mode-radios">
                <label>
                  <input type="radio" name="schedMode" value="static" checked={mode === "static"} onChange={() => setMode("static")} /> Reminder text
                </label>
                <label>
                  <input type="radio" name="schedMode" value="llm_followup" checked={mode === "llm_followup"} onChange={() => setMode("llm_followup")} /> Jarvis responds
                </label>
              </div>
              <textarea id="schedText" placeholder="Message text or instruction for Jarvis" value={text} onChange={(e) => setText(e.target.value)} />
              <div className="event-form-actions">
                <button type="button" className="cancel-btn" onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="save-btn" onClick={submit}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
