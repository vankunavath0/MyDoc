
import { useEffect, useState } from "react";
import "./Calendar.css";
import {
  deleteCalendarEvent,
  getApplications,
  getCalendarEvents,
  getPeople,
  saveCalendarEvent,
} from "../services/cloudFiles";

const pad = (value) => String(value).padStart(2, "0");

const toDateKey = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const DEFAULT_PERSON_ID = "local-demo-user";
const todayKey = toDateKey(new Date());

const eventTypes = [
  { value: "exam", label: "Exam", color: "event-exam" },
  { value: "deadline", label: "Deadline", color: "event-deadline" },
  { value: "result", label: "Result", color: "event-result" },
  { value: "other", label: "Other", color: "event-other" },
];

function Calendar() {
  const [currentMonth, setCurrentMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [events, setEvents] = useState([]);
  const [people, setPeople] = useState([]);
  const [view, setView] = useState("month");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    title: "",
    date: todayKey,
    time: "09:00",
    endTime: "10:00",
    type: "exam",
    notes: "",
    personId: DEFAULT_PERSON_ID,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadEvents() {
      try {
        const [savedEvents, applications, people] = await Promise.all([
          getCalendarEvents(),
          getApplications(),
          getPeople(),
        ]);

        if (cancelled) return;

        const personNames = new Map(
          people.map((person) => [person._id, person.name])
        );
        setPeople(people.map((person) => ({
          id: person._id,
          name: person.name,
        })));
        const applicationEvents = applications.flatMap((application) => {
          const dates = [
            ["examDate", "exam", "Exam"],
            ["deadline", "deadline", "Deadline"],
            ["resultDate", "result", "Result"],
          ];

          return dates
            .filter(([field]) => application[field])
            .map(([field, type, label]) => ({
              id: `application:${application._id}:${field}`,
              title: `${label}: ${application.name}`,
              date: application[field].slice(0, 10),
              time: "09:00",
              endTime: "10:00",
              type,
              personId: application.personId || DEFAULT_PERSON_ID,
              personName:
                personNames.get(application.personId) || "My Documents",
              notes: "",
              isApplication: true,
            }));
        });

        setEvents([
          ...savedEvents.map((event) => ({
            id: event._id,
            title: event.title,
            date: event.date,
            time: event.time,
            endTime: event.endTime,
            type: event.type,
            notes: event.notes || "",
            personId: event.personId || DEFAULT_PERSON_ID,
            personName:
              personNames.get(event.personId) || "My Documents",
            isApplication: false,
          })),
          ...applicationEvents,
        ]);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message || "Could not load calendar events.");
        }
      }
    }

    loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthName = currentMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const monthEvents = events.filter((event) => {
    const date = new Date(`${event.date}T12:00:00`);
    return date.getFullYear() === year && date.getMonth() === month;
  });

  const selectedEvents = events
    .filter((event) => event.date === selectedDate)
    .sort((a, b) => a.time.localeCompare(b.time));

  const selectedDateLabel = new Date(
    `${selectedDate}T12:00:00`
  ).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Show complete weeks, including days from adjacent months.
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const calendarDays = Array.from(
    { length: totalCells },
    (_, index) => {
      const date = new Date(year, month, index - firstDay + 1);

      return {
        date,
        key: toDateKey(date),
        day: date.getDate(),
        inCurrentMonth: date.getMonth() === month,
      };
    }
  );

  function changeMonth(amount) {
    setCurrentMonth(
      new Date(year, month + amount, 1)
    );
  }

  function goToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(toDateKey(now));
  }

  function openNewEvent(date = selectedDate) {
    setEditingId(null);
    setForm({
      title: "",
      date,
      time: "09:00",
      endTime: "10:00",
      type: "exam",
      notes: "",
      personId: DEFAULT_PERSON_ID,
    });
    setShowForm(true);
  }

  function openEditEvent(event) {
    setEditingId(event.id);
    setForm({
      title: event.title,
      date: event.date,
      time: event.time,
      endTime: event.endTime || event.time,
      type: event.type,
      notes: event.notes || "",
      personId: event.personId || DEFAULT_PERSON_ID,
    });
    setShowForm(true);
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveEvent(event) {
    event.preventDefault();

    if (
      !form.title.trim() ||
      !form.date ||
      !form.time ||
      !form.endTime
    ) {
      return;
    }

    if (form.endTime < form.time) {
      alert("End time must be after the start time.");
      return;
    }

    const eventData = {
      ...form,
      title: form.title.trim(),
    };

    setSaving(true);
    setError("");
    try {
      const saved = await saveCalendarEvent(eventData, editingId);
      const savedEvent = {
        ...eventData,
        id: saved._id,
        personName:
          people.find((person) => person.id === saved.personId)?.name ||
          "My Documents",
        isApplication: false,
      };

      setEvents((current) =>
        editingId
          ? current.map((item) =>
              item.id === editingId ? savedEvent : item
            )
          : [...current, savedEvent]
      );
      setSelectedDate(form.date);

      const date = new Date(`${form.date}T12:00:00`);
      setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));
      setShowForm(false);
      setEditingId(null);
    } catch (saveError) {
      setError(saveError.message || "Could not save calendar event.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEvent(id) {
    const confirmed = window.confirm(
      "Delete this calendar event?"
    );

    if (!confirmed) return;

    try {
      await deleteCalendarEvent(id);
      setEvents((current) =>
        current.filter((event) => event.id !== id)
      );
      setError("");
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete calendar event.");
    }
  }

  function getType(type) {
    return eventTypes.find((item) => item.value === type)
      || eventTypes[3];
  }

  function formatTime(time) {
    if (!time) return "";

    const [hours, minutes] = time.split(":").map(Number);

    return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(
      undefined,
      {
        hour: "numeric",
        minute: "2-digit",
      }
    );
  }

  return (
    <main className="calendar-page">
      <header className="page-header">
        <div>
          <span className="calendar-eyebrow">YOUR PLANNER</span>
          <h1 className="page-title">Calendar</h1>
          <p className="page-description">
            Organize exams, application deadlines, results and daily schedules.
          </p>
        </div>

        <button
          className="primary-button"
          onClick={() => openNewEvent()}
        >
          + Add Event
        </button>
      </header>

      {error && <p className="calendar-error" role="alert">{error}</p>}

      {/* Event summary */}
      <section className="calendar-summary">
        {eventTypes.map((type) => {
          const count = monthEvents.filter(
            (event) => event.type === type.value
          ).length;

          return (
            <article
              className="calendar-summary-card"
              key={type.value}
            >
              <span className={`summary-dot ${type.color}`} />
              <div>
                <span>{type.label}s this month</span>
                <strong>{count}</strong>
              </div>
            </article>
          );
        })}
      </section>

      <section className="calendar-workspace">
        {/* Main calendar */}
        <div className="calendar-panel">
          <div className="calendar-controls">
            <div className="calendar-month-controls">
              <button
                className="calendar-arrow"
                onClick={() => changeMonth(-1)}
                aria-label="Previous month"
              >
                ‹
              </button>

              <h2>{monthName}</h2>

              <button
                className="calendar-arrow"
                onClick={() => changeMonth(1)}
                aria-label="Next month"
              >
                ›
              </button>
            </div>

            <div className="calendar-control-actions">
              <button
                className="secondary-button"
                onClick={goToday}
              >
                Today
              </button>

              <div className="calendar-view-toggle">
                <button
                  className={view === "month" ? "active" : ""}
                  onClick={() => setView("month")}
                >
                  Month
                </button>

                <button
                  className={view === "day" ? "active" : ""}
                  onClick={() => setView("day")}
                >
                  Day
                </button>
              </div>
            </div>
          </div>

          {view === "month" ? (
            <>
              <div className="calendar-grid calendar-weekdays">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (day) => (
                    <div key={day}>{day}</div>
                  )
                )}
              </div>

              <div className="calendar-grid calendar-dates">
                {calendarDays.map((day) => {
                  const dayEvents = events
                    .filter((event) => event.date === day.key)
                    .sort((a, b) => a.time.localeCompare(b.time));

                  return (
                    <button
                      key={day.key}
                      className={[
                        "calendar-day",
                        !day.inCurrentMonth ? "outside-month" : "",
                        day.key === todayKey ? "today" : "",
                        day.key === selectedDate ? "selected" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={() => setSelectedDate(day.key)}
                      aria-label={`${day.key}, ${dayEvents.length} events`}
                    >
                      <span className="calendar-day-number">
                        {day.day}
                      </span>

                      <div className="calendar-day-events">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={event.id}
                            className={`calendar-event ${getType(event.type).color}`}
                            title={`${event.time} — ${event.title}${event.personName ? ` · ${event.personName}` : ""}`}
                          >
                            <span>{event.title}</span>
                          </span>
                        ))}

                        {dayEvents.length > 3 && (
                          <span className="calendar-more">
                            +{dayEvents.length - 3} more
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="day-view">
              <div className="day-view-heading">
                <div>
                  <span className="calendar-eyebrow">DAILY SCHEDULE</span>
                  <h3>{selectedDateLabel}</h3>
                </div>

                <button
                  className="primary-button"
                  onClick={() => openNewEvent(selectedDate)}
                >
                  + Add Schedule
                </button>
              </div>

              {Array.from({ length: 15 }, (_, index) => index + 7).map(
                (hour) => {
                  const hourEvents = selectedEvents.filter(
                    (event) => Number(event.time.split(":")[0]) === hour
                  );

                  return (
                    <div className="day-hour-row" key={hour}>
                      <span className="day-hour-label">
                        {formatTime(`${pad(hour)}:00`)}
                      </span>

                      <div className="day-hour-content">
                        {hourEvents.map((event) => (
                          <button
                            key={event.id}
                            className={`day-schedule-event ${getType(event.type).color}`}
                            onClick={
                              event.isApplication
                                ? undefined
                                : () => openEditEvent(event)
                            }
                          >
                            <strong>{event.title}</strong>
                            <span>
                              {formatTime(event.time)} –{" "}
                              {formatTime(event.endTime)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                }
              )}

              <p className="calendar-note">
                This view displays hourly slots from 7 AM to 9 PM.
                Events outside these hours remain available in the daily event list.
              </p>
            </div>
          )}

          <div className="calendar-legend">
            {eventTypes.map((type) => (
              <span key={type.value}>
                <i className={`summary-dot ${type.color}`} />
                {type.label}
              </span>
            ))}
          </div>
        </div>

        {/* Selected day's events */}
        <aside className="schedule-panel">
          <div className="schedule-panel-heading">
            <div>
              <span className="calendar-eyebrow">YOUR SCHEDULE</span>
              <h2>{selectedDateLabel}</h2>
            </div>

            <button
              className="calendar-add-small"
              onClick={() => openNewEvent(selectedDate)}
              aria-label="Add event to selected day"
              title="Add event"
            >
              +
            </button>
          </div>

          <div className="schedule-date-count">
            {selectedEvents.length} event
            {selectedEvents.length !== 1 ? "s" : ""} scheduled
          </div>

          {selectedEvents.length === 0 ? (
            <div className="schedule-empty">
              <div className="schedule-empty-icon">▦</div>
              <h3>No events scheduled</h3>
              <p>Add an exam, deadline, result or personal reminder.</p>

              <button
                className="secondary-button"
                onClick={() => openNewEvent(selectedDate)}
              >
                + Add Event
              </button>
            </div>
          ) : (
            <div className="schedule-events-list">
              {selectedEvents.map((event) => {
                const type = getType(event.type);

                return (
                  <article
                    className="schedule-event-card"
                    key={event.id}
                  >
                    <div className={`schedule-event-marker ${type.color}`} />

                    <div className="schedule-event-content">
                      <span className={`schedule-type-label ${type.color}`}>
                        {type.label}
                      </span>

                      <h3>{event.title}</h3>
                      {event.personName && (
                        <p className="schedule-event-notes">
                          {event.personName}
                        </p>
                      )}

                      <p className="schedule-event-time">
                        {formatTime(event.time)} –{" "}
                        {formatTime(event.endTime)}
                      </p>

                      {event.notes && (
                        <p className="schedule-event-notes">
                          {event.notes}
                        </p>
                      )}

                      <div className="schedule-event-actions">
                        {!event.isApplication && (
                          <>
                            <button onClick={() => openEditEvent(event)}>
                              Edit
                            </button>
                            <button
                              className="schedule-delete"
                              onClick={() => deleteEvent(event.id)}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="upcoming-section">
            <h3>Upcoming events</h3>

            {events
              .filter((event) => event.date >= todayKey)
              .sort((a, b) =>
                `${a.date}T${a.time}`.localeCompare(
                  `${b.date}T${b.time}`
                )
              )
              .slice(0, 5)
              .map((event) => (
                <button
                  className="upcoming-event"
                  key={event.id}
                  onClick={() => {
                    setSelectedDate(event.date);
                    const date = new Date(`${event.date}T12:00:00`);
                    setCurrentMonth(
                      new Date(date.getFullYear(), date.getMonth(), 1)
                    );
                    setView("day");
                  }}
                >
                  <span className={`summary-dot ${getType(event.type).color}`} />

                  <span className="upcoming-event-details">
                    <strong>{event.title}</strong>
                    <small>
                      {new Date(`${event.date}T12:00:00`).toLocaleDateString(
                        undefined,
                        { day: "numeric", month: "short" }
                      )}{" "}
                      · {formatTime(event.time)}
                      {event.personName && ` · ${event.personName}`}
                    </small>
                  </span>

                  <span className="upcoming-chevron">›</span>
                </button>
              ))}

            {events.filter((event) => event.date >= todayKey).length === 0 && (
              <p className="upcoming-empty">No upcoming events.</p>
            )}
          </div>
        </aside>
      </section>

      {/* Add/Edit event modal */}
      {showForm && (
        <div
          className="calendar-modal-backdrop"
          onClick={() => setShowForm(false)}
        >
          <section
            className="calendar-form-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit event" : "Add event"}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="calendar-modal-header">
              <div>
                <h2>{editingId ? "Edit Event" : "Add Event"}</h2>
                <p>Add an event to your calendar.</p>
              </div>

              <button
                className="calendar-modal-close"
                onClick={() => setShowForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <form className="calendar-event-form" onSubmit={saveEvent}>
              <div className="calendar-form-group">
                <label htmlFor="event-title">Event title</label>
                <input
                  id="event-title"
                  name="title"
                  value={form.title}
                  onChange={handleFormChange}
                  placeholder="e.g. Semester exam"
                  maxLength={150}
                  required
                  autoFocus
                />
              </div>

              <div className="calendar-form-group">
                <label htmlFor="event-type">Event type</label>
                <select
                  id="event-type"
                  name="type"
                  value={form.type}
                  onChange={handleFormChange}
                >
                  {eventTypes.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="calendar-form-group">
                <label htmlFor="event-person">Person</label>
                <select
                  id="event-person"
                  name="personId"
                  value={form.personId}
                  onChange={handleFormChange}
                  required
                >
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="calendar-form-group">
                <label htmlFor="event-date">Date</label>
                <input
                  id="event-date"
                  name="date"
                  type="date"
                  value={form.date}
                  onChange={handleFormChange}
                  required
                />
              </div>

              <div className="calendar-form-row">
                <div className="calendar-form-group">
                  <label htmlFor="event-time">Start time</label>
                  <input
                    id="event-time"
                    name="time"
                    type="time"
                    value={form.time}
                    onChange={handleFormChange}
                    required
                  />
                </div>

                <div className="calendar-form-group">
                  <label htmlFor="event-end-time">End time</label>
                  <input
                    id="event-end-time"
                    name="endTime"
                    type="time"
                    value={form.endTime}
                    onChange={handleFormChange}
                    required
                  />
                </div>
              </div>

              <div className="calendar-form-group">
                <label htmlFor="event-notes">Notes (optional)</label>
                <textarea
                  id="event-notes"
                  name="notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  placeholder="Add exam details or reminders..."
                  rows={3}
                />
              </div>

              <div className="calendar-form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={saving}
                >
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Save Changes"
                      : "Add Event"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export default Calendar;
