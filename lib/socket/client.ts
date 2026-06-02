"use client";

import { useEffect, useState } from "react";
import { type Socket, io } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let cachedSocket: TypedSocket | null = null;

const TOKEN_KEY = "wab_token";

export function getStoredToken(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
  // Mirror into a cookie so same-origin /media <img>/<a> requests authenticate
  // (those don't carry the Socket.IO auth payload).
  document.cookie = `${TOKEN_KEY}=${encodeURIComponent(token)}; path=/; max-age=31536000; SameSite=Strict`;
}

function getSocket(): TypedSocket {
  if (!cachedSocket) {
    // Start on HTTP long-polling and only *upgrade* to WebSocket if it works.
    // Some endpoint-DLP agents let the TCP connection establish but block the
    // WebSocket upgrade; polling-first guarantees a connection either way.
    // `auth.token` is empty in the local build (server has no gate) and the
    // shared token in cloud deployments (server enforces it via io.use).
    cachedSocket = io({
      auth: { token: getStoredToken() },
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    }) as TypedSocket;

    // Diagnostics: log every connection state transition. In the packaged app
    // these are captured by the Electron main process into wab-server.log.
    const s = cachedSocket;
    s.on("connect", () => {
      const t = s.io?.engine?.transport?.name ?? "?";
      console.log(`[socket] connected id=${s.id} transport=${t}`);
    });
    s.on("disconnect", (reason) => console.log(`[socket] disconnect: ${reason}`));
    s.on("connect_error", (err: Error & { description?: unknown }) => {
      console.log(`[socket] connect_error: ${err.message} | desc=${String(err.description ?? "")}`);
    });
    s.io.on("reconnect_attempt", (n: number) => console.log(`[socket] reconnect_attempt ${n}`));
    s.io.on("error", (err: Error) =>
      console.log(`[socket] manager_error: ${err?.message ?? String(err)}`),
    );
  }
  return cachedSocket;
}

// Re-authenticate the existing socket with a new token (cloud mode). Persists
// the token + cookie and forces a reconnect so the handshake re-runs.
export function applyToken(token: string): void {
  setStoredToken(token);
  const s = getSocket();
  s.auth = { token };
  s.disconnect().connect();
}

export function useSocket() {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const s = getSocket();
    setSocket(s);
    setConnected(s.connected);

    const onConnect = () => {
      setConnected(true);
      setAuthError(false);
    };
    const onDisconnect = () => setConnected(false);
    const onConnectError = (err: Error) => {
      // Server rejected the handshake token (cloud mode) — prompt for a token.
      if (err.message === "unauthorized") setAuthError(true);
    };
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("connect_error", onConnectError);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("connect_error", onConnectError);
    };
  }, []);

  return { socket, connected, authError };
}
