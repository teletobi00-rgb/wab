import fs from "node:fs/promises";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "./socket/events";
import { type WhatsAppClient, initWhatsApp } from "./whatsapp/client";

const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

// Diagnostic logger for server-side connection issues (DLP blocking, listen
// failures) which are otherwise invisible in the packaged app.
function serverLogPath(): string | null {
  const file = process.env.WAB_LOG_FILE;
  if (!file) return null;
  // Write to a SEPARATE file from the pino/Baileys log. Sharing the file makes
  // fs.appendFile contend with pino's held handle on Windows and silently fail.
  return file.endsWith(".log") ? `${file.slice(0, -4)}-server.log` : `${file}-server.log`;
}

function slog(msg: string) {
  const line = `[server ${new Date().toISOString()}] ${msg}\n`;
  console.log(line.trimEnd());
  const file = serverLogPath();
  if (file) fs.appendFile(file, line).catch(() => {});
}

// Optional shared access token for cloud/remote deployments. When set, both the
// Socket.IO handshake and /media requests must present it (socket auth payload
// and a cookie, respectively). Empty in the local Electron build → no gate, so
// loopback-only security is preserved there.
const ACCESS_TOKEN = process.env.WAB_ACCESS_TOKEN?.trim() || "";

function getCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

// Warn loudly in cloud mode if /data isn't an actual mounted volume. Baileys
// would otherwise write the session to ephemeral container disk that vanishes
// on the next restart, locking the user out (they can't re-scan QR from the
// blocked network). Heuristic: a real mountpoint has a different device id
// than the root filesystem.
async function warnIfVolumeMissing(): Promise<void> {
  if (!ACCESS_TOKEN) return; // cloud mode only
  const authDir = process.env.WAB_AUTH_DIR ?? "";
  if (!authDir.startsWith("/data")) return;
  try {
    const [dataStat, rootStat] = await Promise.all([fs.stat("/data"), fs.stat("/")]);
    if (dataStat.dev === rootStat.dev) {
      slog(
        "⚠️  /data is NOT a mounted volume — the WhatsApp session will be LOST on restart. Attach a volume at /data (see DEPLOY.md step 5).",
      );
    } else {
      slog("/data volume detected — session will persist across restarts");
    }
  } catch (err) {
    slog(`volume check skipped: ${String(err)}`);
  }
}

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
    // Unauthenticated liveness probe for the hosting platform (Railway
    // healthcheckPath). Leaks nothing beyond the WhatsApp connection state.
    if (req.url === "/health" || req.url === "/healthz") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, wa: wa?.getStatus().state ?? "init" }));
      return;
    }
    if (req.url?.startsWith("/media/") && wa) {
      if (ACCESS_TOKEN) {
        const u = new URL(req.url, "http://localhost");
        const tok = u.searchParams.get("token") || getCookie(req.headers.cookie, "wab_token");
        if (tok !== ACCESS_TOKEN) {
          res.statusCode = 401;
          res.end("Unauthorized");
          return;
        }
      }
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
        // Cloud (token) mode: the access token is the security boundary and the
        // page is served same-origin from the host, so allow any origin here and
        // gate on the token in io.use() below. Local mode stays loopback-only.
        if (ACCESS_TOKEN || !origin || isLoopbackOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error("Origin not allowed"), false);
        }
      },
    },
    maxHttpBufferSize: MEDIA_MAX_BYTES,
  });

  // Cloud auth gate: require the shared token in the Socket.IO handshake before
  // any events flow. No token configured → local Electron build → open.
  if (ACCESS_TOKEN) {
    io.use((socket, next) => {
      const tok =
        (socket.handshake.auth as { token?: string } | undefined)?.token ||
        getCookie(socket.handshake.headers.cookie, "wab_token");
      if (tok === ACCESS_TOKEN) next();
      else next(new Error("unauthorized"));
    });
  }

  // Surface low-level Engine.IO handshake failures (CORS rejects, transport
  // errors, DLP interference) which otherwise stay invisible.
  io.engine.on("connection_error", (err: { code?: number; message?: string }) => {
    slog(`engine connection_error: code=${err.code} msg=${err.message}`);
  });

  console.log("Initializing WhatsApp client...");
  wa = await initWhatsApp(io);
  console.log("WhatsApp client ready (waiting for QR scan or session restore)");
  await warnIfVolumeMissing();

  io.on("connection", (socket) => {
    slog(`socket connected id=${socket.id} transport=${socket.conn.transport.name}`);
    socket.conn.on("upgrade", () =>
      slog(`socket ${socket.id} upgraded to ${socket.conn.transport.name}`),
    );
    socket.on("disconnect", (reason) => slog(`socket ${socket.id} disconnect: ${reason}`));
    if (!wa) return;
    socket.emit("status", wa.getStatus());
    const qr = wa.getQr();
    if (qr) socket.emit("qr", { qr });
    socket.emit("chats", wa.getChats());
    socket.emit("scheduled", wa.getScheduled());

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
      wa?.ensureAvatar(jid).catch(() => {});
      ack(msgs);
    });

    socket.on("mark-read", async ({ jid }) => {
      try {
        await wa?.markRead(jid);
      } catch (err) {
        console.error("mark-read failed", err);
      }
    });

    socket.on("mark-all-read", async () => {
      try {
        await wa?.markAllRead();
      } catch (err) {
        console.error("mark-all-read failed", err);
      }
    });

    socket.on("send-reaction", async ({ jid, messageId, emoji }) => {
      try {
        await wa?.sendReaction(jid, messageId, emoji);
      } catch (err) {
        console.error("send-reaction failed", err);
      }
    });

    socket.on("delete-message", async ({ jid, messageId, forEveryone }) => {
      try {
        await wa?.deleteMessage(jid, messageId, forEveryone);
      } catch (err) {
        console.error("delete-message failed", err);
      }
    });

    socket.on("forward-message", async ({ toJid, messageId }) => {
      try {
        await wa?.forwardMessage(toJid, messageId);
      } catch (err) {
        console.error("forward-message failed", err);
      }
    });

    socket.on("schedule-message", ({ jid, text, sendAt }) => {
      try {
        wa?.scheduleMessage(jid, text, sendAt);
      } catch (err) {
        console.error("schedule-message failed", err);
      }
    });

    socket.on("cancel-scheduled", ({ id }) => {
      try {
        wa?.cancelScheduled(id);
      } catch (err) {
        console.error("cancel-scheduled failed", err);
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

    socket.on("set-alias", ({ jid, name }) => {
      try {
        wa?.setAlias(jid, name);
      } catch (err) {
        console.error("set-alias failed", err);
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
    // Graceful shutdown. On Railway redeploy the container receives SIGTERM
    // before SIGKILL; stop accepting connections and give in-flight saveCreds
    // fs writes a moment to settle so the session on the /data volume isn't
    // torn by a mid-write kill (which would force an un-performable QR re-scan).
    // Local Electron quits via the tray and never receives SIGTERM.
    let shuttingDown = false;
    const shutdown = (sig: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      slog(`${sig} received — shutting down gracefully`);
      try {
        io.close();
      } catch {}
      try {
        httpServer.close();
      } catch {}
      setTimeout(() => process.exit(0), 400);
    };
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Cloud mode binds 0.0.0.0 so the platform can route external traffic; the
    // token gate above protects it. Local Electron mode stays loopback-only.
    const bindHost = process.env.WAB_BIND_HOST || (ACCESS_TOKEN ? "0.0.0.0" : "127.0.0.1");
    httpServer.listen(options.port, bindHost, () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      slog(`HTTP server listening on ${bindHost}:${port}`);
      resolve({ port });
    });
    httpServer.on("error", (err) => {
      slog(`HTTP server error: ${String(err)}`);
      reject(err);
    });
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
