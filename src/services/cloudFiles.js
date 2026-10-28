
const API_BASE_URL = (
  import.meta.env.VITE_API_URL ||
  "https://mydoc-backend-qhsu.onrender.com"
).replace(/\/+$/, "");
const API_URL = `${API_BASE_URL}/api/documents`;
const APPLICATIONS_URL = `${API_BASE_URL}/api/applications`;
const PEOPLE_URL = `${API_BASE_URL}/api/people`;
const FOLDERS_URL = `${API_BASE_URL}/api/folders`;
const CALENDAR_EVENTS_URL = `${API_BASE_URL}/api/calendar-events`;

async function requestJson(url, options, errorMessage) {
  const response = await fetch(url, { credentials: "include", ...options });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || errorMessage);
  }

  return response.json();
}

export async function login(password, rememberDevice) {
  return requestJson(
    `${API_BASE_URL}/api/auth/login`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, rememberDevice }),
    },
    "Could not sign in"
  );
}

export async function getCurrentSession() {
  return requestJson(
    `${API_BASE_URL}/api/auth/session`,
    undefined,
    "Sign-in required"
  );
}

export async function restoreRememberedSession() {
  return requestJson(
    `${API_BASE_URL}/api/auth/remembered-login`,
    { method: "POST" },
    "This device is not remembered"
  );
}

export async function logout({ preserveRememberedDevice = false } = {}) {
  return requestJson(
    `${API_BASE_URL}/api/auth/logout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preserveRememberedDevice }),
    },
    "Could not sign out"
  );
}

export function getInlinePdfUrl(fileUrl) {
  if (!fileUrl || fileUrl.includes("/fl_inline/")) return fileUrl;
  return fileUrl.replace("/upload/", "/upload/fl_inline/");
}

export async function refreshSession() {
  return requestJson(
    `${API_BASE_URL}/api/auth/session`,
    undefined,
    "Session expired"
  );
}

export async function getPeople() {
  return requestJson(PEOPLE_URL, undefined, "Could not load people");
}

export async function createPerson(person) {
  return requestJson(
    PEOPLE_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(person),
    },
    "Could not save person"
  );
}

export async function deletePerson(id) {
  return requestJson(`${PEOPLE_URL}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, "Could not delete person");
}

export async function getFolders(personId) {
  const query = new URLSearchParams({ personId });
  return requestJson(`${FOLDERS_URL}?${query}`, undefined, "Could not load folders");
}

export async function createFolder(folder) {
  return requestJson(
    FOLDERS_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(folder),
    },
    "Could not save folder"
  );
}

export async function deleteFolder(id) {
  return requestJson(`${FOLDERS_URL}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, "Could not delete folder");
}

export async function renameFolder(id, name) {
  return requestJson(
    `${FOLDERS_URL}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    "Could not rename folder"
  );
}

export async function getCalendarEvents() {
  return requestJson(CALENDAR_EVENTS_URL, undefined, "Could not load calendar events");
}

export async function saveCalendarEvent(event, id) {
  return requestJson(
    id ? `${CALENDAR_EVENTS_URL}/${encodeURIComponent(id)}` : CALENDAR_EVENTS_URL,
    {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
    "Could not save calendar event"
  );
}

export async function deleteCalendarEvent(id) {
  return requestJson(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  }, "Could not delete calendar event");
}

// ==================== DOCUMENTS ====================

export async function uploadDocument(file, options = {}) {
  const formData = new FormData();

  formData.append("file", file);
  formData.append("name", options.name || file.name);
  formData.append("category", options.category || "document");
  formData.append(
    "documentDate",
    options.documentDate || new Date().toISOString()
  );

  if (options.personId) {
    formData.append("personId", options.personId);
  }

  if (options.folderId) {
    formData.append("folderId", options.folderId);
  }

  const response = await fetch(API_URL, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Upload failed");
  }

  return response.json();
}

export async function getDocuments(personId) {
  const url = personId
    ? `${API_URL}?${new URLSearchParams({ personId })}`
    : API_URL;
  return requestJson(url, undefined, "Could not load cloud documents");
}

export async function deleteDocument(id) {
  const response = await fetch(`${API_URL}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not delete cloud document");
  }

  return response.json();
}

export async function renameDocument(id, name) {
  return requestJson(
    `${API_URL}/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
    "Could not rename document"
  );
}

// ==================== APPLICATIONS ====================

export async function getApplications(personId) {
  const url = personId
    ? `${APPLICATIONS_URL}?${new URLSearchParams({ personId })}`
    : APPLICATIONS_URL;
  return requestJson(url, undefined, "Could not load applications");
}

export async function saveApplicationToCloud(application, file, id) {
  const formData = new FormData();

  Object.entries(application).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      formData.append(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value)
      );
    }
  });

  if (file) {
    formData.append("file", file);
  }

  const url = id
    ? `${APPLICATIONS_URL}/${id}`
    : APPLICATIONS_URL;

  const response = await fetch(url, {
    method: id ? "PUT" : "POST",
    body: formData,
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Could not save application");
  }

  return response.json();
}

export async function deleteApplicationFromCloud(id) {
  const response = await fetch(`${APPLICATIONS_URL}/${id}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Could not delete application");
  }

  return response.json();
}
