import fs from "node:fs/promises";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./socket/events";
import { initWhatsApp, type WhatsAppClient } from "./whatsapp/client";

const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export type StartServerOptions = {
  port: number;
  dir?: string;
  hostname?: string;
  dev?: boolean;
};

export async function startServer(options: StartServerOptions): Promise<{ port: number }> {
  const hostname = options.hostname ?? "localhost";
  const dev = options.dev ?? process.env.NODE_ENV !== "production";
  const dir = options.dir;

  const nextApp = next({ dev, hostname, port: options.port, ...(dir ? { dir } : {}) });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  let wa: WhatsAppClient | null = null;

  const httpServer = createServer(async (req, res) => {
    if (req.url?.startsWith("/media/") && wa) {
      const id = decodeURIComponent(req.url.slice("/media/".length).split("?")[0] ?? "");
      const entry = wa.getMediaEntry(id);
      if (!entry) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }
      try {
        const data = await fs.readFile(entry.filePath);
        res.setHeader("Content-Type", entry.mimeType);
        res.setHeader("Cache-Control", "private, max-age=86400");
        if (entry.fileName) {
          const safe = encodeURIComponent(entry.fileName);
          res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${safe}`);
        }
        res.end(data);
      } catch (err) {
        console.error("media read failed", err);
        res.statusCode = 500;
        res.end("Read failed");
      }
      return;
    }
    handle(req, res);
  });

  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    // Only accept WebSocket handshakes whose Origin is a loopback address (or
    // has no Origin header — same-origin / Electron file:// navigations). This
    // blocks a malicious page in another browser tab on the same machine from
    // hijacking the socket (CSWSH), now that we also bind to 127.0.0.1 below.
    cors: {
      origin: (origin, callback) => {
        if (!origin || isLoopbackOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Origin not allowed"), false);
        }
      },
    },
    maxHttpBufferSize: MEDIA_MAX_BYTES,
  });

  console.log("Initializing WhatsApp client...");
  wa = await initWhatsApp(io);
  console.log("WhatsApp client ready (waiting for QR scan or session restore)");

  io.on("connection", (socket) => {
    if (!wa) return;
    socket.emit("status", wa.getStatus());
    const qr = wa.getQr();
    if (qr) socket.emit("qr", { qr });
    socket.emit("chats", wa.getChats());

    socket.on("send-message", async ({ jid, text, replyToId, tempId }, ack) => {
      try {
        const id = await wa?.sendMessage(jid, text, replyToId, tempId);
        ack?.({ ok: true, id });
      } catch (err) {
        console.error("send-message failed", err);
        ack?.({ ok: false });
      }
    });

    socket.on(
      "send-media",
      async ({ jid, fileName, mimeType, data, caption, replyToId, tempId }, ack) => {
        try {
          const buffer = Buffer.isBuffer(data)
            ? (data as Buffer)
            : Buffer.from(data as ArrayBuffer);
          const id = await wa?.sendMedia(
            jid,
            fileName,
            mimeType,
            buffer,
            caption,
            replyToId,
            tempId,
          );
          ack?.({ ok: true, id });
        } catch (err) {
          console.error("send-media failed", err);
          ack?.({ ok: false });
        }
      },
    );

    socket.on("load-messages", ({ jid, limit }, ack) => {
      const msgs = wa?.loadMessages(jid, limit ?? 50) ?? [];
      ack(msgs);
    });

    socket.on("mark-read", async ({ jid }) => {
      try {
        await wa?.markRead(jid);
      } catch (err) {
        console.error("mark-read failed", err);
      }
    });

    socket.on("typing", async ({ jid, isTyping }) => {
      try {
        await wa?.sendTyping(jid, isTyping);
      } catch (err) {
        console.error("typing failed", err);
      }
    });

    socket.on("subscribe-presence", async ({ jid }) => {
      try {
        await wa?.subscribePresence(jid);
      } catch (err) {
        console.error("subscribe-presence failed", err);
      }
    });

    socket.on("list-contacts", (ack) => {
      ack(wa?.getContacts() ?? []);
    });

    socket.on("check-number", async ({ phone }, ack) => {
      try {
        const result = await wa?.checkOnWhatsApp(phone);
        ack(result ?? { exists: false });
      } catch (err) {
        console.error("check-number failed", err);
        ack({ exists: false });
      }
    });

    socket.on("start-chat", ({ jid }, ack) => {
      try {
        const chat = wa?.ensureChat(jid);
        ack(chat ?? null);
      } catch (err) {
        console.error("start-chat failed", err);
        ack(null);
      }
    });

    socket.on("logout", async () => {
      try {
        await wa?.logout();
      } catch (err) {
        console.error("logout failed", err);
      }
    });
  });

  return new Promise<{ port: number }>((resolve, reject) => {
    // Bind to loopback only. Without an explicit host Node listens on 0.0.0.0,
    // which would expose the user's entire WhatsApp session to anyone on the
    // same LAN (no auth). This is a single-user desktop app, so 127.0.0.1.
    httpServer.listen(options.port, "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      console.log(`> Ready on http://127.0.0.1:${port}`);
      resolve({ port });
    });
    httpServer.on("error", reject);
  });
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}
