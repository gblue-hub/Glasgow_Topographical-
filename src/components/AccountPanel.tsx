import { useEffect, useState } from "react";
import { signOut } from "../services/supabase";
import {
  subscribeToSaveState,
  type SaveState,
} from "../services/db";

type Props = {
  account: {
    email: string;
    name: string;
    avatarUrl: string | null;
  };
};

const initialState: SaveState = {
  status: "loading",
  message: "Loading your progress…",
  savedAt: null,
};

export function AccountPanel({ account }: Props) {
  const [saveState, setSaveState] = useState(initialState);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => subscribeToSaveState(setSaveState), []);

  return (
    <section className="account-panel" aria-label="Learning account">
      <div className="account-identity">
        {account.avatarUrl ? (
          <img src={account.avatarUrl} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span aria-hidden="true">{account.name.slice(0, 1).toUpperCase()}</span>
        )}
        <div>
          <strong>{account.name}</strong>
          <small>{account.email}</small>
        </div>
      </div>
      <div className={`save-state save-state--${saveState.status}`} role="status">
        <i aria-hidden="true" />
        <span>{saveState.message}</span>
      </div>
      <button
        type="button"
        className="account-sign-out"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true);
          void signOut().catch(() => setSigningOut(false));
        }}
      >
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </section>
  );
}
