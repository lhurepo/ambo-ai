"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Layers,
  LogOut,
  Menu,
  Moon,
  Plus,
  Power,
  RefreshCw,
  Settings,
  Sun,
  User,
  X,
} from "lucide-react";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useTheme } from "@/components/ui/ThemeProvider";
import { UpdateAppModal } from "./UpdateAppModal";

interface AppSidebarProps {
  onNewSermon: () => void;
  userEmail?: string;
  ministryName?: string;
}

export function AppSidebar({ onNewSermon }: AppSidebarProps) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { toggleDark } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updatesAvailable, setUpdatesAvailable] = useState(0);
  const [shutdownModalOpen, setShutdownModalOpen] = useState(false);
  const [shuttingDown, setShuttingDown] = useState(false);
  const [isShutDown, setIsShutDown] = useState(false);

  useEffect(() => {
    fetch("/api/system/update")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && typeof d.behindCount === "number") {
          setUpdatesAvailable(d.behindCount);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "signout" }),
    });
    router.push("/signin");
    router.refresh();
  };

  const handleShutdown = async () => {
    setShuttingDown(true);
    try {
      await fetch("/api/system/shutdown", { method: "POST" });
    } catch {
      // Server may close the socket right as it exits
    } finally {
      setShuttingDown(false);
      setShutdownModalOpen(false);
      setIsShutDown(true);
    }
  };

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/prompt-library", label: "Prompt library", icon: Layers },
    { href: "/settings", label: "Settings", icon: Settings },
    { href: "/account", label: "Account", icon: User },
  ];

  const sidebarBody = (
    <div className="flex h-full flex-col justify-between bg-white px-4 py-5">
      <div>
        <div className="mb-6 flex items-center justify-between px-1">
          <Link href="/dashboard" className="inline-flex items-center">
            <img
              src="/brand/logo-horizontal-primary.svg"
              alt="Ambo AI"
              className="h-7 w-auto dark:hidden"
            />
            <img
              src="/brand/logo-horizontal-white.svg"
              alt="Ambo AI"
              className="hidden h-7 w-auto dark:block"
            />
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="rounded-lg p-1.5 text-[#4E6470] transition hover:bg-[#F3F5F7] hover:text-[#0D1F28] md:hidden"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            onNewSermon();
          }}
          className="mb-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#002A3C] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#0B435B]"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New sermon
        </button>

        <nav aria-label="Primary" className="space-y-1">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.href === "/dashboard" && pathname.startsWith("/sermon/"));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-[#EBF4F7] text-[#002A3C]"
                    : "text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    active ? "text-[#002A3C]" : "text-[#70848F]"
                  }`}
                  aria-hidden="true"
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-1 border-t border-[#EDF1F4] pt-3">
        <button
          type="button"
          onClick={toggleDark}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[#4E6470] transition hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
        >
          <Moon className="h-4 w-4 shrink-0 text-[#70848F] dark:hidden" aria-hidden="true" />
          <Sun className="hidden h-4 w-4 shrink-0 text-[#BDD630] dark:block" aria-hidden="true" />
          <span className="dark:hidden">Dark mode</span>
          <span className="hidden dark:inline">Light mode</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            setUpdateModalOpen(true);
          }}
          className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition ${
            updatesAvailable > 0
              ? "bg-[#F4F2E6] text-[#1D3519] hover:bg-[#EBE8D5]"
              : "text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
          }`}
        >
          <span className="flex items-center gap-3">
            <RefreshCw
              className={`h-4 w-4 shrink-0 ${
                updatesAvailable > 0 ? "text-[#1D3519]" : "text-[#70848F]"
              }`}
              aria-hidden="true"
            />
            Update app
          </span>
          {updatesAvailable > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#1D3519] px-2 py-0.5 text-[10px] font-semibold text-[#BDD630]">
              New
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileOpen(false);
            setShutdownModalOpen(true);
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[#4E6470] transition hover:bg-rose-50 hover:text-rose-700"
        >
          <Power className="h-4 w-4 shrink-0 text-[#70848F]" aria-hidden="true" />
          Shut down app
        </button>

        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-[#4E6470] transition hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
        >
          <LogOut className="h-4 w-4 shrink-0 text-[#70848F]" aria-hidden="true" />
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="flex items-center justify-between border-b border-[#E5EAEF] bg-white px-4 py-3 md:hidden">
        <Link href="/dashboard" className="inline-flex items-center">
          <img
            src="/brand/logo-horizontal-primary.svg"
            alt="Ambo AI"
            className="h-6 w-auto dark:hidden"
          />
          <img
            src="/brand/logo-horizontal-white.svg"
            alt="Ambo AI"
            className="hidden h-6 w-auto dark:block"
          />
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewSermon}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-3 py-1.5 text-xs font-medium text-white"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New sermon
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="rounded-lg border border-[#E5EAEF] bg-white p-1.5 text-[#0D1F28]"
          >
            <Menu className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <aside className="hidden w-[228px] shrink-0 border-r border-[#E5EAEF] bg-white md:block">
        {sidebarBody}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="w-[248px] border-r border-[#E5EAEF] bg-white">
            {sidebarBody}
          </div>
          <button
            type="button"
            aria-label="Close navigation menu backdrop"
            className="flex-1 bg-black/25"
            onClick={() => setMobileOpen(false)}
          />
        </div>
      )}

      <UpdateAppModal
        open={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        onStatusChecked={(count) => setUpdatesAvailable(count)}
      />

      <ConfirmModal
        open={shutdownModalOpen}
        title="Shut down Ambo AI?"
        description="This stops the local Ambo AI server on your Mac so it is no longer running in the background. Double-click Ambo AI on your Desktop anytime to start it again."
        confirmLabel="Shut down"
        variant="danger"
        loading={shuttingDown}
        onConfirm={handleShutdown}
        onCancel={() => setShutdownModalOpen(false)}
      />

      {isShutDown && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-[#F7F8FA] p-6"
          role="status"
          aria-live="polite"
        >
          <div className="w-full max-w-md rounded-2xl border border-[#E5EAEF] bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
              <Power className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold text-[#0D1F28]">Ambo AI has been shut down</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#4E6470]">
              The local server is no longer running in the background. You can safely close this
              browser tab, and double-click <strong>Ambo AI</strong> on your Desktop whenever you
              want to open it again.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
