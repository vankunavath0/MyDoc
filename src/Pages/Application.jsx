import { useEffect, useRef, useState } from "react";
import "./Application.css";

import {
  createPerson,
  getApplications,
  getPeople,
  saveApplicationToCloud,
  deleteApplicationFromCloud,
  getPdfPreviewUrl,
} from "../services/cloudFiles";

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const formatSize = (bytes = 0) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

const getType = (fileName = "", mimeType = "") => {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";

  if (
    mimeType.startsWith("image/") ||
    ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(ext)
  ) {
    return "image";
  }
  if (mimeType === "application/pdf" || ext === "pdf") return "pdf";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";

  if (
    mimeType.startsWith("text/") ||
    ["txt", "json", "csv", "md", "xml"].includes(ext)
  ) {
    return "text";
  }

  if (["doc", "docx", "odt"].includes(ext)) return "word";
  if (["xls", "xlsx", "ods"].includes(ext)) return "excel";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slides";

  return "other";
};

const createEmptyForm = () => ({
  name: "",
  category: "Application",
  examDate: "",
  deadline: "",
  resultDate: "",
  notes: "",
  file: null,
});

const DEFAULT_PERSON_ID = "local-demo-user";

function Application() {
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [applications, setApplications] = useState([]);
  const [preview, setPreview] = useState(null);
  const [editing, setEditing] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userName, setUserName] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dragging, setDragging] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [pageError, setPageError] = useState("");

  const inputRef = useRef(null);
  const applicationsRef = useRef([]);

  const [form, setForm] = useState(createEmptyForm);

  // Load applications saved in MongoDB.
  useEffect(() => {
    let cancelled = false;

    async function loadApplications() {
      setLoading(true);
      setPageError("");

      try {
        const [people, records] = await Promise.all([
          getPeople(),
          getApplications(),
        ]);

        if (cancelled) return;

        const mappedUsers = people.map((person) => ({
          id: person._id,
          name: person.name,
        }));
        setUsers(mappedUsers);
        setActiveUser((current) =>
          mappedUsers.some((person) => person.id === current)
            ? current
            : mappedUsers[0]?.id || null,
        );

        const mappedApplications = records.map((record) => ({
          id: record._id,
          userId: record.personId || DEFAULT_PERSON_ID,
          name: record.name || "",
          category: record.category || "Application",
          examDate: record.examDate || "",
          deadline: record.deadline || "",
          resultDate: record.resultDate || "",
          notes: record.notes || "",
          file: null,
          fileName: record.fileName || "",
          size: record.size || 0,
          type: getType(
            record.fileName || "",
            record.resourceType === "image"
              ? `image/${record.format || ""}`
              : record.format === "pdf"
                ? "application/pdf"
                : "",
          ),
          url: record.fileUrl || null,
          date: record.createdAt || new Date().toISOString(),
        }));

        setApplications(mappedApplications);
      } catch (error) {
        if (!cancelled) {
          setPageError(
            error.message ||
              "Could not load applications. Check whether the backend is running.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadApplications();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the latest application list available for cleanup.
  useEffect(() => {
    applicationsRef.current = applications;
  }, [applications]);

  // Clean up temporary local preview URLs.
  useEffect(() => {
    return () => {
      applicationsRef.current.forEach((item) => {
        if (item.url?.startsWith("blob:")) {
          URL.revokeObjectURL(item.url);
        }
      });
    };
  }, []);

  const currentApplications = applications.filter(
    (item) => item.userId === activeUser,
  );

  const visibleApplications = currentApplications.filter((item) => {
    const searchText = search.toLowerCase();

    const matchesSearch =
      item.name.toLowerCase().includes(searchText) ||
      item.category.toLowerCase().includes(searchText);

    const matchesFilter = filter === "all" || item.category === filter;

    return matchesSearch && matchesFilter;
  });

  const resetForm = () => {
    setForm(createEmptyForm());
    setEditing(null);
    setShowForm(false);
  };

  const updateForm = (event) => {
    const { name, value, files } = event.target;

    setForm((current) => ({
      ...current,
      [name]: name === "file" ? (files?.[0] ?? null) : value,
    }));
  };

  const openNewApplicationForm = () => {
    setEditing(null);
    setForm(createEmptyForm());
    setPageError("");
    setShowForm(true);
  };

  const handleSelectedFile = (file) => {
    if (!file) return;

    setEditing(null);
    setForm({
      ...createEmptyForm(),
      name: file.name.replace(/\.[^.]+$/, ""),
      file,
    });
    setPageError("");
    setShowForm(true);
  };

  const addUser = async (event) => {
    event.preventDefault();

    const name = userName.trim();
    if (!name) return;

    try {
      const saved = await createPerson({ id: makeId(), name });
      const user = { id: saved._id, name: saved.name };

      setUsers((current) => [...current, user]);
      setActiveUser(user.id);
      setUserName("");
      setShowUserForm(false);
      setPageError("");
    } catch (error) {
      setPageError(error.message || "Could not save user.");
    }
  };

  // Create a new application or update an existing application.
  const saveApplication = async (event) => {
    event.preventDefault();

    const name = form.name.trim();

    if (!name) {
      setPageError("Please enter an application name.");
      return;
    }

    setSaving(true);
    setPageError("");

    const file = form.file;
    const oldItem = editing
      ? applications.find((item) => item.id === editing)
      : null;

    try {
      const saved = await saveApplicationToCloud(
        {
          name,
          category: form.category,
          examDate: form.examDate,
          deadline: form.deadline,
          resultDate: form.resultDate,
          notes: form.notes,
          personId: oldItem?.userId ?? activeUser,
        },
        file,
        editing || null,
      );

      const item = {
        id: saved._id,
        userId: saved.personId || oldItem?.userId || activeUser,
        name: saved.name || name,
        category: saved.category || form.category,
        examDate: saved.examDate || "",
        deadline: saved.deadline || "",
        resultDate: saved.resultDate || "",
        notes: saved.notes || "",
        file: null,
        fileName:
          saved.fileName || (file ? file.name : oldItem?.fileName || ""),
        size: saved.size || (file ? file.size : oldItem?.size || 0),
        type: getType(
          saved.fileName || file?.name || oldItem?.fileName || "",
          file?.type || "",
        ),
        url: saved.fileUrl || oldItem?.url || null,
        date: saved.createdAt || oldItem?.date || new Date().toISOString(),
      };

      setApplications((current) =>
        editing
          ? current.map((entry) => (entry.id === editing ? item : entry))
          : [item, ...current],
      );

      if (preview?.id === editing) {
        setPreview(item);
      }

      resetForm();
    } catch (error) {
      setPageError(error.message || "Could not save the application.");
    } finally {
      setSaving(false);
    }
  };

  const editApplication = (item) => {
    setEditing(item.id);

    setForm({
      name: item.name,
      category: item.category,
      examDate: item.examDate,
      deadline: item.deadline,
      resultDate: item.resultDate,
      notes: item.notes,
      file: null,
    });

    setPageError("");
    setShowForm(true);
  };

  // Delete from Cloudinary/MongoDB through the backend.
  const deleteApplication = async (id) => {
    const item = applications.find((entry) => entry.id === id);
    if (!item) return;

    const confirmed = window.confirm(
      `Delete "${item.name}"? This will remove its saved record and uploaded file.`,
    );

    if (!confirmed) return;

    setDeletingId(id);
    setPageError("");

    try {
      await deleteApplicationFromCloud(id);

      if (preview?.id === id) {
        setPreview(null);
      }

      if (item.url?.startsWith("blob:")) {
        URL.revokeObjectURL(item.url);
      }

      setApplications((current) => current.filter((entry) => entry.id !== id));
    } catch (error) {
      setPageError(error.message || "Could not delete the application.");
    } finally {
      setDeletingId(null);
    }
  };

  const shareApplication = async (item) => {
    const shareData = {
      title: item.name,
      text: [
        `Type: ${item.category}`,
        item.examDate && `Exam date: ${item.examDate}`,
        item.deadline && `Deadline: ${item.deadline}`,
        item.resultDate && `Result date: ${item.resultDate}`,
        item.url && `File: ${item.url}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(
          `${shareData.title}\n${shareData.text}`,
        );

        alert("Application details copied to clipboard.");
      } else {
        alert("Sharing is not supported in this browser.");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        alert("Unable to share these details.");
      }
    }
  };

  const previewContent = (item) => {
    if (!item.url) {
      return (
        <div className="unsupported-preview">
          <h3>{item.name}</h3>
          <p>No file is attached to this application yet.</p>
        </div>
      );
    }

    if (item.type === "image") {
      return (
        <img
          className="large-image"
          src={item.url}
          alt={item.fileName || item.name}
        />
      );
    }

    if (item.type === "pdf") {
      return (
        <iframe
          className="pdf-preview"
          src={getPdfPreviewUrl(item.url)}
          title={item.fileName || item.name}
        />
      );
    }

    if (item.type === "video") {
      return <video src={item.url} controls className="media-preview" />;
    }

    if (item.type === "audio") {
      return <audio src={item.url} controls />;
    }

    if (item.type === "text" && item.file) {
      return <TextPreview file={item.file} />;
    }

    return (
      <div className="unsupported-preview">
        <div className={`file-icon ${item.type}`}>
          {item.type.toUpperCase()}
        </div>

        <h3>{item.fileName || item.name}</h3>

        <p>
          This file format cannot be previewed directly in the browser. Download
          the file to open it.
        </p>

        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="primary-button"
          download={item.fileName || undefined}
        >
          Open / Download file
        </a>
      </div>
    );
  };

  const openApplicationPreview = (item) => {
    if (!item.url) {
      setPreview(item);
      return;
    }

    const url = item.type === "pdf" ? getPdfPreviewUrl(item.url) : item.url;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const formatDate = (date) => {
    if (!date) return "Not set";

    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const selectedUser = users.find((user) => user.id === activeUser);

  return (
    <main className="application-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">PERSONAL WORKSPACE</span>
          <h1>Applications</h1>
          <p>Manage applications, hall tickets, exam dates and results.</p>
        </div>

        <button className="primary-button" onClick={openNewApplicationForm}>
          + Add Application
        </button>
      </header>

      <section className="workspace-layout">
        <aside className="user-sidebar">
          <h2 className="sidebar-heading">Your Users</h2>

          <div className="user-list">
            {users.map((user) => (
              <button
                key={user.id}
                className={`user-item ${
                  activeUser === user.id ? "active" : ""
                }`}
                onClick={() => setActiveUser(user.id)}
              >
                <span className="user-avatar">
                  {user.name.charAt(0).toUpperCase()}
                </span>
                <span>{user.name}</span>
              </button>
            ))}
          </div>

          <button
            className="new-user-button"
            onClick={() => setShowUserForm(true)}
          >
            + New User
          </button>
        </aside>

        <section className="workspace-main">
          <div className="content-toolbar">
            <div>
              <h2>{selectedUser?.name ?? "Applications"}</h2>
              <p>
                {currentApplications.length} application
                {currentApplications.length !== 1 ? "s" : ""}
              </p>
            </div>

            <input
              className="search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search applications..."
              aria-label="Search applications"
            />
          </div>

          {pageError && (
            <div className="application-error" role="alert">
              {pageError}
            </div>
          )}

          {loading && (
            <p className="application-status">Loading applications…</p>
          )}

          <div className="application-filters">
            {["all", "Application", "Hall Ticket"].map((value) => (
              <button
                key={value}
                className={`filter-button ${filter === value ? "active" : ""}`}
                onClick={() => setFilter(value)}
              >
                {value === "all" ? "All" : value}
              </button>
            ))}
          </div>

          <div
            className={`upload-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setDragging(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              handleSelectedFile(event.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              hidden
              onChange={(event) => {
                handleSelectedFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="upload-symbol">↑</div>
            <h3>Upload an application or hall ticket</h3>
            <p>Drop a file here or select one from your computer.</p>

            <button
              type="button"
              className="secondary-button"
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </button>
          </div>

          {!loading && visibleApplications.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">▤</div>
              <h3>No applications found</h3>
              <p>
                Add an application or hall ticket for this user. Your files and
                dates will appear here.
              </p>

              <button
                className="primary-button"
                onClick={openNewApplicationForm}
              >
                + Add Application
              </button>
            </div>
          ) : (
            !loading && (
              <section className="document-grid">
                {visibleApplications.map((item) => (
                  <article className="document-card" key={item.id}>
                    <button
                      type="button"
                      className={`document-cover ${item.type}`}
                      onClick={() => openApplicationPreview(item)}
                      title={`Preview ${item.name}`}
                    >
                      {item.type === "image" && item.url ? (
                        <img src={item.url} alt={item.name} />
                      ) : (
                        <div className="generic-cover">
                          <span className={`file-icon ${item.type}`}>
                            {item.type === "pdf"
                              ? "PDF"
                              : item.type === "word"
                                ? "W"
                                : item.type === "excel"
                                  ? "X"
                                  : item.type === "slides"
                                    ? "P"
                                    : item.type === "image"
                                      ? "IMG"
                                      : "FILE"}
                          </span>

                          <div className="paper-lines" />
                          <div className="paper-lines" />
                          <div className="paper-lines short" />
                        </div>
                      )}

                      <span className="cover-view">Preview ↗</span>
                    </button>

                    <div className="document-info">
                      <span className="application-type">{item.category}</span>

                      <h3 title={item.name}>{item.name}</h3>

                      <div className="file-metadata">
                        <span>
                          {item.fileName
                            ? formatSize(item.size)
                            : "No file attached"}
                        </span>
                      </div>

                      <div className="application-dates">
                        <p>Exam: {formatDate(item.examDate)}</p>
                        <p>Deadline: {formatDate(item.deadline)}</p>
                        <p>Result: {formatDate(item.resultDate)}</p>
                      </div>

                      {item.notes && (
                        <p className="application-notes">{item.notes}</p>
                      )}

                      <div className="document-actions">
                        <button
                          className="view-button"
                          onClick={() => openApplicationPreview(item)}
                        >
                          Preview
                        </button>

                        {item.url && (
                          <a
                            className="download-button"
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            download={item.fileName || undefined}
                          >
                            Download
                          </a>
                        )}

                        <button
                          className="view-button"
                          onClick={() => shareApplication(item)}
                        >
                          Share
                        </button>

                        <button
                          className="view-button"
                          onClick={() => editApplication(item)}
                        >
                          Edit
                        </button>

                        <button
                          className="delete-button"
                          disabled={deletingId === item.id}
                          onClick={() => deleteApplication(item.id)}
                        >
                          {deletingId === item.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>
            )
          )}
        </section>
      </section>

      {/* Create user modal */}
      {showUserForm && (
        <div
          className="preview-backdrop"
          onClick={() => setShowUserForm(false)}
        >
          <section
            className="form-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create user"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <h2>New User</h2>

              <button
                className="close-button"
                onClick={() => setShowUserForm(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <form onSubmit={addUser}>
              <div className="form-group">
                <label className="form-label" htmlFor="userName">
                  User name
                </label>

                <input
                  id="userName"
                  className="form-input"
                  value={userName}
                  onChange={(event) => setUserName(event.target.value)}
                  placeholder="Enter user name"
                  required
                  autoFocus
                />
              </div>

              <button className="primary-button" type="submit">
                Create User
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Add/edit application modal */}
      {showForm && (
        <div className="preview-backdrop" onClick={resetForm}>
          <section
            className="form-modal"
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit application" : "Add application"}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <h2>{editing ? "Edit Application" : "Add Application"}</h2>
                <p>Enter details and attach the relevant file.</p>
              </div>

              <button
                type="button"
                className="close-button"
                onClick={resetForm}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            <form onSubmit={saveApplication}>
              <div className="form-group">
                <label className="form-label" htmlFor="applicationName">
                  Application name
                </label>

                <input
                  id="applicationName"
                  className="form-input"
                  name="name"
                  value={form.name}
                  onChange={updateForm}
                  placeholder="e.g. TCS NQT"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="category">
                  Type
                </label>

                <select
                  id="category"
                  className="form-select"
                  name="category"
                  value={form.category}
                  onChange={updateForm}
                >
                  <option>Application</option>
                  <option>Hall Ticket</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="file">
                  File {editing ? "(optional replacement)" : "(optional)"}
                </label>

                <input
                  id="file"
                  className="form-input"
                  type="file"
                  name="file"
                  onChange={updateForm}
                />

                {editing && !form.file && (
                  <small>Leave empty to keep the current file.</small>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="examDate">
                  Exam date
                </label>

                <input
                  id="examDate"
                  className="form-input"
                  type="date"
                  name="examDate"
                  value={form.examDate}
                  onChange={updateForm}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="deadline">
                  Application deadline
                </label>

                <input
                  id="deadline"
                  className="form-input"
                  type="date"
                  name="deadline"
                  value={form.deadline}
                  onChange={updateForm}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="resultDate">
                  Result date
                </label>

                <input
                  id="resultDate"
                  className="form-input"
                  type="date"
                  name="resultDate"
                  value={form.resultDate}
                  onChange={updateForm}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="notes">
                  Notes
                </label>

                <textarea
                  id="notes"
                  className="form-textarea"
                  name="notes"
                  value={form.notes}
                  onChange={updateForm}
                  placeholder="Add reminders or details..."
                  rows={3}
                />
              </div>

              <div className="form-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetForm}
                  disabled={saving}
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
                    : editing
                      ? "Save Changes"
                      : "Add Application"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* File preview modal */}
      {preview && (
        <div className="preview-backdrop" onClick={() => setPreview(null)}>
          <section
            className="preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${preview.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="preview-header">
              <div>
                <h2>{preview.name}</h2>

                <p>
                  {preview.fileName
                    ? formatSize(preview.size)
                    : "No attached file"}
                  {" · "}
                  {preview.category}
                </p>
              </div>

              <button
                className="close-button"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                ✕
              </button>
            </header>

            <div className="preview-body">{previewContent(preview)}</div>
          </section>
        </div>
      )}
    </main>
  );
}

function TextPreview({ file }) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    file
      .text()
      .then((text) => {
        if (active) setContent(text);
      })
      .catch(() => {
        if (active) setError("Unable to read this text file.");
      });

    return () => {
      active = false;
    };
  }, [file]);

  if (error) return <p>{error}</p>;

  return <pre className="text-preview">{content || "Loading text…"}</pre>;
}

export default Application;
