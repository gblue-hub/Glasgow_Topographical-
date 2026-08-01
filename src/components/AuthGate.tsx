import { useState } from "react";
import { cloudConfigurationReady, signInWithGoogle } from "../services/supabase";

export function AuthGate() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setBusy(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden="true">GK</span>
          <span>
            Glasgow Knowledge
            <small>THE CITY · AREA BY AREA</small>
          </span>
        </div>
        <div className="auth-copy">
          <p>YOUR PERSONAL LEARNING ROUTE</p>
          <h1 id="auth-title">Learn Glasgow. Keep your progress everywhere.</h1>
          <span>
            Sign in before starting. Your learning history, saved quizzes,
            mastery and mock results are stored securely with your account.
          </span>
        </div>
        {cloudConfigurationReady ? (
          <button
            className="google-sign-in"
            type="button"
            disabled={busy}
            onClick={() => void signIn()}
          >
            <span aria-hidden="true">G</span>
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>
        ) : (
          <div className="auth-configuration" role="status">
            <strong>Cloud sign-in needs configuring</strong>
            <span>
              Add the Supabase URL and publishable key to this deployment.
            </span>
          </div>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        <small className="auth-note">
          An internet connection is required. Progress is not stored in this
          browser.
        </small>
      </section>
    </main>
  );
}
