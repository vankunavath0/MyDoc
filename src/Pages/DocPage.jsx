
import { useEffect, useRef, useState } from "react";
import "./Doc.css";
import {
  createFolder as createFolderInCloud,
  createPerson,
  deleteFolder as deleteFolderFromCloud,
  deleteDocument as deleteDocumentFromCloud,
  deletePerson as deletePersonFromCloud,
  renameDocument as renameDocumentInCloud,
  renameFolder as renameFolderInCloud,
  getFolders,
  getDocuments,
  getPeople,
  getPdfPreviewUrl,
  uploadDocument,
} from "../services/cloudFiles";

const makeId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const DEFAULT_USER_ID = "local-demo-user";
const MAX_FILES_PER_UPLOAD = 10;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getFileType(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (file.type === "application/pdf" || ext === "pdf") return "pdf";
  if (file.type.startsWith("image/")) return "image";
  if (["txt", "csv", "json", "md", "xml"].includes(ext)) return "text";
  if (["doc", "docx", "odt"].includes(ext)) return "word";
  if (["xls", "xlsx", "ods"].includes(ext)) return "excel";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slides";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";

  return "file";
}

function Doc() {
  const [people, setPeople] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [personName, setPersonName] = useState("");
  const [search, setSearch] = useState("");
  const [fileSearch, setFileSearch] = useState("");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingDocuments, setLoadingDocuments] = useState(true);

  const [showUserForm, setShowUserForm] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [currentFolder, setCurrentFolder] = useState(null);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const inputRef = useRef(null);
  const peopleRef = useRef([]);

  const selectedPerson = people.find(
    (person) => person.id === selectedId
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDocuments() {
      try {
        const records = await getPeople();

        if (cancelled) return;

        const loadedPeople = await Promise.all(
          records.map(async (person) => {
            const [documents, folders] = await Promise.all([
              getDocuments(person._id),
              getFolders(person._id),
            ]);

            return {
              id: person._id,
              name: person.name,
              createdAt: person.createdAt,
              documents: documents.map((record) => ({
                id: record._id,
                file: null,
                name: record.name,
                size: record.size || 0,
                date: new Date(
                  record.documentDate || record.createdAt || Date.now()
                ),
                type: getFileType({
                  name: record.name,
                  type: record.resourceType === "image"
                    ? `image/${record.format || ""}`
                    : "",
                }),
                url: record.fileUrl,
                folderId: record.folderId || null,
              })),
              folders: folders.map((record) => ({
                id: record._id,
                name: record.name,
                parentId: record.parentId || null,
                date: new Date(record.createdAt),
              })),
            };
          })
        );
        setPeople(loadedPeople);
        setSelectedId((current) => current || loadedPeople[0]?.id || null);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError.message ||
              "Could not load documents. Check whether the backend is running."
          );
        }
      } finally {
        if (!cancelled) setLoadingDocuments(false);
      }
    }

    loadDocuments();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    peopleRef.current = people;
  }, [people]);

  useEffect(() => {
    return () => {
      peopleRef.current.forEach((person) => {
        person.documents.forEach((doc) => {
          if (doc.url?.startsWith("blob:")) URL.revokeObjectURL(doc.url);
        });
      });
    };
  }, []);

  const filteredPeople = people.filter((person) =>
    person.name.toLowerCase().includes(search.toLowerCase())
  );

  const folders = selectedPerson
    ? selectedPerson.folders.filter(
        (folder) => folder.parentId === currentFolder
      )
    : [];

  const documents = selectedPerson
    ? selectedPerson.documents.filter(
        (doc) =>
          doc.folderId === currentFolder &&
          doc.name.toLowerCase().includes(fileSearch.toLowerCase())
      )
    : [];

  async function addPerson(event) {
    event.preventDefault();

    const name = personName.trim();
    if (!name) return;

    try {
      const saved = await createPerson({ id: makeId(), name });
      const person = {
        id: saved._id,
        name: saved.name,
        createdAt: saved.createdAt,
        documents: [],
        folders: [],
      };

      setPeople((current) => [...current, person]);
      setSelectedId(person.id);
      setPersonName("");
      setCurrentFolder(null);
      setShowUserForm(false);
      setError("");
    } catch (createError) {
      setError(createError.message || "Could not save person.");
    }
  }

  async function uploadFiles(fileList) {
    if (!selectedPerson) {
      setError("Add or select a person before uploading files.");
      return;
    }

    const files = Array.from(fileList);
    if (files.length === 0) return;
    if (files.length > MAX_FILES_PER_UPLOAD) {
      setError(`You can upload up to ${MAX_FILES_PER_UPLOAD} files at a time.`);
      return;
    }

    setUploading(true);
    setError("");

    try {
      for (const file of files) {
        const saved = await uploadDocument(file, {
          name: file.name,
          documentDate: new Date().toISOString(),
          personId: selectedPerson.id,
          folderId: currentFolder,
        });
        const document = {
          id: saved._id,
          file: null,
          name: saved.name || file.name,
          size: saved.size || file.size,
          date: new Date(saved.documentDate || saved.createdAt),
          type: getFileType(file),
          url: saved.fileUrl,
          folderId: currentFolder,
        };

        setPeople((current) =>
          current.map((person) =>
            person.id === selectedPerson.id
              ? {
                  ...person,
                  documents: [document, ...person.documents],
                }
              : person
          )
        );
      }
    } catch (uploadError) {
      setError(uploadError.message || "Could not upload the document.");
    } finally {
      setUploading(false);
    }
  }

  async function addFolder(event) {
    event.preventDefault();

    const name = folderName.trim();
    if (!name || !selectedPerson) return;

    const duplicate = selectedPerson.folders.some(
      (folder) =>
        folder.parentId === currentFolder &&
        folder.name.toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      setError("A folder with this name already exists here.");
      return;
    }

    try {
      const saved = await createFolderInCloud({
        id: makeId(),
        name,
        personId: selectedPerson.id,
        parentId: currentFolder,
      });
      const folder = {
        id: saved._id,
        name: saved.name,
        parentId: saved.parentId || null,
        date: new Date(saved.createdAt),
      };

      setPeople((current) =>
        current.map((person) =>
          person.id === selectedId
            ? { ...person, folders: [...person.folders, folder] }
            : person
        )
      );
      setFolderName("");
      setShowFolderForm(false);
      setError("");
    } catch (createError) {
      setError(createError.message || "Could not save folder.");
    }
  }

  function openFolder(folder) {
    setCurrentFolder(folder.id);
    setFileSearch("");
    setPreview(null);
    setError("");
  }

  async function deleteDocument(docId) {
    const doc = selectedPerson?.documents.find(
      (item) => item.id === docId
    );

    if (!doc) return false;

    try {
      await deleteDocumentFromCloud(docId);

      if (preview?.id === docId) setPreview(null);
      if (doc.url?.startsWith("blob:")) URL.revokeObjectURL(doc.url);

      setPeople((current) =>
        current.map((person) =>
          person.id === selectedId
            ? {
                ...person,
                documents: person.documents.filter(
                  (item) => item.id !== docId
                ),
              }
            : person
        )
      );
      setError("");
      return true;
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete the document.");
      return false;
    }
  }

  async function deleteFolder(folderId) {
    const folderIds = new Set([folderId]);

    // Include all nested folders.
    let changed = true;
    while (changed) {
      changed = false;

      selectedPerson.folders.forEach((folder) => {
        if (
          folderIds.has(folder.parentId) &&
          !folderIds.has(folder.id)
        ) {
          folderIds.add(folder.id);
          changed = true;
        }
      });
    }

    const removedDocs = selectedPerson.documents.filter(
      (doc) => folderIds.has(doc.folderId)
    );

    const removedIds = new Set(removedDocs.map((doc) => doc.id));

    if (preview && removedIds.has(preview.id)) {
      setPreview(null);
    }

    try {
      await deleteFolderFromCloud(folderId);
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete folder documents.");
      return false;
    }

    removedDocs.forEach((doc) => {
      if (doc.url?.startsWith("blob:")) URL.revokeObjectURL(doc.url);
    });

    setPeople((current) =>
      current.map((person) =>
        person.id === selectedId
          ? {
              ...person,
              folders: person.folders.filter(
                (folder) => !folderIds.has(folder.id)
              ),
              documents: person.documents.filter(
                (doc) => !folderIds.has(doc.folderId)
              ),
            }
          : person
      )
    );

    if (folderIds.has(currentFolder)) {
      setCurrentFolder(null);
    }

    setError("");
    return true;
  }

  async function deletePerson(personId) {
    const person = people.find((item) => item.id === personId);
    if (!person || personId === DEFAULT_USER_ID) return false;

    try {
      await deletePersonFromCloud(personId);
    } catch (deleteError) {
      setError(deleteError.message || "Could not delete this person.");
      return false;
    }

    person.documents.forEach((doc) => {
      if (doc.url?.startsWith("blob:")) URL.revokeObjectURL(doc.url);
    });

    if (
      person.documents.some((doc) => doc.id === preview?.id)
    ) {
      setPreview(null);
    }

    setPeople((current) =>
      current.filter((item) => item.id !== personId)
    );

    if (selectedId === personId) {
      setSelectedId(null);
      setCurrentFolder(null);
    }
    return true;
  }

  async function saveRename(event) {
    event.preventDefault();
    const name = renameValue.trim();
    const maxLength = renameTarget?.type === "folder" ? 100 : 255;

    if (!renameTarget || !name || name.length > maxLength) return;

    setSavingRename(true);
    setError("");

    try {
      if (renameTarget.type === "folder") {
        const renamedFolder = await renameFolderInCloud(renameTarget.id, name);
        setPeople((current) =>
          current.map((person) =>
            person.id === selectedId
              ? {
                  ...person,
                  folders: person.folders.map((folder) =>
                    folder.id === renameTarget.id
                      ? { ...folder, name: renamedFolder.name }
                      : folder
                  ),
                }
              : person
          )
        );
      } else {
        const renamedDocument = await renameDocumentInCloud(
          renameTarget.id,
          name
        );
        setPeople((current) =>
          current.map((person) =>
            person.id === selectedId
              ? {
                  ...person,
                  documents: person.documents.map((doc) =>
                    doc.id === renameTarget.id
                      ? { ...doc, name: renamedDocument.name }
                      : doc
                  ),
                }
              : person
          )
        );
        setPreview((current) =>
          current?.id === renameTarget.id
            ? { ...current, name: renamedDocument.name }
            : current
        );
      }

      setRenameTarget(null);
      setRenameValue("");
    } catch (renameError) {
      setError(renameError.message || "Could not rename item.");
    } finally {
      setSavingRename(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;

    setDeleting(true);

    try {
      if (deleteTarget.type === "document") {
        await deleteDocument(deleteTarget.id);
      } else if (deleteTarget.type === "folder") {
        await deleteFolder(deleteTarget.id);
      } else {
        await deletePerson(deleteTarget.id);
      }

      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function shareDocument(doc) {
    try {
      if (navigator.share && doc.file) {
        await navigator.share({
          title: doc.name,
          files: [doc.file],
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(
          `${doc.name} (${formatSize(doc.size)})`
        );
        alert("File details copied. The actual file was not shared.");
      } else {
        alert("Sharing is not supported in this browser.");
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        alert("Unable to share this file.");
      }
    }
  }

  function openDocumentPreview(doc) {
    if (!doc.url) {
      setPreview(doc);
      return;
    }

    const url = doc.type === "pdf" ? getPdfPreviewUrl(doc.url) : doc.url;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function renderPreview(doc) {
    if (doc.type === "image") {
      return (
        <img
          className="doc-large-image"
          src={doc.url}
          alt={doc.name}
        />
      );
    }

    if (doc.type === "pdf") {
      return (
        <iframe
          className="doc-pdf-preview"
          src={getPdfPreviewUrl(doc.url)}
          title={doc.name}
        />
      );
    }

    if (doc.type === "video") {
      return (
        <video
          className="doc-media"
          src={doc.url}
          controls
        />
      );
    }

    if (doc.type === "audio") {
      return <audio src={doc.url} controls />;
    }

    if (doc.type === "text") {
      return <TextFilePreview file={doc.file} url={doc.url} />;
    }

    return (
      <div className="doc-no-preview">
        <div className={`doc-file-icon ${doc.type}`}>
          {doc.type.toUpperCase()}
        </div>
        <h3>{doc.name}</h3>
        <p>
          Direct preview is not available for this format.
          Download the file to open it in a compatible application.
        </p>
        <a
          className="doc-primary-button"
          href={doc.url}
          download={doc.name}
        >
          Download file
        </a>
      </div>
    );
  }

  return (
    <main className="doc-manager">
      <header className="doc-header">
        <div>
          <span className="doc-eyebrow">DOCUMENT WORKSPACE</span>
          <h1>Documents</h1>
          <p>Organize personal and family documents in one place.</p>
        </div>

        <div className="doc-total">
          <strong>{people.length}</strong>
          <span>Users</span>
        </div>
      </header>

      {error && <p className="doc-error" role="alert">{error}</p>}
      {loadingDocuments && people.length === 0 && (
        <p className="doc-empty-state">Loading saved people and documents…</p>
      )}

      <div className="doc-layout">
        <aside className="people-panel">
          <div className="people-panel-heading">
            <div>
              <h2>People</h2>
              <p>Select a person to view their files.</p>
            </div>
            <span className="people-count">{people.length}</span>
          </div>

          <button
            className="doc-primary-button"
            onClick={() => setShowUserForm(true)}
          >
            + New User
          </button>

          <input
            className="people-search"
            placeholder="Search people..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search people"
          />

          <div className="people-list">
            {filteredPeople.map((person) => {
              const isSelected = person.id === selectedId;

              return (
                <div
                  className={`person-box ${isSelected ? "selected" : ""}`}
                  key={person.id}
                >
                  <button
                    className="person-select"
                    onClick={() => {
                      setSelectedId(person.id);
                      setCurrentFolder(null);
                      setPreview(null);
                      setError("");
                    }}
                  >
                    <span className="person-avatar">
                      {person.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="person-details">
                      <strong>{person.name}</strong>
                      <small>
                        {person.documents.length} documents
                      </small>
                    </span>
                    <span className="person-arrow">
                      {isSelected ? "●" : "›"}
                    </span>
                  </button>

                  {person.id !== DEFAULT_USER_ID && <button
                    className="person-delete"
                    aria-label={`Delete ${person.name}`}
                    title="Delete person"
                    onClick={() =>
                      setDeleteTarget({
                        type: "person",
                        id: person.id,
                        name: person.name,
                      })
                    }
                  >
                    ×
                  </button>}
                </div>
              );
            })}

            {filteredPeople.length === 0 && (
              <p className="people-empty">
                {people.length === 0
                  ? "Add your first person."
                  : "No matching people."}
              </p>
            )}
          </div>
        </aside>

        <section className="person-documents">
          {selectedPerson ? (
            <>
              <div className="selected-person-header">
                <div className="selected-person-avatar">
                  {selectedPerson.name.charAt(0).toUpperCase()}
                </div>

                <div className="selected-person-title">
                  <span className="doc-eyebrow">PERSONAL FILES</span>
                  <h2>{selectedPerson.name}</h2>
                  <p>
                    {selectedPerson.documents.length} documents
                  </p>
                  {selectedPerson.createdAt && (
                    <p>
                      Person added{" "}
                      {new Date(selectedPerson.createdAt).toLocaleDateString(
                        undefined,
                        { day: "numeric", month: "short", year: "numeric" }
                      )}
                    </p>
                  )}
                </div>
              </div>

              <div className="doc-toolbar">
                <div className="doc-breadcrumbs">
                  <button
                    onClick={() => {
                      setCurrentFolder(null);
                      setError("");
                    }}
                  >
                    All Documents
                  </button>

                  {currentFolder && (
                    <>
                      <span> / </span>
                      <span>
                        {selectedPerson.folders.find(
                          (folder) => folder.id === currentFolder
                        )?.name}
                      </span>
                      <button
                        onClick={() => {
                          const folder = selectedPerson.folders.find(
                            (item) => item.id === currentFolder
                          );
                          setCurrentFolder(folder?.parentId ?? null);
                          setError("");
                        }}
                      >
                        Back
                      </button>
                    </>
                  )}
                </div>

                <input
                  className="people-search"
                  placeholder="Search documents..."
                  value={fileSearch}
                  onChange={(event) => setFileSearch(event.target.value)}
                  aria-label="Search documents"
                />
              </div>

              <div
                className={`doc-dropzone ${dragging ? "active" : ""}`}
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
                  uploadFiles(event.dataTransfer.files);
                }}
              >
                <div className="doc-upload-icon">↑</div>
                <strong>Upload documents</strong>
                <p>
                  Drag files here or choose up to {MAX_FILES_PER_UPLOAD} files
                  from your device at a time.
                </p>
                <button
                  className="doc-secondary-button"
                  disabled={uploading}
                  onClick={() => inputRef.current?.click()}
                >
                  {uploading ? "Uploading…" : "+ Add Document"}
                </button>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  hidden
                  disabled={uploading}
                  onChange={(event) => {
                    uploadFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>

              <div className="person-files-heading">
                <div>
                  <h3>
                    {currentFolder
                      ? "Folder Contents"
                      : "Your Documents"}
                  </h3>
                  <p>
                    {folders.length} folders · {documents.length} documents
                  </p>
                </div>

                <button
                  className="doc-secondary-button"
                  onClick={() => setShowFolderForm(true)}
                >
                  + Add Folder
                </button>
              </div>

              {loadingDocuments && selectedPerson.documents.length === 0 ? (
                <div className="doc-empty-state">
                  <p>Loading saved documents…</p>
                </div>
              ) : folders.length === 0 && documents.length === 0 ? (
                <div className="doc-empty-state">
                  <div className="doc-empty-icon">▤</div>
                  <h3>This folder is empty</h3>
                  <p>Add a folder or upload your first document here.</p>
                </div>
              ) : (
                <div className="person-file-grid">
                  {folders.map((folder) => (
                    <article className="person-file-card" key={folder.id}>
                      <button
                        className="person-file-cover folder-cover"
                        onClick={() => openFolder(folder)}
                        title={`Open ${folder.name}`}
                      >
                        <span className="folder-large-icon">📁</span>
                        <span className="person-file-view">
                          Open Folder ↗
                        </span>
                      </button>

                      <div className="person-file-info">
                        <h4 title={folder.name}>{folder.name}</h4>
                        {folder.date && (
                          <div className="person-file-meta">
                            <span>
                              Created{" "}
                              {folder.date.toLocaleDateString(undefined, {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              })}
                            </span>
                          </div>
                        )}
                        <div className="person-file-actions">
                          <button
                            className="person-view-btn"
                            onClick={() => openFolder(folder)}
                          >
                            Open
                          </button>
                          <button
                            onClick={() => {
                              setRenameTarget({
                                type: "folder",
                                id: folder.id,
                                name: folder.name,
                              });
                              setRenameValue(folder.name);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            className="person-remove-btn"
                            onClick={() =>
                              setDeleteTarget({
                                type: "folder",
                                id: folder.id,
                                name: folder.name,
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}

                  {documents.map((doc) => (
                    <article className="person-file-card" key={doc.id}>
                      <button
                        className={`person-file-cover ${doc.type}`}
                        onClick={() => openDocumentPreview(doc)}
                        title={`Preview ${doc.name}`}
                      >
                        {doc.type === "image" ? (
                          <img src={doc.url} alt={doc.name} />
                        ) : (
                          <div className="person-file-paper">
                            <span className={`doc-file-icon ${doc.type}`}>
                              {doc.type === "word" ? "W" :
                               doc.type === "excel" ? "X" :
                               doc.type === "slides" ? "P" :
                               doc.type === "pdf" ? "PDF" :
                               doc.type === "video" ? "▶" :
                               doc.type === "audio" ? "♫" :
                               doc.type === "text" ? "TXT" : "FILE"}
                            </span>
                            <div className="doc-paper-line" />
                            <div className="doc-paper-line" />
                            <div className="doc-paper-line short" />
                          </div>
                        )}
                        <span className="person-file-view">
                          Preview ↗
                        </span>
                      </button>

                      <div className="person-file-info">
                        <h4 title={doc.name}>{doc.name}</h4>
                        <div className="person-file-meta">
                          <span>{formatSize(doc.size)}</span>
                          <span>
                            {doc.date.toLocaleDateString(undefined, {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </span>
                        </div>

                        <div className="person-file-actions">
                          <button
                            className="person-view-btn"
                            onClick={() => openDocumentPreview(doc)}
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => {
                              setRenameTarget({
                                type: "document",
                                id: doc.id,
                                name: doc.name,
                              });
                              setRenameValue(doc.name);
                            }}
                          >
                            Rename
                          </button>
                          <a href={doc.url} download={doc.name}>
                            Download
                          </a>
                          <button onClick={() => shareDocument(doc)}>
                            Share
                          </button>
                          <button
                            className="person-remove-btn"
                            onClick={() =>
                              setDeleteTarget({
                                type: "document",
                                id: doc.id,
                                name: doc.name,
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="doc-welcome-state">
              <div className="doc-empty-icon">▤</div>
              <h2>Select a person</h2>
              <p>
                Choose a person from the sidebar or add a new user
                to organize their documents.
              </p>
              <button
                className="doc-primary-button"
                onClick={() => setShowUserForm(true)}
              >
                + New User
              </button>
            </div>
          )}
        </section>
      </div>

      {deleteTarget && (
        <div
          className="doc-preview-backdrop"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <section
            className="doc-form-modal confirmation-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-confirmation-title"
            aria-describedby="delete-confirmation-message"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="doc-preview-header">
              <h2 id="delete-confirmation-title">
                Delete {deleteTarget.type}?
              </h2>
            </header>
            <p id="delete-confirmation-message" className="confirmation-message">
              {deleteTarget.type === "person"
                ? `Delete "${deleteTarget.name}" and all of their files, folders, applications, and calendar events? This cannot be undone.`
                : deleteTarget.type === "folder"
                  ? `Delete "${deleteTarget.name}" and everything inside it? This cannot be undone.`
                  : `Delete "${deleteTarget.name}"? This cannot be undone.`}
            </p>
            <div className="confirmation-actions">
              <button
                className="doc-secondary-button"
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="danger-button"
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </section>
        </div>
      )}

      {renameTarget && (
        <div
          className="doc-preview-backdrop"
          onClick={() => {
            if (!savingRename) setRenameTarget(null);
          }}
        >
          <section
            className="doc-form-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-item-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="doc-preview-header">
              <h2 id="rename-item-title">
                Rename {renameTarget.type === "folder" ? "folder" : "file"}
              </h2>
              <button
                className="doc-preview-close"
                type="button"
                disabled={savingRename}
                onClick={() => setRenameTarget(null)}
                aria-label="Close rename dialog"
              >
                ×
              </button>
            </header>
            <form onSubmit={saveRename}>
              <label htmlFor="rename-item">Name</label>
              <input
                id="rename-item"
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                maxLength={renameTarget.type === "folder" ? 100 : 255}
                required
                autoFocus
              />
              {error && <p className="doc-error" role="alert">{error}</p>}
              <div className="confirmation-actions">
                <button
                  className="doc-secondary-button"
                  type="button"
                  disabled={savingRename}
                  onClick={() => setRenameTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="doc-primary-button"
                  type="submit"
                  disabled={savingRename || !renameValue.trim()}
                >
                  {savingRename ? "Saving…" : "Save name"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showUserForm && (
        <div
          className="doc-preview-backdrop"
          onClick={() => setShowUserForm(false)}
        >
          <section
            className="doc-form-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Add new user"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="doc-preview-header">
              <h2>New User</h2>
              <button
                className="doc-preview-close"
                onClick={() => setShowUserForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <form onSubmit={addPerson}>
              <label htmlFor="person-name">Person's name</label>
              <input
                id="person-name"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                placeholder="Enter name"
                maxLength={100}
                required
                autoFocus
              />
              <button className="doc-primary-button" type="submit">
                Create User
              </button>
            </form>
          </section>
        </div>
      )}

      {showFolderForm && (
        <div
          className="doc-preview-backdrop"
          onClick={() => setShowFolderForm(false)}
        >
          <section
            className="doc-form-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Create folder"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="doc-preview-header">
              <h2>New Folder</h2>
              <button
                className="doc-preview-close"
                onClick={() => setShowFolderForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </header>

            <form onSubmit={addFolder}>
              <label htmlFor="folder-name">Folder name</label>
              <input
                id="folder-name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="e.g. Education Documents"
                maxLength={100}
                required
                autoFocus
              />
              <button className="doc-primary-button" type="submit">
                Create Folder
              </button>
            </form>
          </section>
        </div>
      )}

      {preview && selectedPerson?.documents.some(
        (doc) => doc.id === preview.id
      ) && (
        <div
          className="doc-preview-backdrop"
          onClick={() => setPreview(null)}
        >
          <section
            className="doc-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${preview.name}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="doc-preview-header">
              <div>
                <h2>{preview.name}</h2>
                <p>
                  {selectedPerson.name} · {formatSize(preview.size)}
                </p>
              </div>
              <button
                className="doc-preview-close"
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                ×
              </button>
            </header>

            <div className="doc-preview-body">
              {renderPreview(preview)}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function TextFilePreview({ file, url }) {
  const [content, setContent] = useState("Loading text...");

  useEffect(() => {
    let active = true;

    const textPromise = file
      ? file.text()
      : fetch(url).then((response) => {
          if (!response.ok) throw new Error("Could not load text file.");
          return response.text();
        });

    textPromise
      .then((text) => {
        if (active) setContent(text);
      })
      .catch(() => {
        if (active) setContent("Unable to read this text file.");
      });

    return () => {
      active = false;
    };
  }, [file, url]);

  return <pre className="doc-text-preview">{content}</pre>;
}

export default Doc;
