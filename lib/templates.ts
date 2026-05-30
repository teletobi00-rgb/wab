"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wab-quick-replies";

// Quick-reply templates persisted in localStorage. Handy for repetitive work
// updates ("현장 도착", "확인했습니다", daily report boilerplate, etc.).
export function useTemplates() {
  const [templates, setTemplates] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setTemplates(JSON.parse(raw));
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const persist = useCallback((next: string[]) => {
    setTemplates(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / disabled storage
    }
  }, []);

  const add = useCallback(
    (text: string) => {
      const v = text.trim();
      if (!v) return;
      setTemplates((prev) => {
        if (prev.includes(v)) return prev;
        const next = [...prev, v];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  const remove = useCallback(
    (index: number) => {
      setTemplates((prev) => {
        const next = prev.filter((_, i) => i !== index);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [],
  );

  return { templates, add, remove, persist };
}
