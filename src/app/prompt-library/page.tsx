"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Layers, Loader2, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";

interface PromptRow {
  id: string;
  title: string;
  category: string;
  drawerTab: string;
  body: string;
  isBuiltin: number;
}

interface GenerationPromptItem {
  key: string;
  label: string;
  group: string;
  defaultPrompt: string;
  promptText: string;
  isCustom: boolean;
}

export default function PromptLibraryPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"generation" | "mine" | "templates">("generation");

  // Automatic generation rules (per-resource instructions applied every time)
  const [genPrompts, setGenPrompts] = useState<GenerationPromptItem[]>([]);
  const [selectedGenKey, setSelectedGenKey] = useState<string | null>("global_system");
  const [genDraft, setGenDraft] = useState("");
  const [savingGen, setSavingGen] = useState(false);

  // Chat prompt library
  const [userPrompts, setUserPrompts] = useState<PromptRow[]>([]);
  const [builtinPrompts, setBuiltinPrompts] = useState<PromptRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("user");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  // Modals
  const [confirmDeletePromptOpen, setConfirmDeletePromptOpen] = useState(false);
  const [confirmResetGenKey, setConfirmResetGenKey] = useState<string | null>(null);
  const [workingModal, setWorkingModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const [chatRes, genRes] = await Promise.all([
        fetch("/api/prompts"),
        fetch("/api/prompts/generation"),
      ]);
      if (chatRes.status === 401 || genRes.status === 401) {
        router.push("/signin");
        return;
      }
      if (chatRes.ok) {
        const data = await chatRes.json();
        setUserPrompts(data.userPrompts || []);
        setBuiltinPrompts(data.builtinPrompts || []);
      }
      if (genRes.ok) {
        const gData = await genRes.json();
        const items: GenerationPromptItem[] = gData.prompts || [];
        setGenPrompts(items);
        setSelectedGenKey((prev) => {
          const key = prev || items[0]?.key || null;
          const found = items.find((i) => i.key === key);
          if (found) setGenDraft(found.promptText);
          return key;
        });
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const selectGenSlot = (item: GenerationPromptItem) => {
    setSelectedGenKey(item.key);
    setGenDraft(item.promptText);
  };

  const handleSaveGen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGenKey || !genDraft.trim()) return;
    setSavingGen(true);
    try {
      const res = await fetch("/api/prompts/generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType: selectedGenKey, promptText: genDraft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save rule");
      await load();
      success("Generation prompt saved — every sermon run will follow this rule.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save rule.");
    } finally {
      setSavingGen(false);
    }
  };

  const handleConfirmResetGen = async () => {
    if (!confirmResetGenKey) return;
    setWorkingModal(true);
    try {
      const res = await fetch(
        `/api/prompts/generation?assetType=${encodeURIComponent(confirmResetGenKey)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to reset prompt");
      await load();
      success("Reset to default Garden Church prompt.");
      setConfirmResetGenKey(null);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setWorkingModal(false);
    }
  };

  const selectPrompt = (p: PromptRow) => {
    setSelectedId(p.id);
    setTitle(p.title);
    setCategory(p.category);
    setBody(p.body);
  };

  const startNew = () => {
    setViewMode("mine");
    setSelectedId("new");
    setTitle("");
    setCategory("user");
    setBody("");
  };

  const handleSaveChatPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const isEditingExisting =
        selectedId !== null &&
        selectedId !== "new" &&
        userPrompts.some((p) => p.id === selectedId);

      const res = await fetch("/api/prompts", {
        method: isEditingExisting ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isEditingExisting ? { id: selectedId, title, category, body } : { title, category, body }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save prompt");
      await load();
      if (data.prompt?.id) setSelectedId(data.prompt.id);
      setViewMode("mine");
      success("Chat prompt saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save prompt.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeletePrompt = async () => {
    if (!selectedId || selectedId === "new") return;
    setWorkingModal(true);
    try {
      await fetch(`/api/prompts?id=${encodeURIComponent(selectedId)}`, { method: "DELETE" });
      setSelectedId(null);
      setTitle("");
      setBody("");
      setConfirmDeletePromptOpen(false);
      await load();
      success("Prompt deleted.");
    } finally {
      setWorkingModal(false);
    }
  };

  const selectedGenItem = genPrompts.find((i) => i.key === selectedGenKey) || null;
  const isBuiltinSelected =
    selectedId !== null && builtinPrompts.some((p) => p.id === selectedId);
  const activeChatList = viewMode === "mine" ? userPrompts : builtinPrompts;

  return (
    <AuthenticatedShell>
      <div className="mx-auto flex h-full max-w-6xl flex-col px-5 py-7 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-[#0D1F28]">Prompt library</h1>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Create chat prompt
          </button>
        </div>

        {loading ? (
          <div className="mt-12 flex items-center justify-center py-16 text-[#4E6470]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
        <div className="mt-6 grid flex-1 grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col rounded-2xl border border-[#E5EAEF] bg-white p-4 lg:col-span-4">
            <div className="grid grid-cols-3 gap-1 rounded-full bg-[#F3F5F7] p-1 text-[11px] font-medium">
              <button
                type="button"
                onClick={() => setViewMode("generation")}
                className={`rounded-full py-1.5 transition ${
                  viewMode === "generation"
                    ? "bg-white text-[#0D1F28] shadow-sm"
                    : "text-[#4E6470] hover:text-[#0D1F28]"
                }`}
              >
                Generation rules
              </button>
              <button
                type="button"
                onClick={() => setViewMode("mine")}
                className={`rounded-full py-1.5 transition ${
                  viewMode === "mine"
                    ? "bg-white text-[#0D1F28] shadow-sm"
                    : "text-[#4E6470] hover:text-[#0D1F28]"
                }`}
              >
                Chat ({userPrompts.length})
              </button>
              <button
                type="button"
                onClick={() => setViewMode("templates")}
                className={`rounded-full py-1.5 transition ${
                  viewMode === "templates"
                    ? "bg-white text-[#0D1F28] shadow-sm"
                    : "text-[#4E6470] hover:text-[#0D1F28]"
                }`}
              >
                Templates ({builtinPrompts.length})
              </button>
            </div>

            <div className="mt-3 max-h-[580px] flex-1 space-y-1 overflow-y-auto pr-1">
              {viewMode === "generation" ? (
                genPrompts.map((item) => {
                  const active = selectedGenKey === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => selectGenSlot(item)}
                      className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                        active
                          ? "bg-[#EBF4F7] font-medium text-[#002A3C]"
                          : "text-[#0D1F28] hover:bg-[#F7F8FA]"
                      }`}
                    >
                      <span className="truncate">{item.label}</span>
                      {item.isCustom && (
                        <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#1D3519] border border-[#D5E1E6]">
                          Custom
                        </span>
                      )}
                    </button>
                  );
                })
              ) : activeChatList.length === 0 ? (
                <p className="px-2 py-8 text-center text-xs text-[#70848F]">No prompts yet.</p>
              ) : (
                activeChatList.map((p) => {
                  const active = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPrompt(p)}
                      className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition ${
                        active
                          ? "bg-[#EBF4F7] font-medium text-[#002A3C]"
                          : "text-[#0D1F28] hover:bg-[#F7F8FA]"
                      }`}
                    >
                      <span className="truncate">{p.title}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex flex-col rounded-2xl border border-[#E5EAEF] bg-white p-6 lg:col-span-8">
            {viewMode === "generation" ? (
              selectedGenItem ? (
                <form onSubmit={handleSaveGen} className="flex flex-1 flex-col space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#EDF1F4] pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4 text-[#002A3C]" aria-hidden="true" />
                        <h2 className="text-base font-semibold text-[#0D1F28]">
                          {selectedGenItem.label}
                        </h2>
                        {selectedGenItem.isCustom && (
                          <span className="rounded-full bg-[#F4F2E6] px-2.5 py-0.5 text-[11px] font-medium text-[#1D3519]">
                            Custom rule active
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#4E6470]">
                        Follows your custom instructions automatically on every sermon upload and regeneration.
                      </p>
                    </div>
                    {selectedGenItem.isCustom && (
                      <button
                        type="button"
                        onClick={() => setConfirmResetGenKey(selectedGenItem.key)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
                      >
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        Reset to default
                      </button>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col">
                    <label
                      htmlFor="gen-prompt-text"
                      className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                    >
                      Prompt instruction
                    </label>
                    <textarea
                      id="gen-prompt-text"
                      required
                      rows={10}
                      value={genDraft}
                      onChange={(e) => setGenDraft(e.target.value)}
                      className="w-full flex-1 rounded-xl border border-transparent bg-[#F3F5F7] p-3.5 text-sm leading-relaxed text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="submit"
                      disabled={savingGen}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-5 py-2 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
                    >
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      Save generation rule
                    </button>
                  </div>
                </form>
              ) : null
            ) : selectedId === null ? (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                  <Layers className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-medium text-[#0D1F28]">
                  Select a chat prompt or create a new one
                </p>
                <button
                  type="button"
                  onClick={startNew}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Create chat prompt
                </button>
              </div>
            ) : (
              <form onSubmit={handleSaveChatPrompt} className="flex flex-1 flex-col space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-[#0D1F28]">
                    {selectedId === "new"
                      ? "New chat prompt"
                      : isBuiltinSelected
                        ? "Template prompt"
                        : "Edit chat prompt"}
                  </h2>
                  {selectedId !== "new" && !isBuiltinSelected && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePromptOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#E5EAEF] px-3 py-1 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Delete
                    </button>
                  )}
                </div>

                <div>
                  <label htmlFor="prompt-title" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                    Title
                  </label>
                  <input
                    id="prompt-title"
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Garden Boston Discussion Hook"
                    className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-1 flex-col">
                  <label htmlFor="prompt-body" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                    Prompt
                  </label>
                  <textarea
                    id="prompt-body"
                    required
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={9}
                    placeholder="Write instructions to run against a sermon transcript..."
                    className="w-full flex-1 rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm leading-relaxed text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" aria-hidden="true" />
                    {isBuiltinSelected ? "Save as my prompt" : "Save prompt"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
        )}
      </div>

      <ConfirmModal
        open={confirmDeletePromptOpen}
        title="Delete saved prompt?"
        description="Remove this custom chat prompt from your library? This cannot be undone."
        confirmLabel="Delete prompt"
        variant="danger"
        loading={workingModal}
        onConfirm={handleConfirmDeletePrompt}
        onCancel={() => setConfirmDeletePromptOpen(false)}
      />

      <ConfirmModal
        open={Boolean(confirmResetGenKey)}
        title="Reset generation rule to default?"
        description="Discard your custom generation instructions for this resource and restore the Garden Church default prompt?"
        confirmLabel="Reset to default"
        variant="primary"
        loading={workingModal}
        onConfirm={handleConfirmResetGen}
        onCancel={() => setConfirmResetGenKey(null)}
      />
    </AuthenticatedShell>
  );
}
