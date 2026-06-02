"use client";

import { useEffect } from "react";

export type PendingMedia = {
  name: string;
  mimeType: string;
  buffer: ArrayBuffer;
  /** Object URL for image/video preview, null for documents and audio. */
  previewUrl: string | null;
};

export function MediaPreview({
  items,
  currentIndex,
  caption,
  onIndexChange,
  onCaptionChange,
  onCancel,
  onSend,
}: {
  items: PendingMedia[];
  currentIndex: number;
  caption: string;
  onIndexChange: (i: number) => void;
  onCaptionChange: (c: string) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const current = items[currentIndex];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  if (!current) return null;

  const isImage = current.mimeType.startsWith("image/");
  const isVideo = current.mimeType.startsWith("video/");
  const sizeKB = current.buffer.byteLength / 1024;
  const sizeText = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB.toFixed(0)} KB`;

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-wa-bg">
      <div className="flex items-center gap-3 border-b border-wa-border bg-wa-panel-soft px-4 py-2.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
          aria-label="취소"
          title="취소 (Esc)"
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
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-wa-text">{current.name}</div>
          <div className="text-[11px] text-wa-text-muted">
            {sizeText}
            {items.length > 1 ? ` · ${currentIndex + 1} / ${items.length}` : ""}
          </div>
        </div>
      </div>

      <div className="chat-bg flex flex-1 items-center justify-center overflow-hidden p-6">
        {isImage && current.previewUrl ? (
          <img
            src={current.previewUrl}
            alt={current.name}
            className="max-h-full max-w-full rounded-md object-contain shadow-lg"
          />
        ) : isVideo && current.previewUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: preview, no captions track
          <video
            src={current.previewUrl}
            controls
            className="max-h-full max-w-full rounded-md shadow-lg"
          />
        ) : (
          <div className="text-center">
            <div className="mb-4 text-7xl opacity-50">📄</div>
            <div className="break-words text-sm text-wa-text">{current.name}</div>
            <div className="mt-1 text-xs text-wa-text-muted">{current.mimeType}</div>
          </div>
        )}
      </div>

      {items.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-wa-border bg-wa-panel-soft px-3 py-2">
          {items.map((it, i) => {
            const thumbImage = it.mimeType.startsWith("image/") && !!it.previewUrl;
            return (
              <button
                key={`${it.name}-${i}`}
                type="button"
                onClick={() => onIndexChange(i)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border-2 transition-opacity ${
                  i === currentIndex
                    ? "border-wa-green"
                    : "border-transparent opacity-60 hover:opacity-100"
                }`}
                aria-label={`미리보기 ${i + 1}`}
              >
                {thumbImage && it.previewUrl ? (
                  <img src={it.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-wa-panel text-2xl">
                    📄
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-wa-border bg-wa-panel-soft p-3">
        <input
          type="text"
          value={caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder={items.length > 1 ? "캡션 추가 (첫 파일에 적용)..." : "캡션 추가..."}
          // biome-ignore lint/a11y/noAutofocus: preview opens just for this input
          autoFocus
          className="flex-1 rounded-md bg-wa-panel px-4 py-2.5 text-[14px] text-wa-text outline-none placeholder:text-wa-text-muted focus:ring-1 focus:ring-wa-green/60"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <button
          type="button"
          onClick={onSend}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-green text-white shadow-sm transition-all hover:bg-wa-green-soft"
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
