"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wab-keywords";

function writeKeywords(next: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// Keywords that trigger a notification even when the chat is focused / muted —
// e.g. your name, a site code, "긴급". Persisted in localStorage.
export function useKeywords() {
  const [keywords, setKeywords] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setKeywords(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const add = useCallback((text: string) => {
    const v = text.trim();
    if (!v) return;
    setKeywords((prev) => {
      if (prev.some((k) => k.toLowerCase() === v.toLowerCase())) return prev;
      const next = [...prev, v];
      writeKeywords(next);
      return next;
    });
  }, []);

  const remove = useCallback((index: number) => {
    setKeywords((prev) => {
      const next = prev.filter((_, i) => i !== index);
      writeKeywords(next);
      return next;
    });
  }, []);

  return { keywords, add, remove };
}

// Returns the first keyword found in the text (case-insensitive), or undefined.
export function matchKeyword(text: string, keywords: string[]): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  return keywords.find((k) => k && lower.includes(k.toLowerCase()));
}
