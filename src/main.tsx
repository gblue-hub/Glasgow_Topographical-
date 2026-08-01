import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import "./index.css";
import App from "./App.tsx";
import { AuthGate } from "./components/AuthGate";
import { initialiseProgressStore } from "./services/db";
import { getCurrentSession } from "./services/supabase";

type StartupState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "ready"; session: Session | null }
  | { status: "error"; message: string };

export function Root() {
  const [state, setState] = useState<StartupState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (import.meta.env.DEV) {
      void initialiseProgressStore()
        .then(() => {
          if (!cancelled) setState({ status: "ready", session: null });
        })
        .catch((cause) => {
          if (!cancelled)
            setState({
              status: "error",
              message: cause instanceof Error ? cause.message : String(cause),
            });
        });
      return () => {
        cancelled = true;
      };
    }
    void getCurrentSession()
      .then(async (session) => {
        if (!session) {
          if (!cancelled) setState({ status: "signed_out" });
          return;
        }
        await initialiseProgressStore();
        if (!cancelled) setState({ status: "ready", session });
      })
      .catch((cause) => {
        if (!cancelled)
          setState({
            status: "error",
            message: cause instanceof Error ? cause.message : String(cause),
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading")
    return <main className="loading">Opening your learning account…</main>;
  if (state.status === "signed_out") return <AuthGate />;
  if (state.status === "error")
    return (
      <main className="fatal">
        <h1>Your progress could not be opened</h1>
        <p>{state.message}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </main>
    );

  const user = state.session?.user;
  return (
    <App
      account={{
        email: user?.email ?? "local@development",
        name:
          user?.user_metadata.full_name ??
          user?.user_metadata.name ??
          user?.email?.split("@")[0] ??
          "Local learner",
        avatarUrl: user?.user_metadata.avatar_url ?? null,
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
