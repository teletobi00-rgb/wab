"use client";

import type { ChatInfo } from "@/lib/whatsapp/types";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "./avatar";

export function ForwardModal({
  chats,
  onPick,
  onClose,
}: {
  chats: ChatInfo[];
  onPick: (jid: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = chats
      .slice()
      .sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
    if (!q) return sorted;
    return sorted.filter(
      (c) => c.name.toLowerCase().includes(q) || c.jid.toLowerCase().includes(q),
    );
  }, [chats, query]);

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-default items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        className="relative m-0 w-full max-w-md overflow-hidden rounded-2xl border border-wa-border bg-wa-panel p-0 text-left shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border bg-wa-panel-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-wa-text">전달할 대화 선택</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
            aria-label="닫기"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="m3 3 6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="border-b border-wa-border px-5 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="대화 검색..."
            className="w-full rounded-md bg-wa-panel-soft px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
          />
        </div>

        <div className="max-h-[45vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-wa-text-muted">대화가 없습니다.</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.jid}
                type="button"
                onClick={() => onPick(c.jid)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-wa-panel-soft"
              >
                <Avatar name={c.name} isGroup={c.isGroup} size="sm" />
                <span className="truncate text-sm font-medium text-wa-text">{c.name}</span>
              </button>
            ))
          )}
        </div>
      </dialog>
    </div>
  );
}
