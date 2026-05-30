"use client";

import { useEffect, useMemo, useState } from "react";
import type { ChatInfo, MessageStatus } from "@/lib/whatsapp/types";
import { Avatar } from "./avatar";

export function ChatList({
  chats,
  selectedJid,
  onSelect,
  query = "",
  pinned,
  muted,
  onTogglePin,
  onToggleMute,
}: {
  chats: ChatInfo[];
  selectedJid: string | null;
  onSelect: (jid: string) => void;
  query?: string;
  pinned: string[];
  muted: string[];
  onTogglePin: (jid: string) => void;
  onToggleMute: (jid: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? chats
      : chats.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.lastMessage?.toLowerCase().includes(q) ||
            c.jid.toLowerCase().includes(q),
        );
    // Pinned chats float to the top; stable sort keeps the time order within.
    return base
      .slice()
      .sort((a, b) => (pinned.includes(b.jid) ? 1 : 0) - (pinned.includes(a.jid) ? 1 : 0));
  }, [chats, query, pinned]);

  if (chats.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="mb-2 text-3xl opacity-40">💬</div>
        <p className="text-xs leading-relaxed text-wa-text-muted">
          기록 동기화는 꺼져 있어요.
          <br />앱 구동 이후 들어오는 메시지만 표시됩니다.
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
      {filtered.map((c) => (
        <ChatRow
          key={c.jid}
          chat={c}
          isSelected={selectedJid === c.jid}
          isPinned={pinned.includes(c.jid)}
          isMuted={muted.includes(c.jid)}
          onSelect={onSelect}
          onTogglePin={onTogglePin}
          onToggleMute={onToggleMute}
        />
      ))}
    </div>
  );
}

function ChatRow({
  chat: c,
  isSelected,
  isPinned,
  isMuted,
  onSelect,
  onTogglePin,
  onToggleMute,
}: {
  chat: ChatInfo;
  isSelected: boolean;
  isPinned: boolean;
  isMuted: boolean;
  onSelect: (jid: string) => void;
  onTogglePin: (jid: string) => void;
  onToggleMute: (jid: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(c.jid)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(c.jid);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      className={`group relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ${
        isSelected ? "bg-wa-panel-hover" : "border-b border-wa-border hover:bg-wa-panel-soft/60"
      }`}
    >
      <Avatar name={c.name} isGroup={c.isGroup} size="lg" />
      <div className="min-w-0 flex-1 border-b border-transparent">
        <div className="flex items-baseline justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1">
            {isPinned ? <span className="shrink-0 text-[11px]">📌</span> : null}
            {isMuted ? <span className="shrink-0 text-[11px]">🔇</span> : null}
            <span className="truncate text-[15px] font-medium text-wa-text">{c.name}</span>
          </span>
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
            <span
              className={`ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
                isMuted ? "bg-wa-text-muted/60 text-black/70" : "bg-wa-green text-black/80"
              }`}
            >
              {c.unreadCount}
            </span>
          ) : null}
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-wa-panel-soft text-wa-text-muted opacity-0 shadow transition-opacity hover:text-wa-text group-hover:opacity-100"
        aria-label="채팅 메뉴"
      >
        ⌄
      </button>
      {menuOpen ? (
        <div className="absolute right-2 top-9 z-20 w-32 overflow-hidden rounded-md border border-wa-border bg-wa-panel-soft py-1 text-[13px] shadow-xl">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(c.jid);
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-wa-text hover:bg-wa-panel-hover"
          >
            {isPinned ? "고정 해제" : "📌 고정"}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMute(c.jid);
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-wa-text hover:bg-wa-panel-hover"
          >
            {isMuted ? "음소거 해제" : "🔇 음소거"}
          </button>
        </div>
      ) : null}
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
