"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let cachedSocket: TypedSocket | null = null;

function getSocket(): TypedSocket {
  if (!cachedSocket) {
    // Start on HTTP long-polling and only *upgrade* to WebSocket if it works.
    // Some endpoint-DLP agents (e.g. Digital Guardian) let the TCP connection
    // establish but block the WebSocket upgrade, which previously left us stuck
    // on "서버 연결 중" forever. Polling-first guarantees a connection; the
    // upgrade is a silent best-effort bonus on machines that allow it.
    cachedSocket = io({
      transports: ["polling", "websocket"],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    }) as TypedSocket;
  }
  return cachedSocket;
}

export function useSocket() {
  const [socket, setSocket] = useState<TypedSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    setSocket(s);
    setConnected(s.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
    };
  }, []);

  return { socket, connected };
}
