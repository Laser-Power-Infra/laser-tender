"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { signUp } from "@/actions/auth";

// Only same-site paths, so a crafted callbackUrl cannot send the user elsewhere.
function safeCallbackUrl(url?: string): string {
  return url && url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\") ? url : "/";
}

export function AuthForm({ mode, callbackUrl }: { mode: "signin" | "signup"; callbackUrl?: string }) {
  const isSignUp = mode === "signup";
  const target = safeCallbackUrl(callbackUrl);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") || "");
    const email = String(form.get("email") || "");
    const password = String(form.get("password") || "");
    setBusy(true);
    setError(null);
    try {
      if (isSignUp) {
        const created = await signUp({ name, email, password });
        if (!created.success) {
          setError(created.error || "Could not create the account.");
          return;
        }
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (!result || result.error) {
        setError(isSignUp ? "Account created, but sign in failed. Try signing in." : "Wrong email or password.");
        return;
      }
      // Full load so every page picks up the new session.
      window.location.assign(target);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const otherHref = `${isSignUp ? "/signin" : "/signup"}${target === "/" ? "" : `?callbackUrl=${encodeURIComponent(target)}`}`;

  return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8">
      <form
        onSubmit={handleSubmit}
        aria-labelledby="auth-title"
        className="flex w-full max-w-[380px] flex-col gap-4 rounded-lg border border-line bg-white p-6"
        style={{ boxShadow: "0 4px 12px rgba(10, 37, 64, 0.05)" }}
      >
        <div>
          <h1 id="auth-title" className="tender-header-title">
            {isSignUp ? "Create account" : "Sign in"}
          </h1>
          <p className="m-0 mt-1 text-[12px] text-[#5f6368]">
            {isSignUp
              ? "An account lets you edit and run actions in the dashboards."
              : "Anyone can view the dashboards. Sign in to make changes."}
          </p>
        </div>

        {isSignUp && (
          <div className="tender-detail-field">
            <label htmlFor="auth-name" className="tender-detail-label">Name</label>
            <input id="auth-name" name="name" type="text" required autoComplete="name" className="tender-detail-input" />
          </div>
        )}

        <div className="tender-detail-field">
          <label htmlFor="auth-email" className="tender-detail-label">Email</label>
          <input id="auth-email" name="email" type="email" required autoComplete="email" className="tender-detail-input" />
        </div>

        <div className="tender-detail-field">
          <label htmlFor="auth-password" className="tender-detail-label">Password</label>
          <input
            id="auth-password"
            name="password"
            type="password"
            required
            minLength={isSignUp ? 8 : undefined}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            aria-describedby={isSignUp ? "auth-password-hint" : undefined}
            className="tender-detail-input"
          />
          {isSignUp && (
            <span id="auth-password-hint" className="text-[11px] text-[#5f6368]">At least 8 characters.</span>
          )}
        </div>

        <div role="alert" className={error ? "smartsheet-error-code" : undefined}>
          {error}
        </div>

        <button type="submit" disabled={busy} className="tender-refresh-sidebar-btn">
          {busy ? "Please wait..." : isSignUp ? "Create account" : "Sign in"}
        </button>

        <p className="m-0 text-center text-[12px] text-[#5f6368]">
          {isSignUp ? "Already have an account? " : "No account yet? "}
          <Link href={otherHref} className="font-semibold text-brand hover:underline">
            {isSignUp ? "Sign in" : "Create one"}
          </Link>
        </p>
      </form>
    </main>
  );
}
