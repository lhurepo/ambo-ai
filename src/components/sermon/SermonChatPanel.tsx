"use client";

import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Send, Trash2 } from "lucide-react";
import { MarkdownView } from "@/components/ui/MarkdownView";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | string;
  content: string;
}

interface PromptItem {
  id: string;
  title: string;
  drawerTab: string;
  body: string;
}

interface SermonChatPanelProps {
  sermonId: string;
  initialMessages: ChatMessage[];
}

export function SermonChatPanel({ sermonId, initialMessages }: SermonChatPanelProps) {
  const { success, error: toastError } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerTab, setDrawerTab] = useState<"content" | "coach" | "iterate" | "user">("content");
  const [builtinPrompts, setBuiltinPrompts] = useState<PromptItem[]>([]);
  const [userPrompts, setUserPrompts] = useState<PromptItem[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages(initialMessages);
  }, [initialMessages]);

  useEffect(() => {
    fetch("/api/prompts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setBuiltinPrompts(d.builtinPrompts || []);
          setUserPrompts(d.userPrompts || []);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendMessage = async (textOverride?: string) => {
    const msg = (textOverride ?? input).trim();
    if (!msg || streaming) return;

    setInput("");
    setDrawerOpen(false);
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: msg };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg, { id: assistantId, role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId, message: msg }),
      });
      if (!res.ok || !res.body) throw new Error("Chat request failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const parsed = JSON.parse(line.slice(5).trim());
            if (parsed.delta) {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + parsed.delta } : m))
              );
            }
          } catch {}
        }
      }
    } catch (err) {
      const msgText = err instanceof Error ? err.message : String(err);
      toastError(msgText);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, content: `Error: ${msgText}` } : m
        )
      );
    } finally {
      setStreaming(false);
    }
  };

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      const res = await fetch(`/api/chat?sermonId=${encodeURIComponent(sermonId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not clear chat history");
      setMessages([]);
      setConfirmClearOpen(false);
      success("Chat history cleared.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not clear chat.");
    } finally {
      setClearing(false);
    }
  };

  const visiblePrompts =
    drawerTab === "user"
      ? userPrompts
      : builtinPrompts.filter((p) => p.drawerTab === drawerTab);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-[#E5EAEF] bg-white">
      <div className="flex items-center justify-between border-b border-[#EDF1F4] px-4 py-3">
        <span className="text-sm font-semibold text-[#0D1F28]">Sermon Assistant</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-full border border-[#E5EAEF] bg-[#FAFBFD] px-2.5 py-1 text-xs font-medium text-[#4E6470] hover:text-[#0D1F28]"
          >
            Prompts
            {drawerOpen ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              aria-label="Clear chat history"
              className="rounded-lg p-1.5 text-[#70848F] hover:bg-rose-50 hover:text-rose-700"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="min-h-[180px] max-h-[340px] flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-xs leading-relaxed text-[#70848F]">
            Ask anything about your sermon or pick a prompt below.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-xl px-3.5 py-2.5 text-sm ${
                m.role === "user"
                  ? "ml-6 bg-[#002A3C] text-white"
                  : "mr-2 border border-[#EDF1F4] bg-[#F7F8FA] text-[#0D1F28]"
              }`}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <MarkdownView content={m.content} />
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-[#4E6470]">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Thinking...
                  </span>
                )
              ) : (
                <p className="text-xs">{m.content}</p>
              )}
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {drawerOpen && (
        <div className="border-t border-[#EDF1F4] bg-[#FAFBFD] px-3 py-2.5">
          <div className="flex items-center gap-1 rounded-full bg-[#F3F5F7] p-0.5 text-[11px] font-medium">
            {(
              [
                { id: "content", label: "Content" },
                { id: "coach", label: "Coach" },
                { id: "iterate", label: "Iterate" },
                { id: "user", label: "My prompts" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setDrawerTab(t.id)}
                className={`flex-1 rounded-full py-1 transition ${
                  drawerTab === t.id
                    ? "bg-white text-[#0D1F28] shadow-sm"
                    : "text-[#4E6470] hover:text-[#0D1F28]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mt-2 max-h-32 space-y-1 overflow-y-auto pr-1">
            {visiblePrompts.length === 0 ? (
              <p className="py-2 text-center text-[11px] text-[#70848F]">
                No custom prompts yet.
              </p>
            ) : (
              visiblePrompts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setInput(p.body)}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-xs text-[#0D1F28] transition hover:bg-white"
                >
                  {p.body}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex items-center gap-2 border-t border-[#EDF1F4] p-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything about your sermon..."
          aria-label="Ask anything about your sermon"
          className="flex-1 rounded-full border border-transparent bg-[#F3F5F7] px-4 py-2 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          aria-label="Send message"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#002A3C] text-white transition hover:bg-[#0B435B] disabled:opacity-45"
        >
          {streaming ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </form>

      <ConfirmModal
        open={confirmClearOpen}
        title="Clear sermon chat history?"
        description="This permanently deletes all messages in the assistant conversation for this sermon."
        confirmLabel="Clear chat"
        variant="danger"
        loading={clearing}
        onConfirm={handleConfirmClear}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
