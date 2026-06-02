"use client";

import { useTemplates } from "@/lib/templates";
import type { MessageItem } from "@/lib/whatsapp/types";
import { useEffect, useRef, useState } from "react";
import { EmojiPicker } from "./emoji-picker";

export function MessageInput({
  onSend,
  onTyping,
  onFilesSelected,
  onSchedule,
  replyTo,
  onCancelReply,
}: {
  onSend: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
  onFilesSelected: (files: File[]) => void;
  onSchedule: (text: string, sendAt: number) => void;
  replyTo: MessageItem | null;
  onCancelReply: () => void;
}) {
  const [text, setText] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const { templates, add: addTemplate, remove: removeTemplate } = useTemplates();
  const isTypingRef = useRef(false);
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function insertText(s: string) {
    setText((t) => t + s);
    setTyping(true);
  }

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
    <div className="relative border-t border-wa-border bg-wa-panel-soft">
      {replyTo ? <ReplyPreview message={replyTo} onCancel={onCancelReply} /> : null}
      {emojiOpen ? <EmojiPicker onPick={insertText} onClose={() => setEmojiOpen(false)} /> : null}
      {templateOpen ? (
        <TemplatePopup
          templates={templates}
          canAdd={!!text.trim()}
          onPick={(t) => {
            setText(t);
            setTyping(true);
            setTemplateOpen(false);
          }}
          onAdd={() => addTemplate(text)}
          onRemove={removeTemplate}
          onClose={() => setTemplateOpen(false)}
        />
      ) : null}
      {scheduleOpen ? (
        <SchedulePopup
          onConfirm={(sendAt) => {
            const t = text.trim();
            if (t) onSchedule(t, sendAt);
            setText("");
            setTyping(false);
            setScheduleOpen(false);
          }}
          onClose={() => setScheduleOpen(false)}
        />
      ) : null}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFile} />
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
        <button
          type="button"
          onClick={() => {
            setEmojiOpen((o) => !o);
            setTemplateOpen(false);
          }}
          className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-lg transition-colors hover:bg-wa-panel-hover"
          title="이모지"
          aria-label="이모지"
        >
          😀
        </button>
        <button
          type="button"
          onClick={() => {
            setTemplateOpen((o) => !o);
            setEmojiOpen(false);
          }}
          className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-base transition-colors hover:bg-wa-panel-hover"
          title="빠른 답장"
          aria-label="빠른 답장"
        >
          ⚡
        </button>
        <button
          type="button"
          onClick={() => setScheduleOpen(true)}
          disabled={!text.trim()}
          className="flex h-10 w-9 shrink-0 items-center justify-center rounded-full text-base transition-colors hover:bg-wa-panel-hover disabled:opacity-30"
          title="예약 전송"
          aria-label="예약 전송"
        >
          🕐
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

function SchedulePopup({
  onConfirm,
  onClose,
}: {
  onConfirm: (sendAt: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(() => {
    const d = new Date(Date.now() + 60 * 60 * 1000); // default +1h
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}`;
  });

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const sendAt = new Date(value).getTime();
  const valid = Number.isFinite(sendAt) && sendAt > Date.now();

  return (
    <div
      ref={ref}
      className="absolute bottom-12 left-2 z-30 w-72 rounded-xl border border-wa-border bg-wa-panel-soft p-3 shadow-2xl"
    >
      <div className="mb-2 text-[12px] font-semibold text-wa-text">예약 전송 시각</div>
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-md bg-wa-panel px-2 py-1.5 text-[13px] text-wa-text outline-none focus:ring-1 focus:ring-wa-green/60 [color-scheme:dark]"
      />
      <button
        type="button"
        onClick={() => onConfirm(sendAt)}
        disabled={!valid}
        className="mt-2 w-full rounded-md bg-wa-green py-1.5 text-[13px] font-medium text-white hover:bg-wa-green-soft disabled:opacity-40"
      >
        {valid ? "예약" : "미래 시각을 선택하세요"}
      </button>
      <p className="mt-2 text-[10px] text-wa-text-muted">
        앱이 실행 중일 때만 예약 시각에 전송됩니다.
      </p>
    </div>
  );
}

function TemplatePopup({
  templates,
  canAdd,
  onPick,
  onAdd,
  onRemove,
  onClose,
}: {
  templates: string[];
  canAdd: boolean;
  onPick: (text: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute bottom-12 left-2 z-30 w-80 overflow-hidden rounded-xl border border-wa-border bg-wa-panel-soft shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-wa-border px-3 py-2">
        <span className="text-[12px] font-semibold text-wa-text">빠른 답장</span>
        <button
          type="button"
          onClick={onAdd}
          disabled={!canAdd}
          className="text-[12px] text-wa-green disabled:cursor-not-allowed disabled:opacity-40"
          title="현재 입력창 내용을 템플릿으로 저장"
        >
          + 현재 입력 저장
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto py-1">
        {templates.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] text-wa-text-muted">
            저장된 빠른 답장이 없어요.
            <br />
            입력창에 문구를 쓰고 “현재 입력 저장”을 눌러보세요.
          </div>
        ) : (
          templates.map((t, i) => (
            <div
              key={`${t}-${i}`}
              className="group flex items-center gap-1 px-2 hover:bg-wa-panel-hover"
            >
              <button
                type="button"
                onClick={() => onPick(t)}
                className="min-w-0 flex-1 truncate py-1.5 text-left text-[13px] text-wa-text"
              >
                {t}
              </button>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-wa-text-muted opacity-0 transition-opacity hover:bg-wa-panel hover:text-rose-400 group-hover:opacity-100"
                aria-label="삭제"
                title="삭제"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path
                    d="m3 3 6 6M9 3l-6 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
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
