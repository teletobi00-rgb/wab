"use client";

import { useMemo } from "react";
import type { ChatInfo, MessageStatus } from "@/lib/whatsapp/types";
import { Avatar } from "./avatar";

export function ChatList({
  chats,
  selectedJid,
  onSelect,
  query = "",
}: {
  chats: ChatInfo[];
  selectedJid: string | null;
  onSelect: (jid: string) => void;
  query?: string;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.lastMessage?.toLowerCase().includes(q)) return true;
      if (c.jid.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [chats, query]);

  if (chats.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-2 text-3xl opacity-40">💬</div>
        <p className="text-xs text-wa-text-muted">
          대화가 아직 없어요.
          <br />
          동기화에 잠시 시간이 걸릴 수 있습니다.
        </p>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-2 text-3xl opacity-40">🔍</div>
        <p className="text-xs text-wa-text-muted">검색 결과가 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {filtered.map((c) => {
        const isSelected = selectedJid === c.jid;
        return (
          <button
            key={c.jid}
            type="button"
            onClick={() => onSelect(c.jid)}
            className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ${
              isSelected
                ? "bg-wa-panel-hover"
                : "border-b border-wa-border hover:bg-wa-panel-soft/60"
            }`}
          >
            <Avatar name={c.name} isGroup={c.isGroup} size="lg" />
            <div className="min-w-0 flex-1 border-b border-transparent">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[15px] font-medium text-wa-text">{c.name}</span>
                {c.lastMessageTime ? (
                  <span
                    className={`shrink-0 text-[11px] ${
                      c.unreadCount > 0 ? "text-wa-green" : "text-wa-text-muted"
                    }`}
                  >
                    {formatTime(c.lastMessageTime)}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                {c.lastMessageFromMe && c.lastMessageStatus ? (
                  <ChatStatusIcon status={c.lastMessageStatus} />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[13px] text-wa-text-muted">
                  {c.lastMessage ?? ""}
                </span>
                {c.unreadCount > 0 ? (
                  <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa-green px-1.5 text-[11px] font-semibold text-black/80">
                    {c.unreadCount}
                  </span>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ChatStatusIcon({ status }: { status: MessageStatus }) {
  if (status === "pending") {
    return (
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-wa-text-muted/70"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.5v3.7l2.3 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  const colorClass = status === "read" ? "text-sky-400" : "text-wa-text-muted/70";
  return (
    <svg
      width="15"
      height="11"
      viewBox="0 0 16 12"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 ${colorClass}`}
    >
      <path
        d="M1 6.4 4 9.5 9.6 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {status === "delivered" || status === "read" ? (
        <path
          d="M6.4 9.5 12 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
    </svg>
  );
}

function formatTime(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "어제";
  return d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
