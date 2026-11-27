"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Trash2 } from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";

export default function AccountPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [ministryName, setMinistryName] = useState("");
  const [ministryWebsite, setMinistryWebsite] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/account")
      .then((r) => {
        if (r.status === 401) {
          router.push("/signin");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d?.user) {
          setFullName(d.user.fullName || "");
          setMinistryName(d.user.ministryName || "");
          setMinistryWebsite(d.user.ministryWebsite || "");
          setEmail(d.user.email || "");
        }
      })
      .finally(() => setLoading(false));
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          ministryName,
          ministryWebsite,
          email,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setNewPassword("");
      success("Account details saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save account details.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeleteAccount = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      success("Account and local data deleted.");
      setConfirmDeleteOpen(false);
      router.push("/signin");
      router.refresh();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not delete account.");
      setDeleting(false);
    }
  };

  return (
    <AuthenticatedShell userEmail={email} ministryName={ministryName}>
      <div className="mx-auto max-w-2xl px-5 py-7 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[#0D1F28]">Account</h1>

        {loading ? (
          <div className="mt-10 flex justify-center py-12 text-[#4E6470]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <form
              onSubmit={handleSave}
              className="rounded-2xl border border-[#E5EAEF] bg-white divide-y divide-[#EDF1F4]"
            >
              <div className="p-6">
                <h2 className="text-base font-semibold text-[#0D1F28]">Personal information</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="account-name" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                      Full name
                    </label>
                    <input
                      id="account-name"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="account-email" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                      Email
                    </label>
                    <input
                      id="account-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6">
                <h2 className="text-base font-semibold text-[#0D1F28]">Ministry</h2>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="account-ministry"
                      className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                    >
                      Church or ministry name
                    </label>
                    <input
                      id="account-ministry"
                      type="text"
                      value={ministryName}
                      onChange={(e) => setMinistryName(e.target.value)}
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="account-website"
                      className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                    >
                      Website
                    </label>
                    <input
                      id="account-website"
                      type="text"
                      value={ministryWebsite}
                      onChange={(e) => setMinistryWebsite(e.target.value)}
                      placeholder="https://thegardenchurch.com"
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="p-6">
                <h2 className="text-base font-semibold text-[#0D1F28]">Password</h2>
                <div className="mt-4">
                  <label
                    htmlFor="account-password"
                    className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                  >
                    New password
                  </label>
                  <input
                    id="account-password"
                    type="password"
                    minLength={6}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Leave blank to keep current password"
                    className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="mt-5 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-5 py-2.5 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    Save changes
                  </button>
                </div>
              </div>
            </form>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E5EAEF] bg-white p-6">
              <div>
                <h2 className="text-sm font-semibold text-[#0D1F28]">Delete account</h2>
                <p className="mt-0.5 text-xs text-[#4E6470]">
                  Permanently remove this account and all stored sermon files.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete account
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Delete account and all sermons?"
        description="This permanently removes your account, saved API settings, custom prompts, and every uploaded video/transcript on disk. This cannot be undone."
        confirmLabel="Delete everything"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </AuthenticatedShell>
  );
}
