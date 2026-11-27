"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      setTimeout(() => {
        dismiss(id);
      }, 4000);
    },
    [dismiss]
  );

  const value: ToastContextValue = {
    toast,
    success: useCallback((msg: string) => toast("success", msg), [toast]),
    error: useCallback((msg: string) => toast("error", msg), [toast]),
    info: useCallback((msg: string) => toast("info", msg), [toast]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-5 right-5 z-[100] flex max-w-sm flex-col gap-2"
      >
        {items.map((item) => {
          const isErr = item.kind === "error";
          const isOk = item.kind === "success";
          return (
            <div
              key={item.id}
              role="status"
              className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-white px-4 py-3 text-xs font-medium shadow-md transition ${
                isErr
                  ? "border-rose-200 text-rose-800"
                  : isOk
                    ? "border-[#D5E1E6] text-[#1D3519]"
                    : "border-[#E5EAEF] text-[#0D1F28]"
              }`}
            >
              {isErr ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              ) : isOk ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#1D3519]" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#002A3C]" aria-hidden="true" />
              )}
              <span className="flex-1 leading-snug">{item.message}</span>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="rounded p-0.5 text-[#70848F] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return ctx;
}
