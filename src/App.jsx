
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Routes,
  Route,
  BrowserRouter,
  NavLink,
  Navigate,
} from "react-router-dom";

import "./app.css";
import Password from "./Pages/Password";
import Application from "./Pages/Application";
import Doc from "./Pages/DocPage";
import Calendar from "./Pages/Calendar";
import {
  getCurrentSession,
  logout,
  refreshSession,
  restoreRememberedSession,
} from "./services/cloudFiles";

const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const IDLE_WARNING_MS = IDLE_TIMEOUT_MS - 2 * 60 * 1000;
const SESSION_REFRESH_INTERVAL_MS = 60 * 1000;

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [idleWarning, setIdleWarning] = useState(false);
  const [secondsUntilLock, setSecondsUntilLock] = useState(120);
  const lastActivityRef = useRef(0);
  const lastRefreshRef = useRef(0);
  const restorePromiseRef = useRef(null);
  const lockingRef = useRef(false);

  useEffect(() => {
    let active = true;
    if (!restorePromiseRef.current) {
      restorePromiseRef.current = (async () => {
        try {
          await getCurrentSession();
          return true;
        } catch {
          try {
            await restoreRememberedSession();
            return true;
          } catch {
            return false;
          }
        }
      })();
    }

    restorePromiseRef.current.then((authenticated) => {
      if (!active) return;
      if (authenticated) {
        lastActivityRef.current = Date.now();
        lastRefreshRef.current = Date.now();
      }
      setIsLoggedIn(authenticated);
      setAuthLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const lockWorkspace = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    try {
      await logout({ preserveRememberedDevice: true });
    } catch (error) {
      console.error("Could not clear the server session:", error.message);
    } finally {
      setIdleWarning(false);
      setIsLoggedIn(false);
      lockingRef.current = false;
    }
  }, []);

  const continueSession = useCallback(async () => {
    try {
      await refreshSession();
      lastActivityRef.current = Date.now();
      lastRefreshRef.current = Date.now();
      setIdleWarning(false);
    } catch {
      await lockWorkspace();
    }
  }, [lockWorkspace]);

  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const recordActivity = () => {
      if (idleWarning) return;
      const now = Date.now();
      lastActivityRef.current = now;

      if (now - lastRefreshRef.current >= SESSION_REFRESH_INTERVAL_MS) {
        lastRefreshRef.current = now;
        refreshSession().catch(() => lockWorkspace());
      }
    };

    const checkIdle = () => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor >= IDLE_TIMEOUT_MS) {
        void lockWorkspace();
        return;
      }

      if (idleFor >= IDLE_WARNING_MS) {
        setSecondsUntilLock(
          Math.ceil((IDLE_TIMEOUT_MS - idleFor) / 1000)
        );
        setIdleWarning(true);
      }
    };

    const activityEvents = ["pointerdown", "keydown", "touchstart", "mousemove"];
    activityEvents.forEach((name) =>
      window.addEventListener(name, recordActivity, { passive: true })
    );
    const timer = window.setInterval(checkIdle, 1000);

    return () => {
      activityEvents.forEach((name) =>
        window.removeEventListener(name, recordActivity)
      );
      window.clearInterval(timer);
    };
  }, [idleWarning, isLoggedIn, lockWorkspace]);

  return (
    <BrowserRouter>
      {authLoading ? (
        <main className="auth-loading" aria-live="polite">
          Restoring your workspace…
        </main>
      ) : !isLoggedIn ? (
        <Password
          onLogin={() => {
            lastActivityRef.current = Date.now();
            lastRefreshRef.current = Date.now();
            setIsLoggedIn(true);
          }}
        />
      ) : (
        <div className="app-layout">
          <header className="top-navbar">
            <div className="brand">
              <div className="brand-icon">D</div>
              <span>DocSpace</span>
            </div>

            <nav className="top-nav-links">
              <NavLink
                to="/doc"
                end
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
              >
                <span className="nav-icon" aria-hidden="true">▤</span>
                <span>Documents</span>
              </NavLink>

              <NavLink
                to="/application"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
              >
                <span className="nav-icon" aria-hidden="true">▣</span>
                <span>Applications</span>
              </NavLink>

              <NavLink
                to="/calendar"
                className={({ isActive }) =>
                  `nav-link ${isActive ? "active" : ""}`
                }
              >
                <span className="nav-icon" aria-hidden="true">▦</span>
                <span>Calendar</span>
              </NavLink>
            </nav>

            <div className="navbar-status">
              <span className="status-dot"></span>
              Workspace

              <button
                type="button"
                onClick={() => void lockWorkspace()}
                className="logout-button"
              >
                Lock now
              </button>
            </div>
          </header>

          <main className="page-content">
            <Routes>
              <Route
                path="/"
                element={<Navigate to="/doc" replace />}
              />
              <Route path="/doc" element={<Doc />} />
              <Route path="/application" element={<Application />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route
                path="*"
                element={<Navigate to="/doc" replace />}
              />
            </Routes>
          </main>
          {idleWarning && (
            <div className="session-warning-backdrop">
              <section
                className="session-warning"
                role="dialog"
                aria-modal="true"
                aria-labelledby="session-warning-title"
              >
                <h2 id="session-warning-title">Still using DocSpace?</h2>
                <p>
                  Your workspace will lock in{" "}
                  <strong>
                    {Math.floor(secondsUntilLock / 60)}:
                    {String(secondsUntilLock % 60).padStart(2, "0")}
                  </strong>{" "}
                  because of inactivity.
                </p>
                <div className="session-warning-actions">
                  <button
                    className="secondary-button"
                    onClick={() => void lockWorkspace()}
                  >
                    Lock workspace
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void continueSession()}
                  >
                    Continue working
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      )}
    </BrowserRouter>
  );
}

export default App;
