"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "wa-notifications-enabled";

type NotifSupport = "unsupported" | "denied" | "default" | "granted";

function getSupport(): NotifSupport {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotifSupport;
}

export function useNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [support, setSupport] = useState<NotifSupport>("unsupported");

  useEffect(() => {
    setSupport(getSupport());
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "true" && Notification.permission === "granted") {
      setEnabled(true);
    }
  }, []);

  const toggle = useCallback(async () => {
    if (typeof Notification === "undefined") {
      alert("이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    if (enabled) {
      setEnabled(false);
      window.localStorage.setItem(STORAGE_KEY, "false");
      return;
    }
    if (Notification.permission === "default") {
      const result = await Notification.requestPermission();
      setSupport(result as NotifSupport);
      if (result !== "granted") return;
    } else if (Notification.permission === "denied") {
      alert("브라우저 설정에서 알림을 허용해주세요.");
      return;
    }
    setEnabled(true);
    window.localStorage.setItem(STORAGE_KEY, "true");
  }, [enabled]);

  const notify = useCallback(
    (title: string, body: string, onClick?: () => void) => {
      if (!enabled || typeof Notification === "undefined") return;
      if (Notification.permission !== "granted") return;
      try {
        const n = new Notification(title, { body, silent: false, tag: title });
        if (onClick) {
          n.onclick = () => {
            window.focus();
            onClick();
            n.close();
          };
        }
      } catch (err) {
        console.error("notification failed", err);
      }
    },
    [enabled],
  );

  return { enabled, support, toggle, notify };
}
