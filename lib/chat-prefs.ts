"use client";

import { useCallback, useEffect, useState } from "react";

const PIN_KEY = "wab-pinned";
const MUTE_KEY = "wab-muted";

function load(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function save(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

// Per-chat local preferences: pinned (sorted to top) and muted (no notifications).
export function useChatPrefs() {
  const [pinned, setPinned] = useState<string[]>([]);
  const [muted, setMuted] = useState<string[]>([]);

  useEffect(() => {
    setPinned(load(PIN_KEY));
    setMuted(load(MUTE_KEY));
  }, []);

  const togglePin = useCallback((jid: string) => {
    setPinned((prev) => {
      const next = prev.includes(jid) ? prev.filter((j) => j !== jid) : [...prev, jid];
      save(PIN_KEY, next);
      return next;
    });
  }, []);

  const toggleMute = useCallback((jid: string) => {
    setMuted((prev) => {
      const next = prev.includes(jid) ? prev.filter((j) => j !== jid) : [...prev, jid];
      save(MUTE_KEY, next);
      return next;
    });
  }, []);

  return { pinned, muted, togglePin, toggleMute };
}
