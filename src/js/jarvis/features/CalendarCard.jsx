import { useMemo, useState } from "react";
import { useJarvis } from "../context/JarvisProvider.jsx";
import { apiCreateCalendarEvent, apiDeleteCalendarEvent, apiPatchCalendarEvent } from "../lib/calendarApi.js";
import { localIsoDate } from "../lib/calendarDates.js";

function calendarDateLabelParts(viewDate) {
  if (!viewDate) return { main: "…", sub: "" };
  const [y, m, d] = viewDate.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const main = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const today = localIsoDate();
  let sub = "";
  if (viewDate === today) sub = "Today";
  else {
    const t0 = new Date(today + "T12:00:00");
    const diffDays = Math.round((dt.getTime() - t0.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) sub = "Tomorrow";
    else if (diffDays === -1) sub = "Yesterday";
    else sub = dt.toLocaleDateString("en-US", { weekday: "long" });
  }
  return { main, sub };
}

export function CalendarCard({ prepend, reorderDropTargetProps = {} }) {
  const { state, dispatch, setStatus, refetchCalendarDay, refetchCalendarContext } = useJarvis();
  const [formOpen, setFormOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [evSummary, setEvSummary] = useState("");
  const [evDate, setEvDate] = useState("");
  const [evAllDay, setEvAllDay] = useState(false);
  const [evStart, setEvStart] = useState("");
  const [evEnd, setEvEnd] = useState("");

  const viewDate = state.calendarViewDate || localIsoDate();
  const { main, sub } = useMemo(() => calendarDateLabelParts(viewDate), [viewDate]);

  const shiftDay = (delta) => {
    const [y, m, d] = viewDate.split("-").map(Number);
    const next = new Date(y, m - 1, d + delta);
    const nextIso = localIsoDate(next);
    dispatch({ type: "SET_CALENDAR_VIEW_DATE", payload: nextIso });
    void refetchCalendarDay(nextIso);
  };

  const openForm = (prefill) => {
    setFormOpen(true);
    const today = new Date().toISOString().slice(0, 10);
    setEvSummary(prefill?.summary || "");
    setEvDate(prefill?.date || today);
    setEvAllDay(!!prefill?.allDay);
    setEvStart(prefill?.startTime || "");
    setEvEnd(prefill?.endTime || "");
    setEditingEventId(prefill?.editId || null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingEventId(null);
  };

  const startEdit = (eventId) => {
    const ev = state.calendarEvents.find((e) => e.id === eventId);
    if (!ev) return;
    const prefill = { editId: eventId, summary: ev.summary, allDay: ev.allDay };
    if (ev.allDay) {
      prefill.date = ev.start;
    } else if (ev.start) {
      const d = new Date(ev.start);
      prefill.date = ev.start.slice(0, 10);
      prefill.startTime = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
      if (ev.end) {
        const de = new Date(ev.end);
        prefill.endTime = de.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
      }
    }
    openForm(prefill);
  };

  const confirmDelete = async (eventId) => {
    if (!confirm("Delete this event?")) return;
    try {
      setStatus("Deleting event...");
      await apiDeleteCalendarEvent(eventId);
      await refetchCalendarDay();
      await refetchCalendarContext();
      setStatus("Event deleted");
    } catch (e) {
      console.error("Delete event error:", e);
      setStatus("Failed to delete event: " + e.message);
    }
  };

  const submitForm = async () => {
    if (!evSummary.trim() || !evDate) {
      alert("Please fill in all required fields.");
      return;
    }
    let payload;
    if (evAllDay) {
      payload = { summary: evSummary.trim(), allDay: true, startDate: evDate };
    } else {
      if (!evStart || !evEnd) {
        alert("Please fill in all required fields.");
        return;
      }
      payload = { summary: evSummary.trim(), start: `${evDate}T${evStart}:00`, end: `${evDate}T${evEnd}:00` };
    }
    try {
      if (editingEventId) {
        setStatus("Updating event...");
        await apiPatchCalendarEvent(editingEventId, payload);
        setStatus("Event updated!");
      } else {
        setStatus("Creating event...");
        await apiCreateCalendarEvent(payload);
        setStatus("Event created!");
      }
      closeForm();
      await refetchCalendarDay();
      await refetchCalendarContext();
    } catch (e) {
      console.error("Event form error:", e);
      setStatus("Failed: " + e.message);
    }
  };

  return (
    <div className="card" id="calendarCard" {...reorderDropTargetProps}>
      {prepend}
      <div className="calendar-card-header">
        <button type="button" className="calendar-nav-btn" id="calendarPrevDay" aria-label="Previous day" onClick={() => shiftDay(-1)}>
          ‹
        </button>
        <div className="calendar-date-mid">
          <label htmlFor="calendarDatePicker" className="calendar-date-btn" aria-label="Choose date">
            <span id="calendarDateLabel">
              {main}
              <span className="calendar-date-sub">{sub}</span>
            </span>
          </label>
          <input
            type="date"
            id="calendarDatePicker"
            className="calendar-date-input-native"
            title="Choose date"
            value={viewDate}
            onChange={(e) => {
              if (!e.target.value) return;
              const v = e.target.value;
              dispatch({ type: "SET_CALENDAR_VIEW_DATE", payload: v });
              void refetchCalendarDay(v);
            }}
          />
        </div>
        <button type="button" className="calendar-nav-btn" id="calendarNextDay" aria-label="Next day" onClick={() => shiftDay(1)}>
          ›
        </button>
      </div>
      <div id="calendarContent">
        {!state.calendarEvents.length ? (
          <span className="no-items">No events this day.</span>
        ) : (
          <ul className="event-list">
            {state.calendarEvents.map((ev) => {
              const timeLabel = ev.allDay
                ? "All day"
                : ev.start
                  ? new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : "";
              return (
                <li key={ev.id}>
                  <span className="event-info">
                    <span className="event-time">{timeLabel}</span>{" "}
                    <span className="event-summary">{ev.summary || "(No title)"}</span>
                  </span>
                  <span className="event-actions">
                    <button type="button" title="Edit" onClick={() => startEdit(ev.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button type="button" className="del-btn" title="Delete" onClick={() => confirmDelete(ev.id)}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" />
                        <path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div id="addEventArea">
        <button
          className="add-event-btn"
          type="button"
          onClick={() => {
            if (formOpen) closeForm();
            else openForm();
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Event
        </button>
        {formOpen && (
          <div id="eventFormContainer">
            <div className="event-form">
              <input type="text" id="evSummary" placeholder="Event title" value={evSummary} onChange={(e) => setEvSummary(e.target.value)} />
              <input type="date" id="evDate" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
              <label className="checkbox-row">
                <input type="checkbox" id="evAllDay" checked={evAllDay} onChange={(e) => setEvAllDay(e.target.checked)} /> All day
              </label>
              <div className="row" id="evTimeRow" style={{ display: evAllDay ? "none" : "flex" }}>
                <input type="time" id="evStart" value={evStart} onChange={(e) => setEvStart(e.target.value)} />
                <input type="time" id="evEnd" value={evEnd} onChange={(e) => setEvEnd(e.target.value)} />
              </div>
              <div className="event-form-actions">
                <button type="button" className="cancel-btn" onClick={closeForm}>
                  Cancel
                </button>
                <button type="button" className="save-btn" id="evSaveBtn" onClick={submitForm}>
                  {editingEventId ? "Update" : "Save"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
