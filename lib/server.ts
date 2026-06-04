import fs from "node:fs/promises";
import { createServer } from "node:http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { type GeminiPart, geminiConfigured, generateContent } from "./ai/gemini";
import type { ClientToServerEvents, ServerToClientEvents, SummaryResult } from "./socket/events";
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

// Collect a chat's messages (and image attachments) in the given time range and
// ask Gemini for a Korean summary. Runs server-side so the API key and media
// bytes never reach the browser. Range is in epoch milliseconds (optional).
async function summarizeChat(
  wa: WhatsAppClient,
  jid: string,
  from?: number,
  to?: number,
): Promise<SummaryResult> {
  const MAX_IMAGES = 20;
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_TRANSCRIPT_CHARS = 100_000;

  const inRange = wa.loadMessages(jid, 1000).filter((m) => {
    const ms = m.timestamp * 1000;
    if (from && ms < from) return false;
    if (to && ms > to) return false;
    return true;
  });

  const lines: string[] = [];
  const imageParts: GeminiPart[] = [];
  let imageCount = 0;

  for (const m of inRange) {
    const who = m.fromMe ? "나" : m.pushName || "상대";
    const time = new Date(m.timestamp * 1000).toLocaleString("ko-KR");
    if (m.deleted) {
      lines.push(`[${time}] ${who}: (삭제된 메시지)`);
      continue;
    }
    if (m.type === "image" && m.media?.url && imageCount < MAX_IMAGES) {
      const id = m.media.url.split("/media/")[1]?.split("?")[0];
      const entry = id ? wa.getMediaEntry(id) : undefined;
      if (entry && entry.size <= MAX_IMAGE_BYTES) {
        try {
          const buf = await fs.readFile(entry.filePath);
          imageParts.push({
            inlineData: { mimeType: entry.mimeType, data: buf.toString("base64") },
          });
          imageCount++;
        } catch {
          // unreadable media — skip the attachment, keep the text marker
        }
      }
      lines.push(`[${time}] ${who}: [이미지${m.text ? ` - ${m.text}` : ""}]`);
      continue;
    }
    if (m.type === "document") {
      lines.push(
        `[${time}] ${who}: [문서: ${m.media?.fileName ?? "파일"}${m.text ? ` - ${m.text}` : ""}]`,
      );
      continue;
    }
    if (m.type === "video") {
      lines.push(`[${time}] ${who}: [영상${m.text ? ` - ${m.text}` : ""}]`);
      continue;
    }
    if (m.type === "voice" || m.type === "audio") {
      lines.push(`[${time}] ${who}: [음성 메시지]`);
      continue;
    }
    if (m.text) lines.push(`[${time}] ${who}: ${m.text}`);
  }

  if (lines.length === 0) {
    return {
      ok: false,
      error: "선택한 기간에 요약할 메시지가 없습니다. (앱이 받은 범위 내에서만 요약됩니다)",
    };
  }

  let transcript = lines.join("\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = `(앞부분 생략)\n${transcript.slice(-MAX_TRANSCRIPT_CHARS)}`;
  }

  const prompt = `당신은 채팅 대화를 분석하는 비서입니다. 아래 대화 기록(과 첨부된 이미지)을 한국어로 요약하세요.

다음 형식을 사용하세요:
## 한줄 요약
(전체 대화를 한 문장으로)

## 핵심 내용
- (주요 논의/사건을 불릿으로 정리)

## 결정사항 / 할 일
- (있으면 정리, 없으면 "없음")

## 특이사항
- (중요한 약속·날짜·금액·연락처·링크 등이 있으면. 없으면 이 섹션 생략)

첨부된 이미지가 있으면 그 내용도 요약에 반영하세요.

--- 대화 기록 ---
${transcript}`;

  const parts: GeminiPart[] = [{ text: prompt }, ...imageParts];
  const summary = await generateContent(parts);
  return { ok: true, summary, meta: { messageCount: lines.length, imageCount } };
}

// Old unbounded *.log files on the /data volume used to fill it up (logs now go
// to stdout, which the platform captures). On boot in cloud mode, delete stale
// log files to reclaim space and report current /data usage so disk growth is
// visible. Runs BEFORE the WhatsApp client so a near-full volume doesn't block
// Baileys' creds writes.
async function cleanupAndReportData(): Promise<void> {
  const authDir = process.env.WAB_AUTH_DIR ?? "";
  if (!authDir.startsWith("/data")) return; // cloud only
  try {
    const items = await fs.readdir("/data", { withFileTypes: true });
    const report: string[] = [];
    for (const it of items) {
      const p = `/data/${it.name}`;
      if (it.isFile()) {
        const s = await fs.stat(p).catch(() => null);
        const mb = s ? s.size / 1024 / 1024 : 0;
        if (it.name.endsWith(".log")) {
          await fs.rm(p, { force: true }).catch(() => {});
          slog(`removed stale log ${it.name} (${mb.toFixed(1)}MB)`);
        } else {
          report.push(`${it.name}=${mb.toFixed(1)}MB`);
        }
      } else if (it.isDirectory()) {
        const files = await fs.readdir(p).catch(() => []);
        let total = 0;
        for (const f of files) {
          const s = await fs.stat(`${p}/${f}`).catch(() => null);
          if (s) total += s.size;
        }
        report.push(`${it.name}/=${(total / 1024 / 1024).toFixed(1)}MB(${files.length} files)`);
      }
    }
    slog(`/data usage after cleanup: ${report.join(", ")}`);
  } catch (err) {
    slog(`data cleanup/report failed: ${String(err)}`);
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

  await cleanupAndReportData();
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

    socket.on("summarize-chat", async ({ jid, from, to, password }, ack) => {
      try {
        const expected = process.env.WAB_SUMMARY_PASSWORD?.trim() || "1812";
        if (password !== expected) {
          ack({ ok: false, error: "비밀번호가 올바르지 않습니다." });
          return;
        }
        if (!geminiConfigured()) {
          ack({
            ok: false,
            error:
              "AI 요약이 설정되지 않았습니다. 서버에 WAB_GEMINI_API_KEY 환경변수를 설정하세요.",
          });
          return;
        }
        if (!wa) {
          ack({ ok: false, error: "서버가 아직 준비되지 않았습니다." });
          return;
        }
        const result = await summarizeChat(wa, jid, from, to);
        ack(result);
      } catch (err) {
        console.error("summarize-chat failed", err);
        ack({ ok: false, error: `요약 실패: ${(err as Error)?.message ?? String(err)}` });
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
