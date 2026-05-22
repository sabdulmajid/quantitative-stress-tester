"use client";

import { useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import type { AppUser } from "@/lib/types";

function formatModeLabel(mode: "sign-in" | "sign-up") {
  return mode === "sign-in" ? "Sign in" : "Create account";
}

export default function AuthPanel({
  enabled,
  user,
  loading,
  onAuthChange
}: {
  enabled: boolean;
  user: AppUser | null;
  loading: boolean;
  onAuthChange: () => Promise<void>;
}) {
  const supabase = useMemo(() => (enabled ? createBrowserSupabaseClient() : null), [enabled]);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) throw signInError;
        setMessage("Signed in.");
      } else {
        const redirectTo = `${window.location.origin}/auth/callback?next=/`;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: redirectTo
          }
        });
        if (signUpError) throw signUpError;
        setMessage(
          data.session
            ? "Account created."
            : "Check your email for the confirmation link before signing in."
        );
      }

      await onAuthChange();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setMessage("Signed out.");
      await onAuthChange();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out");
    } finally {
      setSubmitting(false);
    }
  }

  if (!enabled) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50/90 p-6">
        <p className="text-xs font-semibold uppercase text-amber-700/80">Persistence</p>
        <h2 className="mt-2 text-2xl font-semibold text-amber-950">Guest mode</h2>
        <p className="mt-2 text-sm leading-6 text-amber-900/80">
          Supabase is not configured in this environment yet, so authentication, saved portfolios, and run history are
          disabled. The stress engine still works.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-white/60 bg-white p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-teal-800/70">Account</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">
            {user ? "Signed in" : "Sign in to save your work"}
          </h2>
        </div>
        {loading ? (
          <span className="rounded-md bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">Loading</span>
        ) : null}
      </div>

      {user ? (
        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5">
          <div className="text-sm text-slate-500">Current user</div>
          <div className="mt-1 text-lg font-semibold text-slate-950">{user.email ?? user.id}</div>
          <button
            type="button"
            className="mt-4 rounded-md bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={handleSignOut}
            disabled={submitting}
          >
            {submitting ? "Signing out..." : "Sign out"}
          </button>
        </div>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-1">
            {(["sign-in", "sign-up"] as const).map((nextMode) => (
              <button
                key={nextMode}
                type="button"
                onClick={() => {
                  setMode(nextMode);
                  setError(null);
                  setMessage(null);
                }}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  mode === nextMode ? "bg-slate-950 text-white" : "text-slate-600 hover:text-slate-950"
                }`}
              >
                {formatModeLabel(nextMode)}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Email</span>
            <input
              className="field"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700">Password</span>
            <input
              className="field"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
            />
          </label>

          <button
            type="submit"
            className="rounded-md bg-teal-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={submitting}
          >
            {submitting ? "Working..." : formatModeLabel(mode)}
          </button>
        </form>
      )}

      {message ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>
      ) : null}
    </section>
  );
}
