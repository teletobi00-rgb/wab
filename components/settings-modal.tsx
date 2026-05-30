"use client";

import { useEffect, useState } from "react";
import type { ScheduledItem } from "@/lib/whatsapp/types";

export function SettingsModal({
  keywords,
  onAddKeyword,
  onRemoveKeyword,
  scheduled,
  chatNameOf,
  onCancelScheduled,
  onClose,
}: {
  keywords: string[];
  onAddKeyword: (text: string) => void;
  onRemoveKeyword: (index: number) => void;
  scheduled: ScheduledItem[];
  chatNameOf: (jid: string) => string;
  onCancelScheduled: (id: string) => void;
  onClose: () => void;
}) {
  const [input, setInput] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    const v = input.trim();
    if (!v) return;
    onAddKeyword(v);
    setInput("");
  }

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
          <h2 className="text-[15px] font-semibold text-wa-text">설정</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
            aria-label="닫기"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4">
          <h3 className="text-[13px] font-semibold text-wa-text">키워드 알림</h3>
          <p className="mt-1 text-[11px] text-wa-text-muted">
            등록한 단어가 포함된 메시지는 채팅을 보고 있어도 알림이 울립니다. (이름,
            현장 코드, “긴급” 등)
          </p>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="키워드 입력 후 Enter"
              className="flex-1 rounded-md bg-wa-panel-soft px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!input.trim()}
              className="shrink-0 rounded-md bg-wa-green px-4 text-sm font-medium text-white hover:bg-wa-green-soft disabled:opacity-40"
            >
              추가
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {keywords.length === 0 ? (
              <span className="text-[12px] text-wa-text-muted">등록된 키워드가 없습니다.</span>
            ) : (
              keywords.map((k, i) => (
                <span
                  key={`${k}-${i}`}
                  className="inline-flex items-center gap-1 rounded-full bg-wa-panel-soft px-2.5 py-1 text-[12px] text-wa-text"
                >
                  {k}
                  <button
                    type="button"
                    onClick={() => onRemoveKeyword(i)}
                    className="text-wa-text-muted hover:text-rose-400"
                    aria-label={`${k} 삭제`}
                  >
                    ✕
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-wa-border px-5 py-4">
          <h3 className="text-[13px] font-semibold text-wa-text">예약된 메시지</h3>
          <div className="mt-2 space-y-1.5">
            {scheduled.length === 0 ? (
              <span className="text-[12px] text-wa-text-muted">예약된 메시지가 없습니다.</span>
            ) : (
              scheduled.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 rounded-md bg-wa-panel-soft px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-wa-text">{s.text}</div>
                    <div className="text-[11px] text-wa-text-muted">
                      {chatNameOf(s.jid)} · {new Date(s.sendAt).toLocaleString("ko-KR")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCancelScheduled(s.id)}
                    className="shrink-0 rounded px-2 py-1 text-[11px] text-rose-400 hover:bg-wa-panel"
                  >
                    취소
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
