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
  onReact,
  onDelete,
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
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string, forEveryone: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastJidRef = useRef(chat.jid);
  const [dragDepth, setDragDepth] = useState(0);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [pending, setPending] = useState<PendingMedia[] | null>(null);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [pendingCaption, setPendingCaption] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; fileName?: string } | null>(null);
  const isDragging = dragDepth > 0;

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const jidChanged = lastJidRef.current !== chat.jid;
    lastJidRef.current = chat.jid;
    if (jidChanged) {
      // Opening a chat: jump to the latest instantly.
      nearBottomRef.current = true;
      el.scrollTo({ top: el.scrollHeight });
    } else if (nearBottomRef.current) {
      // Only auto-scroll on new messages if the user was already at the bottom —
      // don't yank them down while they're reading older messages.
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
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
    // Mirror the enter guard so the depth counter stays balanced and the drop
    // overlay can't get stuck open.
    if (!e.dataTransfer.types.includes("Files")) return;
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

  // Revoke any staged preview object URLs when the window unmounts (e.g. the
  // chat closes on disconnect/logout while a media preview is open) — the
  // per-event revoke paths don't cover unmount.
  useEffect(() => {
    return () => {
      for (const p of pendingRef.current ?? []) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, []);

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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="chat-bg flex-1 overflow-y-auto px-4 py-4"
      >
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
                onReact={onReact}
                onDelete={onDelete}
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
  onReact,
  onDelete,
}: {
  message: MessageItem;
  showSender: boolean;
  isLatest: boolean;
  onReply: () => void;
  onOpenImage: (url: string, fileName?: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string, forEveryone: boolean) => void;
}) {
  const isOut = message.fromMe;
  const actions = message.deleted ? null : (
    <MessageActions
      isOut={isOut}
      hasText={!!message.text}
      onReact={(emoji) => onReact(message.id, emoji)}
      onReply={onReply}
      onCopy={() => {
        if (message.text) navigator.clipboard?.writeText(message.text).catch(() => {});
      }}
      onDelete={(forEveryone) => onDelete(message.id, forEveryone)}
    />
  );
  return (
    <div
      className={`group flex w-full items-start gap-1.5 ${
        isOut ? "justify-end" : "justify-start"
      }`}
    >
      {isOut ? actions : null}
      <div
        // min-w-0 lets the bubble actually shrink below its content's intrinsic
        // width inside the flex row, so max-w-[...] is respected for long text.
        // The min() cap keeps bubbles readable even on very wide windows.
        className={`relative min-w-0 max-w-[min(75%,640px)] rounded-lg px-2.5 py-1.5 text-[14px] shadow-sm ${
          isOut ? "rounded-tr-sm bg-wa-bubble-out" : "rounded-tl-sm bg-wa-bubble-in"
        } ${isLatest ? "bubble-in" : ""}`}
      >
        {showSender && !isOut && message.pushName ? (
          <div className="mb-0.5 text-[12px] font-semibold text-wa-green">{message.pushName}</div>
        ) : null}
        {message.quoted ? <QuotedPreview quoted={message.quoted} /> : null}
        <MessageContent message={message} onOpenImage={onOpenImage} />
        {message.reactions && message.reactions.length > 0 ? (
          <ReactionChips reactions={message.reactions} />
        ) : null}
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
      {!isOut ? actions : null}
    </div>
  );
}

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "🙏"];

function MessageActions({
  isOut,
  hasText,
  onReact,
  onReply,
  onCopy,
  onDelete,
}: {
  isOut: boolean;
  hasText: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: (forEveryone: boolean) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);
  return (
    <div className="relative mt-1 flex shrink-0 items-center gap-0.5 self-center opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onReact(emoji)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[15px] transition-transform hover:scale-125"
          title={`${emoji} 반응`}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={onReply}
        className="flex h-7 w-7 items-center justify-center rounded-full text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen((o) => !o);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
        title="더보기"
        aria-label="더보기"
      >
        ⋯
      </button>
      {menuOpen ? (
        <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-md border border-wa-border bg-wa-panel-soft py-1 text-[13px] shadow-xl">
          {hasText ? (
            <button
              type="button"
              onClick={() => {
                onCopy();
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-wa-text hover:bg-wa-panel-hover"
            >
              복사
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onDelete(false);
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-wa-text hover:bg-wa-panel-hover"
          >
            나에게서 삭제
          </button>
          {isOut ? (
            <button
              type="button"
              onClick={() => {
                onDelete(true);
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-rose-400 hover:bg-wa-panel-hover"
            >
              모두에게서 삭제
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ReactionChips({ reactions }: { reactions: NonNullable<MessageItem["reactions"]> }) {
  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Array.from(counts.entries()).map(([emoji, n]) => (
        <span
          key={emoji}
          className="inline-flex items-center gap-0.5 rounded-full bg-black/25 px-1.5 py-0.5 text-[11px] leading-none"
        >
          <span>{emoji}</span>
          {n > 1 ? <span className="text-wa-text-muted">{n}</span> : null}
        </span>
      ))}
    </div>
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
  if (message.deleted) {
    return <div className="italic text-wa-text-muted">🚫 삭제된 메시지입니다</div>;
  }
  if (message.type === "text" && message.text) {
    return (
      <div className="whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
        {message.text}
      </div>
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
            <div className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
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
            <div className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
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
      // Show caption below the file badge when the sender attached one.
      // Filter out the case where text equals the filename (our fallback when
      // no real caption is present) so we don't print it twice.
      const caption =
        message.text && message.text !== name ? message.text : null;
      return (
        <>
          <a
            href={url}
            download={name}
            className="flex items-center gap-2.5 rounded-md bg-wa-panel/60 px-3 py-2.5 text-wa-text transition-colors hover:bg-wa-panel"
          >
            <span className="text-xl">📄</span>
            <span className="truncate text-[13px]">{name}</span>
          </a>
          {caption ? (
            <div className="mt-1.5 whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]">
              {caption}
            </div>
          ) : null}
        </>
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
  if (status === "failed") {
    return (
      <span className="font-semibold text-rose-400" title="전송 실패">
        ⚠ 실패
      </span>
    );
  }
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
