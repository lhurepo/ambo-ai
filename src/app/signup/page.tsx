"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export default function SignUpPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [ministryName, setMinistryName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, ministryName, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sign up failed");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleQuickStart = async () => {
    setError(null);
    setGuestLoading(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "guest" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quick start failed");
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuestLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-white px-6 py-8">
      <div />

      <main className="mx-auto w-full max-w-[360px]">
        <div className="mb-8 flex justify-center">
          <img
            src="/brand/logo-stacked-primary.svg"
            alt="Ambo AI"
            className="h-16 w-auto"
          />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="signup-name" className="mb-1.5 block text-sm font-medium text-[#0D1F28]">
              Full name
            </label>
            <input
              id="signup-name"
              type="text"
              required
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Pastor Jordan"
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] transition focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="signup-ministry" className="mb-1.5 block text-sm font-medium text-[#0D1F28]">
              Church or ministry
            </label>
            <input
              id="signup-ministry"
              type="text"
              value={ministryName}
              onChange={(e) => setMinistryName(e.target.value)}
              placeholder="Grace Fellowship"
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] transition focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-[#0D1F28]">
              Email
            </label>
            <input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@church.org"
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] transition focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-[#0D1F28]">
              Password
            </label>
            <input
              id="signup-password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] transition focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
              {error}
            </p>
          )}

          <div className="space-y-2.5 pt-2">
            <button
              type="submit"
              disabled={loading || guestLoading}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#002A3C] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Sign up
            </button>

            <button
              type="button"
              onClick={handleQuickStart}
              disabled={loading || guestLoading}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-[#E5EAEF] bg-[#F3F5F7] px-4 py-2.5 text-sm font-medium text-[#0D1F28] transition hover:bg-[#EBF4F7] disabled:opacity-60"
            >
              {guestLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Quick start
            </button>
          </div>
        </form>

        <p className="mt-6 text-center text-sm text-[#4E6470]">
          Already have an account?{" "}
          <Link href="/signin" className="font-medium text-[#002A3C] hover:underline">
            Log in
          </Link>
        </p>
      </main>

      <footer className="text-center text-xs text-[#70848F]">
        Ambo AI
      </footer>
    </div>
  );
}
