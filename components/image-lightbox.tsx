"use client";

import { useEffect } from "react";

export function ImageLightbox({
  url,
  fileName,
  onClose,
}: {
  url: string;
  fileName?: string;
  onClose: () => void;
}) {
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
      className="fixed inset-0 z-50 flex cursor-default items-center justify-center bg-black/90 p-6"
      onClick={onClose}
    >
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <a
          href={url}
          download={fileName ?? "image"}
          onClick={(e) => e.stopPropagation()}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="다운로드"
          title="다운로드"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 4v12m-5-5 5 5 5-5M5 20h14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          aria-label="닫기"
          title="닫기 (Esc)"
        >
          <svg width="18" height="18" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="m3 3 6 6M9 3l-6 6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: outer wrapper handles Esc */}
      <img
        src={url}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </button>
  );
}
