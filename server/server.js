const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("mongoose");
const { v2: cloudinary } = require("cloudinary");
const Document = require("./models/Document");
require("dotenv").config();
const Application = require("./models/Application");
const Person = require("./models/Person");
const Folder = require("./models/Folder");
const CalendarEvent = require("./models/CalendarEvent");
const AuthSession = require("./models/AuthSession");
const {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} = require("node:crypto");

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "https://mydoc-k6h0.onrender.com",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.error("Blocked CORS origin:", origin);
      return callback(new Error("Origin is not allowed by CORS."));
    },
    credentials: true,
  })
);

// Parse JSON and URL-encoded requests before the routes.
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/health", (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  const authConfigured = Boolean(process.env.AUTH_PASSWORD);
  const ready = databaseReady && authConfigured;

  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "starting",
    database: databaseReady ? "connected" : "disconnected",
    authentication: authConfigured
      ? "configured"
      : "missing configuration",
  });
});

const dns = require("node:dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const OWNER_ID = "local-demo-user";
const DEFAULT_PERSON_ID = OWNER_ID;
const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;
const REMEMBER_DEVICE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_COOKIE = "docspace_session";
const DEVICE_COOKIE = "docspace_device";
const loginAttempts = new Map();

function getCookie(req, name) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  return cookie
    ? decodeURIComponent(cookie.slice(name.length + 1))
    : null;
}

function setCookie(res, name, value, maxAge) {
  const production = process.env.NODE_ENV === "production";
  const secure = production ? "; Secure" : "";
  const sameSite = production ? "None" : "Strict";

  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=${sameSite}; Path=/; Max-Age=${maxAge}${secure}`
  );
}

function clearCookie(res, name) {
  setCookie(res, name, "", 0);
}

function hashToken(value) {
  return createHash("sha256").update(value).digest("hex");
}

function passwordMatches(candidate) {
  const expected = createHash("sha256")
    .update(process.env.AUTH_PASSWORD || "")
    .digest();

  const actual = createHash("sha256").update(candidate).digest();

  return timingSafeEqual(expected, actual);
}

async function createAuthSession(res, session, deviceToken = null) {
  const sessionToken = randomBytes(32).toString("base64url");
  const now = Date.now();
  const sessionExpiresAt = new Date(now + SESSION_IDLE_MS);

  session.sessionTokenHash = hashToken(sessionToken);
  session.sessionExpiresAt = sessionExpiresAt;

  if (deviceToken) {
    session.deviceTokenHash = hashToken(deviceToken);
    session.deviceExpiresAt = new Date(now + REMEMBER_DEVICE_MS);
  } else if (!session.deviceTokenHash) {
    session.deviceExpiresAt = sessionExpiresAt;
  }

  await session.save();

  setCookie(res, SESSION_COOKIE, sessionToken, SESSION_IDLE_MS / 1000);

  return sessionExpiresAt;
}

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const body = req.body || {};
    const now = Date.now();
    const ip = req.ip || "unknown";

    const attempts = loginAttempts.get(ip);

    if (attempts && attempts.resetAt <= now) {
      loginAttempts.delete(ip);
    }

    const currentAttempts = loginAttempts.get(ip);

    if (currentAttempts && currentAttempts.count >= 10) {
      return res.status(429).json({
        message:
          "Too many sign-in attempts. Please wait 15 minutes and try again.",
      });
    }

    if (
      typeof body.password !== "string" ||
      !process.env.AUTH_PASSWORD ||
      !passwordMatches(body.password)
    ) {
      const attempt = loginAttempts.get(ip) || {
        count: 0,
        resetAt: now + 15 * 60 * 1000,
      };

      attempt.count += 1;
      loginAttempts.set(ip, attempt);

      return res.status(401).json({
        message: "Incorrect password.",
      });
    }

    loginAttempts.delete(ip);

    const currentTime = new Date();
    const rememberDevice = body.rememberDevice === true;

    const deviceToken = rememberDevice
      ? randomBytes(32).toString("base64url")
      : null;

    const session = await AuthSession.create({
      sessionExpiresAt: currentTime,
      deviceExpiresAt: rememberDevice
        ? new Date(currentTime.getTime() + REMEMBER_DEVICE_MS)
        : new Date(currentTime.getTime() + SESSION_IDLE_MS),
    });

    const expiresAt = await createAuthSession(
      res,
      session,
      deviceToken
    );

    if (deviceToken) {
      setCookie(
        res,
        DEVICE_COOKIE,
        deviceToken,
        REMEMBER_DEVICE_MS / 1000
      );
    } else {
      clearCookie(res, DEVICE_COOKIE);
    }

    res.json({ authenticated: true, expiresAt });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({ message: "Could not sign in." });
  }
});

// Check current session
app.get("/api/auth/session", async (req, res) => {
  try {
    const token = getCookie(req, SESSION_COOKIE);

    if (!token) {
      return res.status(401).json({
        message: "Sign-in required.",
      });
    }

    const session = await AuthSession.findOne({
      sessionTokenHash: hashToken(token),
      deviceExpiresAt: { $gt: new Date() },
    });

    if (!session || session.sessionExpiresAt <= new Date()) {
      clearCookie(res, SESSION_COOKIE);

      return res.status(401).json({
        message: "Session expired.",
      });
    }

    const expiresAt = await createAuthSession(res, session);

    res.json({ authenticated: true, expiresAt });
  } catch (error) {
    console.error("Check session:", error.message);

    res.status(500).json({
      message: "Could not check sign-in session.",
    });
  }
});

// Restore a remembered device
app.post("/api/auth/remembered-login", async (req, res) => {
  try {
    const token = getCookie(req, DEVICE_COOKIE);

    if (!token) {
      return res.status(401).json({
        message: "This device is not remembered.",
      });
    }

    const session = await AuthSession.findOne({
      deviceTokenHash: hashToken(token),
      deviceExpiresAt: { $gt: new Date() },
    });

    if (!session) {
      clearCookie(res, DEVICE_COOKIE);

      return res.status(401).json({
        message: "Remembered device expired.",
      });
    }

    const expiresAt = await createAuthSession(res, session);

    res.json({ authenticated: true, expiresAt });
  } catch (error) {
    console.error("Remembered-device sign-in:", error.message);

    res.status(500).json({
      message: "Could not restore this device session.",
    });
  }
});

// Logout
app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = getCookie(req, SESSION_COOKIE);
    const preserveRememberedDevice =
      req.body?.preserveRememberedDevice === true;

    if (token) {
      const session = await AuthSession.findOne({
        sessionTokenHash: hashToken(token),
      });

      if (
        preserveRememberedDevice &&
        session?.deviceTokenHash &&
        session.deviceExpiresAt > new Date()
      ) {
        session.sessionTokenHash = null;
        session.sessionExpiresAt = new Date(0);
        await session.save();
      } else if (session) {
        await session.deleteOne();
      }
    }

    clearCookie(res, SESSION_COOKIE);
    if (!preserveRememberedDevice) {
      clearCookie(res, DEVICE_COOKIE);
    }

    res.json({
      message: preserveRememberedDevice
        ? "Workspace locked."
        : "Signed out and removed this device's remembered access.",
    });
  } catch (error) {
    console.error("Logout failed:", error.message);

    res.status(500).json({
      message: "Could not sign out.",
    });
  }
});

// Protect all other /api routes
app.use("/api", async (req, res, next) => {
  try {
    const token = getCookie(req, SESSION_COOKIE);

    if (!token) {
      return res.status(401).json({
        message: "Sign-in required.",
      });
    }

    const session = await AuthSession.findOne({
      sessionTokenHash: hashToken(token),
      deviceExpiresAt: { $gt: new Date() },
    });

    if (!session || session.sessionExpiresAt <= new Date()) {
      clearCookie(res, SESSION_COOKIE);

      return res.status(401).json({
        message: "Session expired.",
      });
    }

    session.sessionExpiresAt = new Date(
      Date.now() + SESSION_IDLE_MS
    );

    if (!session.deviceTokenHash) {
      session.deviceExpiresAt = session.sessionExpiresAt;
    }

    await session.save();

    setCookie(res, SESSION_COOKIE, token, SESSION_IDLE_MS / 1000);

    next();
  } catch (error) {
    console.error("Authenticate API request:", error.message);

    res.status(500).json({
      message: "Could not verify sign-in session.",
    });
  }
});

function personRecordFilter(personId) {
  const filter = { ownerId: OWNER_ID };

  if (personId === DEFAULT_PERSON_ID) {
    return {
      ...filter,
      $or: [
        { personId: DEFAULT_PERSON_ID },
        { personId: { $exists: false } },
      ],
    };
  }

  return { ...filter, personId };
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);

  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

// People
app.get("/api/people", async (req, res) => {
  try {
    await Person.updateOne(
      { _id: DEFAULT_PERSON_ID, ownerId: OWNER_ID },
      { $setOnInsert: { name: "My Documents" } },
      { upsert: true }
    );

    const people = await Person.find({
      ownerId: OWNER_ID,
    }).sort({ createdAt: 1 });

    res.json(people);
  } catch (error) {
    console.error("Load people:", error.message);

    res.status(500).json({
      message: "Could not load people.",
    });
  }
});

app.post("/api/people", async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name?.trim();

    if (!name) {
      return res.status(400).json({
        message: "Person name is required.",
      });
    }

    const person = await Person.create({
      _id: body.id || randomUUID(),
      name,
      ownerId: OWNER_ID,
    });

    res.status(201).json(person);
  } catch (error) {
    console.error("Create person:", error.message);

    res.status(500).json({
      message: "Could not save person.",
    });
  }
});

app.delete("/api/people/:id", async (req, res) => {
  try {
    if (req.params.id === DEFAULT_PERSON_ID) {
      return res.status(400).json({
        message: "The default person cannot be deleted.",
      });
    }

    const person = await Person.findOne({
      _id: req.params.id,
      ownerId: OWNER_ID,
    });

    if (!person) {
      return res.status(404).json({
        message: "Person not found.",
      });
    }

    const documentFilter = {
      ownerId: OWNER_ID,
      personId: person._id,
    };

    const documents = await Document.find(documentFilter);
    const applications = await Application.find(documentFilter);

    for (const file of [...documents, ...applications]) {
      if (file.cloudinaryPublicId) {
        await cloudinary.uploader.destroy(file.cloudinaryPublicId, {
          resource_type: file.resourceType || "raw",
        });
      }
    }

    await Promise.all([
      Document.deleteMany(documentFilter),
      Application.deleteMany(documentFilter),
      Folder.deleteMany({
        personId: person._id,
        ownerId: OWNER_ID,
      }),
      CalendarEvent.deleteMany({
        personId: person._id,
        ownerId: OWNER_ID,
      }),
      person.deleteOne(),
    ]);

    res.json({
      message: "Person and their records deleted successfully.",
    });
  } catch (error) {
    console.error("Delete person:", error.message);

    res.status(500).json({
      message: "Could not delete person.",
    });
  }
});

// Folders
app.get("/api/folders", async (req, res) => {
  try {
    const personId = req.query.personId || DEFAULT_PERSON_ID;

    const folders = await Folder.find({
      ownerId: OWNER_ID,
      personId,
    }).sort({ createdAt: 1 });

    res.json(folders);
  } catch (error) {
    console.error("Load folders:", error.message);

    res.status(500).json({
      message: "Could not load folders.",
    });
  }
});

app.post("/api/folders", async (req, res) => {
  try {
    const body = req.body || {};
    const name = body.name?.trim();
    const personId = body.personId || DEFAULT_PERSON_ID;
    const parentId = body.parentId || null;

    if (!name) {
      return res.status(400).json({
        message: "Folder name is required.",
      });
    }

    const person = await Person.findOne({
      _id: personId,
      ownerId: OWNER_ID,
    });

    if (!person) {
      return res.status(404).json({
        message: "Person not found.",
      });
    }

    if (
      parentId &&
      !(await Folder.exists({
        _id: parentId,
        personId,
        ownerId: OWNER_ID,
      }))
    ) {
      return res.status(400).json({
        message: "Parent folder not found.",
      });
    }

    const folder = await Folder.create({
      _id: body.id || randomUUID(),
      name,
      personId,
      ownerId: OWNER_ID,
      parentId,
    });

    res.status(201).json(folder);
  } catch (error) {
    console.error("Create folder:", error.message);

    res.status(500).json({
      message: "Could not save folder.",
    });
  }
});

app.put("/api/folders/:id", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string"
      ? req.body.name.trim()
      : "";

    if (!name || name.length > 100) {
      return res.status(400).json({
        message: "Folder name must be between 1 and 100 characters.",
      });
    }

    const folder = await Folder.findOneAndUpdate(
      { _id: req.params.id, ownerId: OWNER_ID },
      { $set: { name } },
      { new: true, runValidators: true }
    );

    if (!folder) {
      return res.status(404).json({
        message: "Folder not found.",
      });
    }

    res.json(folder);
  } catch (error) {
    console.error("Rename folder:", error.message);

    res.status(500).json({
      message: "Could not rename folder.",
    });
  }
});

app.delete("/api/folders/:id", async (req, res) => {
  try {
    const folder = await Folder.findOne({
      _id: req.params.id,
      ownerId: OWNER_ID,
    });

    if (!folder) {
      return res.status(404).json({
        message: "Folder not found.",
      });
    }

    const folderIds = new Set([folder._id]);
    let changed = true;

    while (changed) {
      changed = false;

      const children = await Folder.find({
        ownerId: OWNER_ID,
        personId: folder.personId,
        parentId: { $in: [...folderIds] },
      }).select("_id");

      for (const child of children) {
        if (!folderIds.has(child._id)) {
          folderIds.add(child._id);
          changed = true;
        }
      }
    }

    const documents = await Document.find({
      ownerId: OWNER_ID,
      personId: folder.personId,
      folderId: { $in: [...folderIds] },
    });

    for (const document of documents) {
      if (document.cloudinaryPublicId) {
        await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
          resource_type: document.resourceType || "raw",
        });
      }
    }

    await Promise.all([
      Document.deleteMany({
        _id: { $in: documents.map((item) => item._id) },
      }),
      Folder.deleteMany({
        _id: { $in: [...folderIds] },
        ownerId: OWNER_ID,
      }),
    ]);

    res.json({
      message: "Folder and its contents deleted successfully.",
    });
  } catch (error) {
    console.error("Delete folder:", error.message);

    res.status(500).json({
      message: "Could not delete folder.",
    });
  }
});
function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: "auto",
        folder: "docspace",
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
}

// Upload a document
app.post("/api/documents", upload.single("file"), async (req, res) => {
  let uploadedFile;

  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Please select a file.",
      });
    }

    const documentDate = req.body.documentDate
      ? new Date(req.body.documentDate)
      : new Date();

    if (Number.isNaN(documentDate.getTime())) {
      return res.status(400).json({
        message: "Please provide a valid document date.",
      });
    }

    const ownerId = OWNER_ID;
    const personId = req.body.personId || DEFAULT_PERSON_ID;

    if (!(await Person.exists({ _id: personId, ownerId }))) {
      return res.status(404).json({
        message: "Person not found.",
      });
    }

    const folderId = req.body.folderId || null;

    if (
      folderId &&
      !(await Folder.exists({
        _id: folderId,
        personId,
        ownerId,
      }))
    ) {
      return res.status(400).json({
        message: "Folder not found for this person.",
      });
    }

    uploadedFile = await uploadToCloudinary(req.file);

    const document = await Document.create({
      name: req.body.name || req.file.originalname,
      cloudinaryPublicId: uploadedFile.public_id,
      fileUrl: uploadedFile.secure_url,
      resourceType: uploadedFile.resource_type,
      format: uploadedFile.format,
      size: uploadedFile.bytes,
      category: req.body.category || "document",
      ownerId,
      personId,
      folderId,
      documentDate,
    });

    res.status(201).json(document);
  } catch (error) {
    console.error("Upload failed:", error.message);

    if (uploadedFile) {
      try {
        await cloudinary.uploader.destroy(uploadedFile.public_id, {
          resource_type: uploadedFile.resource_type,
        });
      } catch (cleanupError) {
        console.error(
          "Uploaded file cleanup failed:",
          cleanupError.message
        );
      }
    }

    res.status(500).json({
      message: "Could not upload the document.",
    });
  }
});

// List documents
app.get("/api/documents", async (req, res) => {
  try {
    const personId = req.query.personId || DEFAULT_PERSON_ID;

    const documents = await Document.find(
      personRecordFilter(personId)
    ).sort({ createdAt: -1 });

    res.json(documents);
  } catch (error) {
    console.error("Load documents:", error.message);

    res.status(500).json({
      message: "Could not load documents.",
    });
  }
});

app.put("/api/documents/:id", async (req, res) => {
  try {
    const name = typeof req.body?.name === "string"
      ? req.body.name.trim()
      : "";

    if (!name || name.length > 255) {
      return res.status(400).json({
        message: "File name must be between 1 and 255 characters.",
      });
    }

    const document = await Document.findOneAndUpdate(
      { _id: req.params.id, ownerId: OWNER_ID },
      { $set: { name } },
      { new: true, runValidators: true }
    );

    if (!document) {
      return res.status(404).json({
        message: "Document not found.",
      });
    }

    res.json(document);
  } catch (error) {
    console.error("Rename document:", error.message);

    res.status(500).json({
      message: "Could not rename document.",
    });
  }
});

// Delete a document
app.delete("/api/documents/:id", async (req, res) => {
  try {
    const document = await Document.findOne({
      _id: req.params.id,
      ownerId: OWNER_ID,
    });

    if (!document) {
      return res.status(404).json({
        message: "Document not found.",
      });
    }

    if (document.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(document.cloudinaryPublicId, {
        resource_type: document.resourceType || "raw",
      });
    }

    await document.deleteOne();

    res.json({
      message: "Document deleted successfully.",
    });
  } catch (error) {
    console.error("Delete failed:", error.message);

    res.status(500).json({
      message: "Could not delete the document.",
    });
  }
});

// Calendar events
app.get("/api/calendar-events", async (req, res) => {
  try {
    const events = await CalendarEvent.find({
      ownerId: OWNER_ID,
    }).sort({
      date: 1,
      time: 1,
    });

    res.json(events);
  } catch (error) {
    console.error("Load calendar events:", error.message);

    res.status(500).json({
      message: "Could not load calendar events.",
    });
  }
});

app.post("/api/calendar-events", async (req, res) => {
  try {
    const body = req.body || {};
    const { title, date, time, endTime, type, notes } = body;
    const personId = body.personId || DEFAULT_PERSON_ID;

    if (
      !title?.trim() ||
      !isValidDate(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
    ) {
      return res.status(400).json({
        message:
          "Please provide a title, valid date, and valid start and end times.",
      });
    }

    if (endTime < time) {
      return res.status(400).json({
        message: "End time must be after the start time.",
      });
    }

    if (!(await Person.exists({ _id: personId, ownerId: OWNER_ID }))) {
      return res.status(404).json({
        message: "Person not found.",
      });
    }

    const event = await CalendarEvent.create({
      title: title.trim(),
      date,
      time,
      endTime,
      type,
      notes: notes || "",
      personId,
      ownerId: OWNER_ID,
    });

    res.status(201).json(event);
  } catch (error) {
    console.error("Create calendar event:", error.message);

    res.status(500).json({
      message: "Could not save calendar event.",
    });
  }
});

app.put("/api/calendar-events/:id", async (req, res) => {
  try {
    const body = req.body || {};
    const { title, date, time, endTime, type, notes } = body;
    const personId = body.personId || DEFAULT_PERSON_ID;

    if (
      !title?.trim() ||
      !isValidDate(date) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
    ) {
      return res.status(400).json({
        message:
          "Please provide a title, valid date, and valid start and end times.",
      });
    }

    if (endTime < time) {
      return res.status(400).json({
        message: "End time must be after the start time.",
      });
    }

    if (!(await Person.exists({ _id: personId, ownerId: OWNER_ID }))) {
      return res.status(404).json({
        message: "Person not found.",
      });
    }

    const event = await CalendarEvent.findOneAndUpdate(
      { _id: req.params.id, ownerId: OWNER_ID },
      {
        title: title.trim(),
        date,
        time,
        endTime,
        type,
        notes: notes || "",
        personId,
      },
      { new: true, runValidators: true }
    );

    if (!event) {
      return res.status(404).json({
        message: "Calendar event not found.",
      });
    }

    res.json(event);
  } catch (error) {
    console.error("Update calendar event:", error.message);

    res.status(500).json({
      message: "Could not update calendar event.",
    });
  }
});

app.delete("/api/calendar-events/:id", async (req, res) => {
  try {
    const event = await CalendarEvent.findOneAndDelete({
      _id: req.params.id,
      ownerId: OWNER_ID,
    });

    if (!event) {
      return res.status(404).json({
        message: "Calendar event not found.",
      });
    }

    res.json({
      message: "Calendar event deleted successfully.",
    });
  } catch (error) {
    console.error("Delete calendar event:", error.message);

    res.status(500).json({
      message: "Could not delete calendar event.",
    });
  }
});const PORT = Number(process.env.PORT) || 5000;

function connectToDatabase() {
  if (!process.env.MONGODB_URI) {
    console.error(
      "MONGODB_URI is missing; database connection will be retried."
    );
  }

  async function connect() {
    while (mongoose.connection.readyState !== 1) {
      try {
        if (!process.env.MONGODB_URI) {
          throw new Error("MONGODB_URI is not configured.");
        }

        await mongoose.connect(process.env.MONGODB_URI, {
          serverSelectionTimeoutMS: 10000,
        });

        console.log("Connected to MongoDB");
      } catch (error) {
        console.error(
          "MongoDB connection failed; retrying in 5 seconds:",
          error.message
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  void connect();
}

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`DocSpace API listening on port ${PORT}`);

  if (!process.env.AUTH_PASSWORD) {
    console.error(
      "AUTH_PASSWORD is missing; configure it in the Render environment."
    );
  }

  connectToDatabase();
});

function shutdown() {
  server.close(() => {
    mongoose.disconnect().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const applicationUpload = upload;

// Get all saved applications
app.get("/api/applications", async (req, res) => {
  try {
    const personId = req.query.personId;

    const filter = personId
      ? personRecordFilter(personId)
      : { ownerId: OWNER_ID };

    const applications = await Application.find(filter).sort({
      createdAt: -1,
    });

    res.json(applications);
  } catch (error) {
    console.error("Load applications:", error.message);

    res.status(500).json({
      message: "Could not load applications.",
    });
  }
});

// Create an application, with an optional file
app.post(
  "/api/applications",
  applicationUpload.single("file"),
  async (req, res) => {
    let uploadedFile;

    try {
      const body = req.body || {};

      const {
        name,
        category,
        examDate,
        deadline,
        resultDate,
        notes,
      } = body;

      const personId = body.personId || DEFAULT_PERSON_ID;

      if (!name?.trim()) {
        return res.status(400).json({
          message: "Application name is required.",
        });
      }

      if (!(await Person.exists({ _id: personId, ownerId: OWNER_ID }))) {
        return res.status(404).json({
          message: "Person not found.",
        });
      }

      if (req.file) {
        uploadedFile = await uploadToCloudinary(req.file);
      }

      const application = await Application.create({
        name: name.trim(),
        category: category || "Application",
        examDate: examDate || "",
        deadline: deadline || "",
        resultDate: resultDate || "",
        notes: notes || "",
        ownerId: OWNER_ID,
        personId,
        cloudinaryPublicId: uploadedFile?.public_id || "",
        fileUrl: uploadedFile?.secure_url || "",
        resourceType: uploadedFile?.resource_type || "",
        fileName: req.file?.originalname || "",
        format: uploadedFile?.format || "",
        size: uploadedFile?.bytes || 0,
      });

      res.status(201).json(application);
    } catch (error) {
      console.error("Create application:", error.message);

      if (uploadedFile) {
        await cloudinary.uploader.destroy(uploadedFile.public_id, {
          resource_type: uploadedFile.resource_type,
        }).catch(() => {});
      }

      res.status(500).json({
        message: "Could not save application.",
      });
    }
  }
);

// Edit application details; optionally replace its file
app.put(
  "/api/applications/:id",
  applicationUpload.single("file"),
  async (req, res) => {
    let newUpload;

    try {
      const application = await Application.findOne({
        _id: req.params.id,
        ownerId: OWNER_ID,
      });

      if (!application) {
        return res.status(404).json({
          message: "Application not found.",
        });
      }

      const body = req.body || {};
      const {
        name,
        category,
        examDate,
        deadline,
        resultDate,
        notes,
      } = body;

      if (name !== undefined) application.name = name.trim();
      if (category !== undefined) application.category = category;

      if (body.personId !== undefined) {
        if (!(await Person.exists({
          _id: body.personId,
          ownerId: OWNER_ID,
        }))) {
          return res.status(404).json({
            message: "Person not found.",
          });
        }

        application.personId = body.personId;
      }

      if (examDate !== undefined) application.examDate = examDate;
      if (deadline !== undefined) application.deadline = deadline;
      if (resultDate !== undefined) application.resultDate = resultDate;
      if (notes !== undefined) application.notes = notes;

      if (req.file) {
        newUpload = await uploadToCloudinary(req.file);

        const oldPublicId = application.cloudinaryPublicId;
        const oldResourceType = application.resourceType;

        application.cloudinaryPublicId = newUpload.public_id;
        application.fileUrl = newUpload.secure_url;
        application.resourceType = newUpload.resource_type;
        application.fileName = req.file.originalname;
        application.format = newUpload.format || "";
        application.size = newUpload.bytes || 0;

        await application.save();

        if (oldPublicId) {
          await cloudinary.uploader.destroy(oldPublicId, {
            resource_type: oldResourceType || "raw",
          }).catch((error) => {
            console.error("Old file cleanup failed:", error.message);
          });
        }

        return res.json(application);
      }

      await application.save();

      res.json(application);
    } catch (error) {
      console.error("Update application:", error.message);

      if (newUpload) {
        await cloudinary.uploader.destroy(newUpload.public_id, {
          resource_type: newUpload.resource_type,
        }).catch(() => {});
      }

      res.status(500).json({
        message: "Could not update application.",
      });
    }
  }
);

// Delete application and its Cloudinary attachment
app.delete("/api/applications/:id", async (req, res) => {
  try {
    const application = await Application.findOne({
      _id: req.params.id,
      ownerId: OWNER_ID,
    });

    if (!application) {
      return res.status(404).json({
        message: "Application not found.",
      });
    }

    if (application.cloudinaryPublicId) {
      await cloudinary.uploader.destroy(application.cloudinaryPublicId, {
        resource_type: application.resourceType || "raw",
      });
    }

    await application.deleteOne();

    res.json({
      message: "Application deleted successfully.",
    });
  } catch (error) {
    console.error("Delete application:", error.message);

    res.status(500).json({
      message: "Could not delete application.",
    });
  }
});