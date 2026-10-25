
import { useState } from "react";
import "./Password.css";
import { login } from "../services/cloudFiles";

export default function Password({ onLogin }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [rememberDevice, setRememberDevice] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);

    try {
      await login(password, rememberDevice);
      setError("");
      onLogin();
    } catch (loginError) {
      setError(loginError.message || "Could not sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">D</div>

        <p className="login-eyebrow">WELCOME BACK</p>
        <h1>Unlock DocSpace</h1>
        <p className="login-description">
          Enter your workspace password to access your documents and applications.
        </p>

        <label htmlFor="password">Password</label>
        <div className="password-input-wrapper">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={submitting}
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        <label className="remember-device">
          <input
            type="checkbox"
            checked={rememberDevice}
            onChange={(event) => setRememberDevice(event.target.checked)}
            disabled={submitting}
          />
          <span>Remember this device for 30 days</span>
        </label>

        {error && <p className="login-error">{error}</p>}

        <button className="login-button" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Unlock Workspace"}
        </button>

        <p className="login-security">
          <span>🔒</span> Private workspace access
        </p>
      </form>
    </main>
  );
}
