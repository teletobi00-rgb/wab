"use client";

import { useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "./events";

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let cachedSocket: TypedSocket | null = null;

function getSocket(): TypedSocket {
  if (!cachedSocket) {
    cachedSocket = io({ transports: ["websocket", "polling"] }) as TypedSocket;
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
