"use client";

import React, { useEffect } from "react";
import { Loader2, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl border border-[#E5EAEF] bg-white p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="confirm-modal-title" className="text-base font-semibold text-[#0D1F28]">
            {title}
          </h2>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="rounded-lg p-1 text-[#70848F] hover:bg-[#F3F5F7] hover:text-[#0D1F28] disabled:opacity-50"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-[#4E6470]">{description}</p>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium text-white transition disabled:opacity-60 ${
              variant === "danger"
                ? "bg-rose-700 hover:bg-rose-800"
                : "bg-[#002A3C] hover:bg-[#0B435B]"
            }`}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
