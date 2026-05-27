"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageItem } from "@/lib/whatsapp/types";

export function MessageInput({
  onSend,
  onTyping,
  onFilesSelected,
  replyTo,
  onCancelReply,
}: {
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
  onFilesSelected: (files: File[]) => void;
  replyTo: MessageItem | null;
  onCancelReply: () => void;
}) {
  const [text, setText] = useState("");
  const isTypingRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function setTyping(next: boolean) {
    if (isTypingRef.current === next) return;
    isTypingRef.current = next;
    onTyping(next);
  }

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      if (isTypingRef.current) onTyping(false);
    };
  }, [onTyping]);

  function handleChange(value: string) {
    setText(value);
    if (value.length > 0) {
      setTyping(true);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
      pauseTimerRef.current = setTimeout(() => setTyping(false), 3000);
    } else {
      setTyping(false);
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    setTyping(false);
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    onFilesSelected(files);
  }

  return (
    <div className="border-t border-wa-border bg-wa-panel-soft">
      {replyTo ? <ReplyPreview message={replyTo} onCancel={onCancelReply} /> : null}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFile}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
          title="파일 첨부"
          aria-label="파일 첨부"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M16.5 6.5 8.4 14.6a3 3 0 0 0 4.2 4.2L20.7 10.7a5 5 0 1 0-7.1-7.1L5.6 11.6a7 7 0 1 0 9.9 9.9l7.4-7.4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && replyTo) {
              onCancelReply();
            }
          }}
          placeholder={replyTo ? "답장 메시지 입력..." : "메시지 입력..."}
          className="flex-1 rounded-lg bg-wa-panel px-4 py-2.5 text-[14px] text-wa-text outline-none transition-shadow placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-green text-white shadow-sm transition-all duration-150 hover:bg-wa-green-soft disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="전송"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m4 12 16-8-6 18-3-7-7-3Z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ReplyPreview({
  message,
  onCancel,
}: {
  message: MessageItem;
  onCancel: () => void;
}) {
  const senderLabel = message.fromMe
    ? "나"
    : (message.pushName ?? message.participantJid?.split("@")[0] ?? "답장");
  const preview = previewOf(message);
  return (
    <div className="flex items-stretch gap-2 border-b border-wa-border bg-wa-panel-hover/40 px-3 py-2">
      <div className="w-1 shrink-0 rounded bg-wa-green" />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-semibold text-wa-green">{senderLabel}</div>
        <div className="truncate text-[12px] text-wa-text-muted">{preview}</div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
        aria-label="답장 취소"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="m3 3 6 6M9 3l-6 6"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

function previewOf(m: MessageItem): string {
  if (m.text) return m.text;
  switch (m.type) {
    case "image":
      return "📷 사진";
    case "video":
      return "🎥 영상";
    case "audio":
      return "🎵 오디오";
    case "voice":
      return "🎤 음성 메시지";
    case "document":
      return m.media?.fileName ?? "📄 문서";
    case "sticker":
      return "스티커";
    case "contact":
      return "👤 연락처";
    case "location":
      return "📍 위치";
    case "poll":
      return "📊 투표";
    default:
      return "(메시지)";
  }
}
