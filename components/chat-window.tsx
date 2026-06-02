"use client";

import type { SummaryResult } from "@/lib/socket/events";
import type {
  ChatInfo,
  MessageItem,
  MessageStatus,
  PresenceState,
  QuotedInfo,
} from "@/lib/whatsapp/types";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  onForward,
  onScheduleMessage,
  onSetAlias,
  onSummarize,
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
  onForward: (messageId: string) => void;
  onScheduleMessage: (text: string, sendAt: number) => void;
  onSetAlias: (name: string) => void;
  onSummarize: (
    from: number | undefined,
    to: number | undefined,
    password: string,
  ) => Promise<SummaryResult>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const lastJidRef = useRef(chat.jid);
  const justOpenedRef = useRef(true);
  const [dragDepth, setDragDepth] = useState(0);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [pending, setPending] = useState<PendingMedia[] | null>(null);
  const [pendingIndex, setPendingIndex] = useState(0);
  const [pendingCaption, setPendingCaption] = useState("");
  const [lightbox, setLightbox] = useState<{ url: string; fileName?: string } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchIdx, setMatchIdx] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [aliasOpen, setAliasOpen] = useState(false);
  const isDragging = dragDepth > 0;

  const matchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => !m.deleted && m.text.toLowerCase().includes(q)).map((m) => m.id);
  }, [messages, searchQuery]);
  const activeMatchId = matchIds[matchIdx];

  function scrollToMessage(id: string) {
    const el = scrollRef.current?.querySelector(`[data-msgid="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  // When the query changes, jump to the last (most recent) match.
  useEffect(() => {
    if (matchIds.length === 0) return;
    const last = matchIds.length - 1;
    setMatchIdx(last);
    scrollToMessage(matchIds[last]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function stepMatch(delta: number) {
    if (matchIds.length === 0) return;
    const next = (matchIdx + delta + matchIds.length) % matchIds.length;
    setMatchIdx(next);
    scrollToMessage(matchIds[next]);
  }

  function exportChat(fromMs?: number, toMs?: number) {
    const inRange = messages.filter((m) => {
      const t = m.timestamp * 1000;
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
      return true;
    });
    const lines = inRange.map((m) => {
      const t = new Date(m.timestamp * 1000).toLocaleString("ko-KR");
      const who = m.fromMe ? "나" : (m.pushName ?? chat.name);
      const body = m.deleted ? "(삭제된 메시지)" : m.text || `[${m.type}]`;
      return `[${t}] ${who}: ${body}`;
    });
    const range =
      fromMs || toMs
        ? ` (${fromMs ? new Date(fromMs).toLocaleDateString("ko-KR") : "처음"} ~ ${
            toMs ? new Date(toMs).toLocaleDateString("ko-KR") : "끝"
          })`
        : "";
    const header = `# ${chat.name}${range} — 내보낸 시각 ${new Date().toLocaleString("ko-KR")}\n\n`;
    const blob = new Blob([header + lines.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = chat.name.replace(/[\\/:*?"<>|]/g, "_");
    a.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function scrollToBottom(smooth = false) {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // Scroll on chat switch / new messages.
  useEffect(() => {
    const jidChanged = lastJidRef.current !== chat.jid;
    lastJidRef.current = chat.jid;
    if (jidChanged) {
      justOpenedRef.current = true;
      nearBottomRef.current = true;
    }
    if (justOpenedRef.current) {
      // Land at the latest message when opening a chat; the message list (and
      // its images) may still be settling, so the ResizeObserver below keeps it
      // pinned to the bottom until content stops growing.
      scrollToBottom(false);
      if (messages.length > 0) justOpenedRef.current = false;
    } else if (nearBottomRef.current) {
      // Auto-scroll on new messages only if already at the bottom.
      scrollToBottom(true);
    }
  }, [messages.length, chat.jid]);

  // Follow content-height growth (image/video loading) and window resizes so the
  // view stays pinned to the bottom when it should.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bind when the list element mounts/unmounts
  useEffect(() => {
    const follow = () => {
      if (justOpenedRef.current || nearBottomRef.current) scrollToBottom(false);
    };
    const content = contentRef.current;
    let ro: ResizeObserver | undefined;
    if (content) {
      ro = new ResizeObserver(follow);
      ro.observe(content);
    }
    window.addEventListener("resize", follow);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", follow);
    };
  }, [messages.length === 0]);

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
    setSearchOpen(false);
    setSearchQuery("");
    setMatchIdx(0);
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
        const isPreviewable = file.type.startsWith("image/") || file.type.startsWith("video/");
        const previewUrl = isPreviewable ? URL.createObjectURL(file) : null;
        const fallbackExt = (file.type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
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
      onSendMedia(p.name, p.mimeType, p.buffer, i === 0 ? caption : undefined, replyId);
    });
    clearPending();
    setReplyTo(null);
  }, [pending, pendingCaption, replyTo, onSendMedia, clearPending]);

  const subtitle =
    presenceText(presence) ?? (chat.isGroup ? "그룹 채팅" : formatJidShort(chat.jid));

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
        <Avatar name={chat.name} isGroup={chat.isGroup} size="md" src={chat.avatarUrl} />
        <div className="min-w-0 flex-1">
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
        <button
          type="button"
          onClick={() => setAliasOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
          title="이름 지정 (별칭)"
          aria-label="이름 지정"
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M4 20h4l10-10-4-4L4 16v4Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="m13.5 6.5 4 4" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setSearchOpen((o) => !o)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-wa-panel-hover ${
            searchOpen ? "text-wa-green" : "text-wa-text-muted hover:text-wa-text"
          }`}
          title="대화 내 검색"
          aria-label="대화 내 검색"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="m20 20-3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
          title="대화 내보내기 (.txt)"
          aria-label="대화 내보내기"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => setSummaryOpen(true)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
          title="AI 요약"
          aria-label="AI 요약"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 3.5 13.8 8 18 9.8 13.8 11.6 12 16l-1.8-4.4L6 9.8 10.2 8 12 3.5Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M18 14.5l.8 1.9 1.9.8-1.9.8L18 20l-.8-2-1.9-.8 1.9-.8.8-1.9Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {searchOpen ? (
        <div className="flex items-center gap-2 border-b border-wa-border bg-wa-panel px-3 py-2">
          {/* biome-ignore lint/a11y/noAutofocus: search opens for this input */}
          <input
            autoFocus
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") stepMatch(e.shiftKey ? 1 : -1);
              else if (e.key === "Escape") setSearchOpen(false);
            }}
            placeholder="이 대화에서 검색..."
            className="flex-1 rounded-md bg-wa-panel-soft px-3 py-1.5 text-[13px] text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
          />
          <span className="shrink-0 text-[12px] text-wa-text-muted">
            {searchQuery.trim() ? `${matchIds.length ? matchIdx + 1 : 0}/${matchIds.length}` : ""}
          </span>
          <button
            type="button"
            onClick={() => stepMatch(-1)}
            disabled={matchIds.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text disabled:opacity-30"
            aria-label="이전 결과"
            title="이전(최신)"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => stepMatch(1)}
            disabled={matchIds.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text disabled:opacity-30"
            aria-label="다음 결과"
            title="다음(과거)"
          >
            ▼
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
            aria-label="검색 닫기"
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
      ) : null}

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
          <div ref={contentRef} className="space-y-1">
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
                onForward={onForward}
                matchActive={!!searchQuery.trim() && m.id === activeMatchId}
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
        onSchedule={onScheduleMessage}
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
      {exportOpen ? (
        <ExportModal
          onClose={() => setExportOpen(false)}
          onExport={(fromMs, toMs) => {
            exportChat(fromMs, toMs);
            setExportOpen(false);
          }}
        />
      ) : null}
      {summaryOpen ? (
        <SummaryModal
          chatName={chat.name}
          onSummarize={onSummarize}
          onClose={() => setSummaryOpen(false)}
        />
      ) : null}
      {aliasOpen ? (
        <AliasModal
          currentName={chat.name}
          onClose={() => setAliasOpen(false)}
          onSave={(name) => {
            onSetAlias(name);
            setAliasOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function AliasModal({
  currentName,
  onSave,
  onClose,
}: {
  currentName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(currentName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-wa-border bg-wa-panel text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border bg-wa-panel-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-wa-text">이름 지정</h2>
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
        <div className="px-5 py-4">
          <p className="mb-3 text-[12px] text-wa-text-muted">
            이 대화에 표시할 이름을 직접 지정합니다. 기기에 저장되어 다시 로그인해도 유지됩니다.
          </p>
          {/* biome-ignore lint/a11y/noAutofocus: modal opens for this input */}
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(name);
            }}
            placeholder="표시할 이름"
            className="w-full rounded-md bg-wa-panel-soft px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
          />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => onSave("")}
              className="rounded-md bg-wa-panel-soft px-3 py-2 text-[13px] text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
              title="지정한 이름을 지우고 원래 이름으로 되돌립니다"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={() => onSave(name)}
              className="flex-1 rounded-md bg-wa-green py-2 text-[13px] font-medium text-white hover:bg-wa-green-soft"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </button>
  );
}

function ExportModal({
  onExport,
  onClose,
}: {
  onExport: (fromMs?: number, toMs?: number) => void;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function run() {
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toMs = to ? new Date(`${to}T23:59:59`).getTime() : undefined;
    onExport(fromMs, toMs);
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
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-wa-border bg-wa-panel text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border bg-wa-panel-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-wa-text">대화 내보내기</h2>
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
        <div className="px-5 py-4">
          <p className="mb-3 text-[12px] text-wa-text-muted">
            기간을 비워두면 전체를 내보냅니다. (앱이 받은 범위 내)
          </p>
          <div className="flex items-center gap-2">
            <label className="flex-1 text-[12px] text-wa-text">
              시작
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-md bg-wa-panel-soft px-2 py-1.5 text-[13px] text-wa-text outline-none [color-scheme:dark] focus:ring-1 focus:ring-wa-green/60"
              />
            </label>
            <label className="flex-1 text-[12px] text-wa-text">
              끝
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-md bg-wa-panel-soft px-2 py-1.5 text-[13px] text-wa-text outline-none [color-scheme:dark] focus:ring-1 focus:ring-wa-green/60"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={run}
            className="mt-4 w-full rounded-md bg-wa-green py-2 text-[13px] font-medium text-white hover:bg-wa-green-soft"
          >
            .txt 다운로드
          </button>
        </div>
      </div>
    </button>
  );
}

function SummaryModal({
  chatName,
  onSummarize,
  onClose,
}: {
  chatName: string;
  onSummarize: (
    from: number | undefined,
    to: number | undefined,
    password: string,
  ) => Promise<SummaryResult>;
  onClose: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SummaryResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run() {
    if (loading) return;
    if (!password.trim()) {
      setResult({ ok: false, error: "비밀번호를 입력하세요." });
      return;
    }
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : undefined;
    const toMs = to ? new Date(`${to}T23:59:59`).getTime() : undefined;
    setLoading(true);
    setResult(null);
    try {
      setResult(await onSummarize(fromMs, toMs, password.trim()));
    } catch (err) {
      setResult({ ok: false, error: String(err) });
    } finally {
      setLoading(false);
    }
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
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-wa-border bg-wa-panel text-left shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-wa-border bg-wa-panel-soft px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-wa-text">✨ AI 대화 요약</h2>
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
        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-3 text-[12px] text-wa-text-muted">
            <span className="text-wa-text">{chatName}</span> · 기간을 비우면 받은 전체를 요약합니다.
            (앱이 받은 범위 내)
          </p>
          <div className="flex items-center gap-2">
            <label className="flex-1 text-[12px] text-wa-text">
              시작
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-md bg-wa-panel-soft px-2 py-1.5 text-[13px] text-wa-text outline-none [color-scheme:dark] focus:ring-1 focus:ring-wa-green/60"
              />
            </label>
            <label className="flex-1 text-[12px] text-wa-text">
              끝
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-md bg-wa-panel-soft px-2 py-1.5 text-[13px] text-wa-text outline-none [color-scheme:dark] focus:ring-1 focus:ring-wa-green/60"
              />
            </label>
          </div>
          <label className="mt-3 block text-[12px] text-wa-text">
            비밀번호
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") run();
              }}
              placeholder="요약 비밀번호"
              className="mt-1 w-full rounded-md bg-wa-panel-soft px-2 py-1.5 text-[13px] text-wa-text outline-none focus:ring-1 focus:ring-wa-green/60"
            />
          </label>
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="mt-4 w-full rounded-md bg-wa-green py-2 text-[13px] font-medium text-white hover:bg-wa-green-soft disabled:opacity-60"
          >
            {loading ? "요약 중… (수십 초 걸릴 수 있어요)" : "AI로 요약하기"}
          </button>
          {result?.ok ? (
            <div className="mt-4 rounded-lg border border-wa-border bg-wa-bg p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] text-wa-text-muted">
                  메시지 {result.meta?.messageCount ?? 0}개 · 이미지 {result.meta?.imageCount ?? 0}
                  장
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openSummaryWindow(result.summary ?? "", chatName)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
                  >
                    ↗ 새 창
                  </button>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(result.summary ?? "")}
                    className="rounded px-1.5 py-0.5 text-[11px] text-wa-text-muted hover:bg-wa-panel-hover hover:text-wa-text"
                  >
                    복사
                  </button>
                </div>
              </div>
              <div className="max-h-[45vh] overflow-y-auto pr-1">
                <MarkdownView text={result.summary ?? ""} />
              </div>
            </div>
          ) : result?.error ? (
            <p className="mt-3 text-[12px] text-red-400">{result.error}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// Lightweight markdown renderer for the AI summary (## / # headings,
// - / * bullet lists, **bold**, paragraphs). Avoids a markdown-lib dependency.
function renderInline(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    }
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}

function MarkdownView({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) {
      nodes.push(
        <ul
          key={`ul-${nodes.length}`}
          className="ml-1 list-disc space-y-1 pl-4 marker:text-wa-text-muted"
        >
          {list}
        </ul>,
      );
      list = [];
    }
  };
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) {
      flush();
      continue;
    }
    if (t.startsWith("## ")) {
      flush();
      nodes.push(
        <h3 key={i} className="mt-3 text-[14px] font-semibold text-wa-green first:mt-0">
          {renderInline(t.slice(3), `h${i}`)}
        </h3>,
      );
    } else if (t.startsWith("# ")) {
      flush();
      nodes.push(
        <h2 key={i} className="mt-3 text-[15px] font-bold text-wa-text first:mt-0">
          {renderInline(t.slice(2), `h${i}`)}
        </h2>,
      );
    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      list.push(
        <li key={i} className="text-[13px] leading-relaxed text-wa-text">
          {renderInline(t.replace(/^[-*]\s+/, ""), `li${i}`)}
        </li>,
      );
    } else {
      flush();
      nodes.push(
        <p key={i} className="text-[13px] leading-relaxed text-wa-text">
          {renderInline(t, `p${i}`)}
        </p>,
      );
    }
  }
  flush();
  return <div className="space-y-1.5">{nodes}</div>;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineHtml(s: string): string {
  return escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function markdownToHtml(md: string): string {
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const line of md.split("\n")) {
    const t = line.trim();
    if (!t) {
      closeList();
    } else if (t.startsWith("## ")) {
      closeList();
      html += `<h2>${inlineHtml(t.slice(3))}</h2>`;
    } else if (t.startsWith("# ")) {
      closeList();
      html += `<h1>${inlineHtml(t.slice(2))}</h1>`;
    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inlineHtml(t.replace(/^[-*]\s+/, ""))}</li>`;
    } else {
      closeList();
      html += `<p>${inlineHtml(t)}</p>`;
    }
  }
  closeList();
  return html;
}

// Open the summary as a clean standalone page in a new tab (easy to read,
// print, or save). Blob URL — no server round-trip.
function openSummaryWindow(markdown: string, title: string) {
  const doc = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — AI 요약</title><style>
body{margin:0;background:#0b141a;color:#e9edef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Pretendard',sans-serif;line-height:1.65}
.wrap{max-width:760px;margin:0 auto;padding:44px 24px}
.head{border-bottom:1px solid #2a3942;padding-bottom:14px;margin-bottom:22px}
h1{font-size:22px;margin:0}h2{font-size:17px;margin:26px 0 8px;color:#00a884}
p{margin:8px 0;font-size:15px}ul{margin:8px 0;padding-left:22px}li{margin:5px 0;font-size:15px}
.meta{color:#8696a0;font-size:12px;margin-top:4px}
@media print{body{background:#fff;color:#111}h2{color:#067a5b}}
</style></head><body><div class="wrap"><div class="head"><h1>✨ ${escapeHtml(title)} 요약</h1><div class="meta">${escapeHtml(new Date().toLocaleString("ko-KR"))}</div></div>${markdownToHtml(markdown)}</div></body></html>`;
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  onForward,
  matchActive,
}: {
  message: MessageItem;
  showSender: boolean;
  isLatest: boolean;
  onReply: () => void;
  onOpenImage: (url: string, fileName?: string) => void;
  onReact: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string, forEveryone: boolean) => void;
  onForward: (messageId: string) => void;
  matchActive?: boolean;
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
      onForward={() => onForward(message.id)}
    />
  );
  return (
    <div
      data-msgid={message.id}
      className={`group flex w-full items-start gap-1.5 ${isOut ? "justify-end" : "justify-start"}`}
    >
      {isOut ? actions : null}
      <div
        // min-w-0 lets the bubble actually shrink below its content's intrinsic
        // width inside the flex row, so max-w-[...] is respected for long text.
        // The min() cap keeps bubbles readable even on very wide windows.
        className={`relative min-w-0 max-w-[min(75%,640px)] rounded-lg px-2.5 py-1.5 text-[14px] shadow-sm ${
          isOut ? "rounded-tr-sm bg-wa-bubble-out" : "rounded-tl-sm bg-wa-bubble-in"
        } ${isLatest ? "bubble-in" : ""} ${
          matchActive ? "ring-2 ring-wa-green ring-offset-1 ring-offset-wa-bg-chat" : ""
        }`}
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
  onForward,
}: {
  isOut: boolean;
  hasText: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: (forEveryone: boolean) => void;
  onForward: () => void;
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
              onForward();
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-1.5 text-left text-wa-text hover:bg-wa-panel-hover"
          >
            전달
          </button>
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
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const counts = new Map<string, number>();
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);

  return (
    <div className="relative mt-1 inline-block">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="flex flex-wrap gap-1"
        title="반응 보기"
      >
        {Array.from(counts.entries()).map(([emoji, n]) => (
          <span
            key={emoji}
            className="inline-flex items-center gap-0.5 rounded-full bg-black/25 px-1.5 py-0.5 text-[11px] leading-none"
          >
            <span>{emoji}</span>
            {n > 1 ? <span className="text-wa-text-muted">{n}</span> : null}
          </span>
        ))}
      </button>
      {open ? (
        <div className="absolute left-0 top-7 z-20 max-h-48 w-44 overflow-y-auto rounded-lg border border-wa-border bg-wa-panel-soft py-1 shadow-xl">
          {reactions.map((r, i) => (
            <div
              key={`${r.sender ?? "me"}-${i}`}
              className="flex items-center gap-2 px-3 py-1 text-[12px]"
            >
              <span className="text-[15px]">{r.emoji}</span>
              <span className="truncate text-wa-text">
                {r.senderName ?? (r.fromMe ? "나" : (r.sender?.split("@")[0] ?? "알 수 없음"))}
              </span>
            </div>
          ))}
        </div>
      ) : null}
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

const TEXT_CLASS = "whitespace-pre-wrap break-words leading-relaxed [overflow-wrap:anywhere]";

// Split text on URLs and render them as external links (opened in the system
// browser via the window-open handler in the Electron main process).
function linkify(text: string) {
  return text.split(/(\bhttps?:\/\/[^\s]+)/gi).map((part, i) =>
    /^https?:\/\//i.test(part) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: split output is positional
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-wa-link underline"
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

function LinkifiedText({ text, className }: { text: string; className?: string }) {
  return <div className={className}>{linkify(text)}</div>;
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
    return <LinkifiedText text={message.text} className={TEXT_CLASS} />;
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
          <img src={url} alt="" className="max-h-80 max-w-full rounded-md object-contain" />
          {message.text ? (
            <LinkifiedText text={message.text} className={`mt-1.5 ${TEXT_CLASS}`} />
          ) : null}
        </button>
      );
    case "video":
      return (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: WhatsApp video has no captions track */}
          <video controls src={url} className="max-h-80 max-w-full rounded-md" />
          {message.text ? (
            <LinkifiedText text={message.text} className={`mt-1.5 ${TEXT_CLASS}`} />
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
      const caption = message.text && message.text !== name ? message.text : null;
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
          {caption ? <LinkifiedText text={caption} className={`mt-1.5 ${TEXT_CLASS}`} /> : null}
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
        <path
          d="M8 4.5v3.7l2.3 1.4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
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
