"use client";

import type { TypedSocket } from "@/lib/socket/client";
import type { ContactItem } from "@/lib/whatsapp/types";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "./avatar";

export function NewChatModal({
  socket,
  onClose,
  onStartChat,
}: {
  socket: TypedSocket | null;
  onClose: () => void;
  onStartChat: (jid: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket) return;
    socket.emit("list-contacts", (cs) => setContacts(cs));
  }, [socket]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!socket || !phone.trim() || checking) return;
    setChecking(true);
    setError(null);
    socket.emit("check-number", { phone: phone.trim() }, (result) => {
      setChecking(false);
      if (result.exists && result.jid) {
        onStartChat(result.jid);
        onClose();
      } else {
        setError("이 번호는 WhatsApp에 등록되어 있지 않습니다.");
      }
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.jid.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [contacts, query]);

  return (
    <button
      type="button"
      aria-label="배경 클릭으로 닫기"
      className="fixed inset-0 z-50 flex cursor-default items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-wa-border bg-wa-panel text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border bg-wa-panel-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-wa-text">새 채팅 시작</h2>
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

        <form onSubmit={handlePhoneSubmit} className="border-b border-wa-border px-5 py-4">
          <label className="text-[11px] uppercase tracking-wider text-wa-text-muted">
            전화번호로 시작
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (error) setError(null);
              }}
              placeholder="+82 10-1234-5678"
              className="flex-1 rounded-md bg-wa-panel-soft px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
            />
            <button
              type="submit"
              disabled={checking || !phone.trim()}
              className="shrink-0 rounded-md bg-wa-green px-4 text-sm font-medium text-white shadow-sm transition-opacity hover:bg-wa-green-soft disabled:cursor-not-allowed disabled:opacity-40"
            >
              {checking ? "확인 중..." : "시작"}
            </button>
          </div>
          {error ? <div className="mt-2 text-xs text-rose-400">{error}</div> : null}
          <p className="mt-2 text-[11px] text-wa-text-muted">
            국가 코드 포함 (한국: 82). 공백/하이픈은 무시됩니다.
          </p>
        </form>

        <div className="border-b border-wa-border px-5 py-3">
          <label className="text-[11px] uppercase tracking-wider text-wa-text-muted">
            연락처에서 선택
          </label>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="연락처 검색..."
            className="mt-2 w-full rounded-md bg-wa-panel-soft px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
          />
        </div>

        <div className="max-h-[40vh] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-wa-text-muted">
              {contacts.length === 0
                ? "연락처가 아직 동기화되지 않았습니다. 잠시 후 다시 시도하거나 위에 전화번호를 직접 입력하세요."
                : "검색 결과가 없습니다."}
            </div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.jid}
                type="button"
                onClick={() => {
                  onStartChat(c.jid);
                  onClose();
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-wa-panel-soft"
              >
                <Avatar name={c.name} isGroup={c.isGroup} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-wa-text">{c.name}</div>
                  <div className="truncate text-[11px] text-wa-text-muted">
                    {c.isGroup ? "그룹" : formatNumber(c.jid)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </button>
  );
}

function formatNumber(jid: string): string {
  const num = jid.split("@")[0] ?? jid;
  if (num.startsWith("82") && num.length === 12) {
    const local = `0${num.slice(2)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return `+${num}`;
}
