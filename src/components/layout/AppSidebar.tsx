"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  KeyRound,
  Layers,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  User,
  X,
} from "lucide-react";
import { UpdateAppModal } from "./UpdateAppModal";

interface AppSidebarProps {
  onNewSermon: () => void;
  userEmail?: string;
  ministryName?: string;
}

export function AppSidebar({ onNewSermon }: AppSidebarProps) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updatesAvailable, setUpdatesAvailable] = useState(0);

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

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Home },
    { href: "/prompt-library", label: "Prompt library", icon: Layers },
    { href: "/settings", label: "API keys", icon: KeyRound },
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
              className="h-7 w-auto"
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
            className="h-6 w-auto"
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
    </>
  );
}
