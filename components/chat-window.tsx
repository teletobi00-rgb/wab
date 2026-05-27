"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ChatInfo,
  MessageItem,
  MessageStatus,
  PresenceState,
  QuotedInfo,
} from "@/lib/whatsapp/types";
import { Avatar } from "./avatar";
import { ImageLightbox } from "./image-lightbox";
import { MediaPreview, type PendingMedia } from "./media-preview";
import { MessageInput } from "./message-input";

export function ChatWindow({
  chat,
  messages,
  presence,
  onSend,
  onTyping,
  onSendMedia,
}: {
  chat: ChatInfo;
  messages: MessageItem[];
  presence: PresenceState | undefined;
  onSend: (text: string, replyToId?: string) => void;
  onTyping: (isTyping: boolean) => void;
  onSendMedia: (
    fileName: string,
    mimeType: string,
    data: ArrayBuffer,
    caption?: string,
    replyToId?: string,
  ) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [pending, setPending] = useState<PendingMedia[] | null>(null);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [pendingCaption, setPendingCaption] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; fileName?: string } | null>(null);
  const isDragging = dragDepth > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, chat.jid]);

  useEffect(() => {
    setDragDepth(0);
    setReplyTo(null);
    setLightbox(null);
    if (pending) {
      for (const p of pending) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    }
    setPending(null);
    setPendingCaption("");
    setPendingIndex(0);
    // biome-ignore lint/correctness/useExhaustiveDependencies: chat change resets all interaction state
  }, [chat.jid]);

  const clearPending = useCallback(() => {
    setPending((prev) => {
      if (prev) {
        for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      return null;
    });
    setPendingCaption("");
    setPendingIndex(0);
  }, []);

  const queueFilesForPreview = useCallback(async (files: File[]) => {
    const items: PendingMedia[] = [];
    for (const file of files) {
      if (file.size > 100 * 1024 * 1024) {
        alert(`${file.name || "파일"}: 100MB 이하 파일만 전송 가능합니다.`);
        continue;
      }
      try {
        const buffer = await file.arrayBuffer();
        const isPreviewable =
          file.type.startsWith("image/") || file.type.startsWith("video/");
        const previewUrl = isPreviewable ? URL.createObjectURL(file) : null;
        const fallbackExt = (file.type.split("/")[1] || "bin").replace(
          /[^a-z0-9]/gi,
          "",
        );
        const name = file.name || `pasted-${Date.now()}.${fallbackExt}`;
        items.push({
          name,
          mimeType: file.type || "application/octet-stream",
          buffer,
          previewUrl,
        });
      } catch (err) {
        console.error("file read failed", err);
      }
    }
    if (items.length === 0) return;
    // Discard any previously-staged batch before replacing.
    setPending((prev) => {
      if (prev) {
        for (const p of prev) if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      return items;
    });
    setPendingIndex(0);
    setPendingCaption("");
  }, []);

  const handleSendPending = useCallback(() => {
    if (!pending || pending.length === 0) return;
    const replyId = replyTo?.id;
    const caption = pendingCaption.trim() || undefined;
    pending.forEach((p, i) => {
      onSendMedia(
        p.name,
        p.mimeType,
        p.buffer,
        i === 0 ? caption : undefined,
        replyId,
      );
    });
    clearPending();
    setReplyTo(null);
  }, [pending, pendingCaption, replyTo, onSendMedia, clearPending]);

  const subtitle = presenceText(presence) ?? (chat.isGroup ? "그룹 채팅" : formatJidShort(chat.jid));

  function handleSend(text: string) {
    onSend(text, replyTo?.id);
    setReplyTo(null);
  }

  function handleDragEnter(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragDepth((d) => d + 1);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragDepth((d) => Math.max(0, d - 1));
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragDepth(0);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) await queueFilesForPreview(files);
  }

  // Keep refs so the paste listener can stay attached for the lifetime of the
  // ChatWindow without re-binding every time the latest callback identity changes.
  const queueRef = useRef(queueFilesForPreview);
  queueRef.current = queueFilesForPreview;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    async function handlePaste(e: ClipboardEvent) {
      const cd = e.clipboardData;
      if (!cd) return;
      const target = e.target as HTMLElement | null;
      const targetTag = target?.tagName;
      const hasText = !!cd.getData("text").length;
      const files: File[] = [];
      for (let i = 0; i < cd.items.length; i++) {
        const item = cd.items[i];
        if (item && item.kind === "file") {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      // If the user is pasting plain text into a text input and there are no
      // image files, defer to the native handler. When files are present we
      // always take over and queue them for preview.
      if (hasText && (targetTag === "INPUT" || targetTag === "TEXTAREA") && files.length === 0) {
        return;
      }
      e.preventDefault();
      await queueRef.current(files);
    }
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  return (
    <div
      className="relative flex h-full flex-col"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-3 border-b border-wa-border bg-wa-panel-soft px-4 py-2.5">
        <Avatar name={chat.name} isGroup={chat.isGroup} size="md" />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium text-wa-text">{chat.name}</div>
          <div
            className={`truncate text-xs transition-colors ${
              presence === "composing" || presence === "recording"
                ? "text-wa-green"
                : "text-wa-text-muted"
            }`}
          >
            {subtitle}
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="chat-bg flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="rounded-full bg-wa-panel-soft/60 px-4 py-1.5 text-xs text-wa-text-muted">
              메시지가 없습니다.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((m, i) => (
              <MessageBubble
                key={m.id}
                message={m}
                showSender={chat.isGroup}
                isLatest={i === messages.length - 1}
                onReply={() => setReplyTo(m)}
                onOpenImage={(url, fileName) => setLightbox({ url, fileName })}
              />
            ))}
          </div>
        )}
      </div>

      <MessageInput
        onSend={handleSend}
        onTyping={onTyping}
        onFilesSelected={(files) => {
          queueFilesForPreview(files);
        }}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
      />

      {isDragging ? <DropOverlay /> : null}
      {pending && pending.length > 0 ? (
        <MediaPreview
          items={pending}
          currentIndex={pendingIndex}
          caption={pendingCaption}
          onIndexChange={setPendingIndex}
          onCaptionChange={setPendingCaption}
          onCancel={clearPending}
          onSend={handleSendPending}
        />
      ) : null}
      {lightbox ? (
        <ImageLightbox
          url={lightbox.url}
          fileName={lightbox.fileName}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-wa-bg/85 backdrop-blur-sm">
      <div className="rounded-2xl border-2 border-dashed border-wa-green bg-wa-panel/80 px-10 py-8 text-center shadow-2xl">
        <div className="text-5xl">📎</div>
        <div className="mt-3 text-base font-medium text-wa-text">파일을 놓아 전송</div>
        <div className="mt-1 text-xs text-wa-text-muted">이미지 · 문서 · 영상 · 100MB 이하</div>
      </div>
    </div>
  );
}

function presenceText(p: PresenceState | undefined): string | null {
  if (p === "composing") return "입력 중...";
  if (p === "recording") return "음성 녹음 중...";
  if (p === "available") return "온라인";
  return null;
}

function formatJidShort(jid: string): string {
  const num = jid.split("@")[0] ?? jid;
  if (num.startsWith("82") && num.length === 12) {
    const local = `0${num.slice(2)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  return num;
}

function MessageBubble({
  message,
  showSender,
  isLatest,
  onReply,
  onOpenImage,
}: {
  message: MessageItem;
  showSender: boolean;
  isLatest: boolean;
  onReply: () => void;
  onOpenImage: (url: string, fileName?: string) => void;
}) {
  const isOut = message.fromMe;
  return (
    <div
      className={`group flex items-start gap-1.5 ${isOut ? "justify-end" : "justify-start"}`}
    >
      {isOut ? <ReplyHandle onReply={onReply} side="out" /> : null}
      <div
        className={`relative max-w-[75%] rounded-lg px-2.5 py-1.5 text-[14px] shadow-sm ${
          isOut ? "rounded-tr-sm bg-wa-bubble-out" : "rounded-tl-sm bg-wa-bubble-in"
        } ${isLatest ? "bubble-in" : ""}`}
      >
        {showSender && !isOut && message.pushName ? (
          <div className="mb-0.5 text-[12px] font-semibold text-wa-green">{message.pushName}</div>
        ) : null}
        {message.quoted ? <QuotedPreview quoted={message.quoted} /> : null}
        <MessageContent message={message} onOpenImage={onOpenImage} />
        <div className="-mb-0.5 mt-1 flex items-center justify-end gap-1 text-[10.5px] text-wa-text-muted">
          <span>
            {new Date(message.timestamp * 1000).toLocaleTimeString("ko-KR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {isOut && message.status ? <StatusIcon status={message.status} /> : null}
        </div>
      </div>
      {!isOut ? <ReplyHandle onReply={onReply} side="in" /> : null}
    </div>
  );
}

function ReplyHandle({ onReply, side }: { onReply: () => void; side: "in" | "out" }) {
  return (
    <button
      type="button"
      onClick={onReply}
      className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wa-panel-soft text-wa-text-muted opacity-0 shadow-sm transition-opacity duration-150 hover:bg-wa-panel-hover hover:text-wa-text group-hover:opacity-100 ${
        side === "out" ? "" : ""
      }`}
      title="답장"
      aria-label="답장"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M9 3 4 7l5 4M4 7h6a3 3 0 0 1 3 3v2"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function QuotedPreview({ quoted }: { quoted: QuotedInfo }) {
  const senderLabel = quoted.fromMe ? "나" : (quoted.pushName ?? "원본");
  const preview = quotedText(quoted);
  return (
    <div className="mb-1 flex items-stretch gap-2 overflow-hidden rounded bg-black/25 px-2 py-1">
      <div className="w-0.5 shrink-0 rounded bg-wa-green" />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-wa-green">{senderLabel}</div>
        <div className="truncate text-[12px] text-wa-text-muted">{preview}</div>
      </div>
    </div>
  );
}

function quotedText(q: QuotedInfo): string {
  if (q.text) return q.text;
  switch (q.type) {
    case "image":
      return "📷 사진";
    case "video":
      return "🎥 영상";
    case "audio":
      return "🎵 오디오";
    case "voice":
      return "🎤 음성 메시지";
    case "document":
      return "📄 문서";
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

function MessageContent({
  message,
  onOpenImage,
}: {
  message: MessageItem;
  onOpenImage: (url: string, fileName?: string) => void;
}) {
  if (message.type === "text" && message.text) {
    return (
      <div className="whitespace-pre-wrap break-words leading-relaxed">{message.text}</div>
    );
  }
  if (message.media?.url) {
    return <MediaContent message={message} url={message.media.url} onOpenImage={onOpenImage} />;
  }
  if (isMediaType(message.type)) {
    return (
      <div className="italic text-wa-text-muted">⏳ {mediaPlaceholder(message)} 로드 중...</div>
    );
  }
  return (
    <div className="italic text-wa-text-muted">
      {mediaPlaceholder(message)}
      {message.text ? <span className="not-italic"> — {message.text}</span> : null}
    </div>
  );
}

function MediaContent({
  message,
  url,
  onOpenImage,
}: {
  message: MessageItem;
  url: string;
  onOpenImage: (url: string, fileName?: string) => void;
}) {
  switch (message.type) {
    case "image":
      return (
        <button
          type="button"
          onClick={() => onOpenImage(url, message.media?.fileName)}
          className="block w-full cursor-zoom-in text-left"
          aria-label="이미지 확대"
        >
          <img
            src={url}
            alt=""
            className="max-h-80 max-w-full rounded-md object-contain"
          />
          {message.text ? (
            <div className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed">
              {message.text}
            </div>
          ) : null}
        </button>
      );
    case "video":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: WhatsApp video has no captions track */}
          <video controls src={url} className="max-h-80 max-w-full rounded-md" />
          {message.text ? (
            <div className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed">
              {message.text}
            </div>
          ) : null}
        </>
      );
    case "audio":
    case "voice":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: voice message has no captions */}
          <audio controls src={url} className="w-[260px] max-w-full" />
        </>
      );
    case "sticker":
      return <img src={url} alt="sticker" className="h-32 w-32 object-contain" />;
    case "document": {
      const name = message.media?.fileName ?? "document";
      return (
        <a
          href={url}
          download={name}
          className="flex items-center gap-2.5 rounded-md bg-wa-panel/60 px-3 py-2.5 text-wa-text transition-colors hover:bg-wa-panel"
        >
          <span className="text-xl">📄</span>
          <span className="truncate text-[13px]">{name}</span>
        </a>
      );
    }
    default:
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline">
          첨부 파일 보기
        </a>
      );
  }
}

function isMediaType(t: MessageItem["type"]): boolean {
  return (
    t === "image" ||
    t === "video" ||
    t === "audio" ||
    t === "voice" ||
    t === "document" ||
    t === "sticker"
  );
}

function mediaPlaceholder(m: MessageItem): string {
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
      return "📄 문서";
    case "sticker":
      return "스티커";
    case "contact":
      return "👤 연락처";
    case "location":
      return "📍 위치";
    case "poll":
      return "📊 투표";
    default:
      return "(빈 메시지)";
  }
}

function StatusIcon({ status }: { status: MessageStatus }) {
  if (status === "pending") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        className="inline-block text-wa-text-muted/70"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
        <path d="M8 4.5v3.7l2.3 1.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  }
  const colorClass = status === "read" ? "text-sky-400" : "text-wa-text-muted/75";
  return (
    <svg
      width="16"
      height="12"
      viewBox="0 0 16 12"
      fill="none"
      className={`inline-block ${colorClass}`}
      aria-hidden="true"
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
