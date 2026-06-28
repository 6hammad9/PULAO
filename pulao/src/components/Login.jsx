import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "../styles/login.css";

function Login() {
  const location = useLocation();
  const [mode, setMode] = useState(location.pathname === "/register" ? "register" : "login");
  const navigate = useNavigate();

  useEffect(() => {
    setMode(location.pathname === "/register" ? "register" : "login");
  }, [location.pathname]);

  const submitAuth = (event) => {
    event.preventDefault();
    navigate("/events");
  };

  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="auth-brand-panel">
          <img className="auth-wordmark" src="/files/pulao-wordmark-white.svg" alt="PULAO" />
          <div className="auth-positioning">
            <p className="overline">Access operations platform</p>
            <h1>Run every event as its own secure workspace.</h1>
            <p>
              Build event-specific people lists, checkpoints, camera streams, alerts, and evidence without mixing one operation into another.
            </p>
          </div>

          <div className="auth-signal-grid" aria-label="Platform signals">
            <div>
              <span>01</span>
              <strong>Events</strong>
              <small>Separate workspaces</small>
            </div>
            <div>
              <span>02</span>
              <strong>People</strong>
              <small>Whitelist, VIP, blocked</small>
            </div>
            <div>
              <span>03</span>
              <strong>Live</strong>
              <small>Camera decisions</small>
            </div>
          </div>

        </div>

        <div className="auth-form-panel">
          <div className="auth-mobile-brand">
            <img src="/files/pulao-wordmark-black.svg" alt="PULAO" />
            <span>Access operations platform</span>
          </div>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
              Login
            </button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={submitAuth}>
            <div>
              <p className="overline">{mode === "login" ? "Operator access" : "Create workspace account"}</p>
              <h2>{mode === "login" ? "Welcome back" : "Start with PULAO"}</h2>
              <p className="auth-copy">
                {mode === "login"
                  ? "Sign in to open your event command center."
                  : "Set up your operator account. We will connect the real authentication later."}
              </p>
            </div>

            {mode === "register" && (
              <label>
                Full name
                <input type="text" name="name" placeholder="Hammad Khan" autoComplete="name" />
              </label>
            )}

            <label>
              Email
              <input type="email" name="email" placeholder="operator@company.com" autoComplete="email" />
            </label>

            {mode === "register" && (
              <label>
                Organization
                <input type="text" name="organization" placeholder="Event security team" autoComplete="organization" />
              </label>
            )}

            <label>
              Password
              <input
                type="password"
                name="password"
                placeholder={mode === "login" ? "Enter password" : "Create password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            <button className="auth-submit" type="submit">
              {mode === "login" ? "Continue to Events" : "Create Account"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default Login;
