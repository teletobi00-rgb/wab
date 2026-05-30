"use client";

import { useEffect, useRef } from "react";

// A compact, dependency-free emoji set grouped loosely by theme. Enough for
// everyday chat without pulling in a multi-MB emoji library.
const EMOJIS = [
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "🙂",
  "🙃", "😉", "😌", "😍", "🥰", "😘", "😋", "😛", "😜", "🤪",
  "🤨", "🧐", "🤓", "😎", "🥳", "🤩", "😏", "😒", "😞", "😔",
  "😟", "🙁", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤",
  "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰",
  "😥", "😓", "🤗", "🤔", "🤭", "🤫", "😶", "😐", "😑", "😬",
  "🙄", "😮", "😲", "🥱", "😴", "🤤", "😪", "🤢", "🤮", "🤧",
  "😷", "🤒", "🤕", "👍", "👎", "👌", "🙏", "👏", "🙌", "👋",
  "🤝", "💪", "✌️", "🤞", "👆", "👇", "👈", "👉", "✋", "🖐️",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯",
  "🔥", "⭐", "✨", "🎉", "🎊", "✅", "❌", "❓", "❗", "💡",
  "👀", "🎯", "📌", "📎", "📷", "📞", "⏰", "🚀", "🙆", "🙅",
];

export function EmojiPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: string) => void;
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
    // Defer so the opening click doesn't immediately close it.
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
      className="absolute bottom-12 left-2 z-30 max-h-64 w-72 overflow-y-auto rounded-xl border border-wa-border bg-wa-panel-soft p-2 shadow-2xl"
    >
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onPick(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded text-[18px] transition-colors hover:bg-wa-panel-hover"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
