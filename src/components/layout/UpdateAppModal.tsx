"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw, X } from "lucide-react";

interface UpdateStatusPayload {
  gitAvailable: boolean;
  currentCommit: string;
  remoteCommit: string;
  behindCount: number;
  upToDate: boolean;
  pendingChanges: string[];
  updateStatus?: {
    state: "updating" | "installing" | "building" | "completed" | "error";
    step: string;
    commit?: string;
    error?: string | null;
    updatedAt: number;
  } | null;
}

interface UpdateAppModalProps {
  open: boolean;
  onClose: () => void;
  onStatusChecked?: (behindCount: number) => void;
}

export function UpdateAppModal({ open, onClose, onStatusChecked }: UpdateAppModalProps) {
  const [checking, setChecking] = useState(true);
  const [info, setInfo] = useState<UpdateStatusPayload | null>(null);
  const [updating, setUpdating] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const checkUpdates = useCallback(
    async (fresh = true) => {
      setChecking(true);
      setErrorMsg(null);
      try {
        const res = await fetch(`/api/system/update${fresh ? "?fresh=1" : ""}`);
        const data = (await res.json()) as UpdateStatusPayload & { error?: string };
        if (!res.ok) throw new Error(data.error || "Could not check for updates.");
        setInfo(data);
        onStatusChecked?.(data.behindCount || 0);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "Could not check for updates.");
      } finally {
        setChecking(false);
      }
    },
    [onStatusChecked]
  );

  useEffect(() => {
    if (!open) return;
    setDoneMessage(null);
    setErrorMsg(null);
    void checkUpdates(true);
  }, [open, checkUpdates]);

  if (!open) return null;

  const handleStartUpdate = async () => {
    setUpdating(true);
    setErrorMsg(null);
    setDoneMessage(null);
    setProgressStep("Downloading latest updates from GitHub...");

    try {
      const res = await fetch("/api/system/update", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start update.");

      if (data.status === "up_to_date") {
        setUpdating(false);
        await checkUpdates(true);
        return;
      }

      const targetCommit: string = data.targetCommit || "";
      let sawRestart = false;

      const pollLoop = async () => {
        for (let attempt = 0; attempt < 160; attempt++) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const pRes = await fetch("/api/system/update?poll=1", { cache: "no-store" });
            if (!pRes.ok) {
              sawRestart = true;
              setProgressStep("Restarting Ambo AI server...");
              continue;
            }
            const pData = (await pRes.json()) as UpdateStatusPayload;
            const st = pData.updateStatus;

            if (st?.state === "error") {
              setErrorMsg(st.error || st.step || "Update failed.");
              setUpdating(false);
              return;
            }

            if (
              st?.state === "completed" ||
              (targetCommit && pData.currentCommit === targetCommit) ||
              (sawRestart && pData.currentCommit)
            ) {
              setProgressStep("Updated! Reloading Ambo AI...");
              setDoneMessage("Updated to the latest version! Reloading...");
              onStatusChecked?.(0);
              setTimeout(() => {
                window.location.reload();
              }, 700);
              return;
            }

            if (st?.step) {
              setProgressStep(st.step);
            }
          } catch {
            sawRestart = true;
            setProgressStep("Rebuilding & restarting Ambo AI (takes ~30–45 seconds)...");
          }
        }

        setErrorMsg("Update timed out waiting for the server to restart. Try reopening Ambo AI.");
        setUpdating(false);
      };

      void pollLoop();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not start update.");
      setUpdating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-app-title"
      onClick={() => {
        if (!updating) onClose();
      }}
    >
      <div
        className="w-full max-w-[460px] rounded-2xl border border-[#E5EAEF] bg-white p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#EDF1F4] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
              <RefreshCw
                className={`h-4 w-4 ${updating || checking ? "animate-spin" : ""}`}
                aria-hidden="true"
              />
            </div>
            <div>
              <h2 id="update-app-title" className="text-base font-semibold text-[#0D1F28]">
                Update Ambo AI
              </h2>
              <p className="text-xs text-[#4E6470]">
                {info?.currentCommit
                  ? `Installed version: ${info.currentCommit}`
                  : "Check GitHub for the latest fixes and features"}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={updating}
            onClick={onClose}
            aria-label="Close update dialog"
            className="rounded-lg p-1 text-[#70848F] hover:bg-[#F3F5F7] hover:text-[#0D1F28] disabled:opacity-40"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4">
          {checking ? (
            <div className="flex items-center gap-2.5 py-6 text-xs text-[#4E6470]">
              <Loader2 className="h-4 w-4 animate-spin text-[#002A3C]" aria-hidden="true" />
              Checking GitHub for new updates...
            </div>
          ) : updating ? (
            <div className="space-y-3 rounded-xl border border-[#E5EAEF] bg-[#FAFBFD] p-4">
              <div className="flex items-center gap-2.5 text-xs font-medium text-[#0D1F28]">
                {doneMessage ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1D3519]" aria-hidden="true" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#002A3C]" aria-hidden="true" />
                )}
                <span>{doneMessage || progressStep || "Updating Ambo AI..."}</span>
              </div>
              <p className="text-[11px] text-[#4E6470]">
                Please keep this tab open — Ambo AI will refresh automatically as soon as the update finishes.
              </p>
            </div>
          ) : errorMsg ? (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          ) : !info?.gitAvailable ? (
            <div className="space-y-2 rounded-xl border border-[#E5EAEF] bg-[#FAFBFD] p-4 text-xs text-[#4E6470]">
              <p className="font-semibold text-[#0D1F28]">Automatic updates are not linked yet</p>
              <p>
                This copy wasn&apos;t downloaded with <code className="rounded bg-white px-1 py-0.5">git clone</code>. To enable 1-click updates, download it with:
              </p>
              <pre className="overflow-x-auto rounded-lg border border-[#E5EAEF] bg-white p-2.5 text-[11px] text-[#0D1F28]">
                git clone https://github.com/lhurepo/ambo-ai.git ~/ambo-ai
              </pre>
            </div>
          ) : info.behindCount > 0 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-[#D5E1E6] bg-[#F4F2E6]/60 p-4">
                <p className="text-xs font-semibold text-[#1D3519]">
                  New update available ({info.behindCount}{" "}
                  {info.behindCount === 1 ? "update" : "updates"} ready)
                </p>
                {info.pendingChanges.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[#0D1F28]">
                    {info.pendingChanges.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="text-xs text-[#4E6470]">
                All of your sermons, clips, prompts, and settings will stay safe.
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#D5E1E6] bg-[#F4F2E6]/50 p-4 text-xs font-medium text-[#1D3519]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1D3519]" aria-hidden="true" />
              <span>Ambo AI is up to date!</span>
            </div>
          )}
        </div>

        {!updating && (
          <div className="mt-6 flex items-center justify-end gap-2">
            {!checking && info?.gitAvailable && (
              <button
                type="button"
                onClick={() => void checkUpdates(true)}
                className="rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
              >
                Check again
              </button>
            )}
            {!checking && info?.gitAvailable && info.behindCount > 0 ? (
              <button
                type="button"
                onClick={handleStartUpdate}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#1D3519] px-5 py-2 text-xs font-medium text-white hover:bg-[#274622]"
              >
                <Download className="h-3.5 w-3.5 text-[#BDD630]" aria-hidden="true" />
                Update &amp; restart now
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#002A3C] px-4 py-2 text-xs font-medium text-white hover:bg-[#0B435B]"
              >
                Done
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
