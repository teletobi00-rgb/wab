import fs from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import qrcode from "qrcode";
import type { Server as SocketIOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "../socket/events";
import type {
  ChatInfo,
  MessageItem,
  MessageStatus,
  MessageType,
  PresenceState,
  QuotedInfo,
  Status,
} from "./types";
// Baileys is ESM-only; load it dynamically inside initWhatsApp so CJS output
// (Electron production build) can interop with it.
import type {
  WAMessage,
  WAMessageContent,
  WASocket,
} from "@whiskeysockets/baileys";

const logger = pino({ level: "warn" });

function resolveAuthDir(): string {
  return process.env.WAB_AUTH_DIR ?? path.join(process.cwd(), "auth_info_baileys");
}

function resolveMediaDir(): string {
  return process.env.WAB_MEDIA_DIR ?? path.join(process.cwd(), "media_cache");
}

type IO = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

type MediaCacheEntry = {
  filePath: string;
  mimeType: string;
  fileName?: string;
};

function unwrap(msg: WAMessageContent | null | undefined): WAMessageContent | null {
  if (!msg) return null;
  if (msg.ephemeralMessage?.message) return unwrap(msg.ephemeralMessage.message);
  if (msg.viewOnceMessage?.message) return unwrap(msg.viewOnceMessage.message);
  if (msg.viewOnceMessageV2?.message) return unwrap(msg.viewOnceMessageV2.message);
  if (msg.viewOnceMessageV2Extension?.message)
    return unwrap(msg.viewOnceMessageV2Extension.message);
  if (msg.editedMessage?.message) return unwrap(msg.editedMessage.message);
  if (msg.documentWithCaptionMessage?.message)
    return unwrap(msg.documentWithCaptionMessage.message);
  return msg;
}

function previewFromContent(
  content: WAMessageContent | null | undefined,
): { text: string; type: MessageType; skip: boolean } {
  const msg = unwrap(content);
  if (!msg) return { text: "", type: "system", skip: true };

  if (msg.protocolMessage || msg.senderKeyDistributionMessage) {
    return { text: "", type: "system", skip: true };
  }

  const keys = Object.keys(msg).filter((k) => msg[k as keyof WAMessageContent] != null);
  if (keys.length === 1 && keys[0] === "messageContextInfo") {
    return { text: "", type: "system", skip: true };
  }

  if (msg.conversation) return { text: msg.conversation, type: "text", skip: false };
  if (msg.extendedTextMessage?.text)
    return { text: msg.extendedTextMessage.text, type: "text", skip: false };
  if (msg.imageMessage)
    return { text: msg.imageMessage.caption ?? "", type: "image", skip: false };
  if (msg.videoMessage)
    return { text: msg.videoMessage.caption ?? "", type: "video", skip: false };
  if (msg.audioMessage)
    return { text: "", type: msg.audioMessage.ptt ? "voice" : "audio", skip: false };
  if (msg.documentMessage)
    return { text: msg.documentMessage.fileName ?? "문서", type: "document", skip: false };
  if (msg.stickerMessage) return { text: "", type: "sticker", skip: false };
  if (msg.contactMessage)
    return { text: msg.contactMessage.displayName ?? "연락처", type: "contact", skip: false };
  if (msg.contactsArrayMessage) {
    const n = msg.contactsArrayMessage.contacts?.length ?? 0;
    return { text: `연락처 ${n}개`, type: "contact", skip: false };
  }
  if (msg.locationMessage || msg.liveLocationMessage)
    return { text: "위치", type: "location", skip: false };
  const poll = msg.pollCreationMessage ?? msg.pollCreationMessageV2 ?? msg.pollCreationMessageV3;
  if (poll) return { text: poll.name ?? "투표", type: "poll", skip: false };
  if (msg.reactionMessage || msg.pollUpdateMessage)
    return { text: "", type: "system", skip: true };

  return { text: "", type: "other", skip: false };
}

function extractContextInfo(content: WAMessageContent | null | undefined) {
  const msg = unwrap(content);
  if (!msg) return undefined;
  return (
    msg.extendedTextMessage?.contextInfo ??
    msg.imageMessage?.contextInfo ??
    msg.videoMessage?.contextInfo ??
    msg.audioMessage?.contextInfo ??
    msg.documentMessage?.contextInfo ??
    msg.stickerMessage?.contextInfo ??
    msg.contactMessage?.contextInfo ??
    undefined
  );
}

function hasMedia(content: WAMessageContent | null | undefined): boolean {
  const msg = unwrap(content);
  if (!msg) return false;
  return !!(
    msg.imageMessage ||
    msg.videoMessage ||
    msg.audioMessage ||
    msg.documentMessage ||
    msg.stickerMessage
  );
}

function getMediaMeta(
  content: WAMessageContent | null | undefined,
): { mimeType: string; fileName?: string } | null {
  const msg = unwrap(content);
  if (!msg) return null;
  if (msg.imageMessage) return { mimeType: msg.imageMessage.mimetype ?? "image/jpeg" };
  if (msg.videoMessage) return { mimeType: msg.videoMessage.mimetype ?? "video/mp4" };
  if (msg.audioMessage) return { mimeType: msg.audioMessage.mimetype ?? "audio/ogg" };
  if (msg.documentMessage) {
    return {
      mimeType: msg.documentMessage.mimetype ?? "application/octet-stream",
      fileName: msg.documentMessage.fileName ?? undefined,
    };
  }
  if (msg.stickerMessage) return { mimeType: msg.stickerMessage.mimetype ?? "image/webp" };
  return null;
}

function mapStatus(s: number | null | undefined): MessageStatus | undefined {
  if (s == null) return undefined;
  switch (s) {
    case 1:
      return "pending";
    case 2:
      return "sent";
    case 3:
      return "delivered";
    case 4:
    case 5:
      return "read";
    default:
      return undefined;
  }
}

function formatJid(jid: string): string {
  const num = jid.split("@")[0] ?? jid;
  if (num.startsWith("82") && num.length === 12) {
    const local = `0${num.slice(2)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 7)}-${local.slice(7)}`;
  }
  if (num.startsWith("82") && num.length === 11) {
    const local = `0${num.slice(2)}`;
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  return num;
}

// Bypass TypeScript's CommonJS transformation of dynamic import() so that the
// ESM-only baileys package can be loaded in the Electron production CJS build.
type BaileysModule = typeof import("@whiskeysockets/baileys");
const importBaileys = new Function(
  "return import('@whiskeysockets/baileys')",
) as () => Promise<BaileysModule>;

export async function initWhatsApp(io: IO) {
  const {
    default: makeWASocket,
    Browsers,
    DisconnectReason,
    downloadMediaMessage,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
  } = await importBaileys();

  const AUTH_DIR = resolveAuthDir();
  const MEDIA_DIR = resolveMediaDir();

  let sock: WASocket | null = null;
  let currentQr: string | null = null;
  let status: Status = { state: "disconnected" };
  const chats = new Map<string, ChatInfo>();
  const messages = new Map<string, MessageItem[]>();
  const rawMessages = new Map<string, WAMessage>();
  const contactNames = new Map<string, string>();
  const groupSubjects = new Map<string, string>();
  const mediaCache = new Map<string, MediaCacheEntry>();
  // Maps @lid JIDs to their canonical @s.whatsapp.net counterpart so all
  // messages for a contact end up under the same chat regardless of which
  // JID form WhatsApp uses on a given event.
  const lidToPhone = new Map<string, string>();
  let restarting = false;

  function recordLid(contact: { id?: string | null; lid?: string | null } | undefined | null) {
    if (!contact?.id || !contact.lid) return;
    if (contact.id.endsWith("@s.whatsapp.net") && contact.lid.endsWith("@lid")) {
      lidToPhone.set(contact.lid, contact.id);
    }
  }

  function canonicalJid(jid: string | null | undefined): string {
    if (!jid) return jid ?? "";
    if (jid.endsWith("@lid")) {
      return lidToPhone.get(jid) ?? jid;
    }
    return jid;
  }

  await fs.mkdir(AUTH_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await rehydrateMediaCache();

  async function rehydrateMediaCache() {
    try {
      const files = await fs.readdir(MEDIA_DIR);
      for (const file of files) {
        if (file.endsWith(".json")) continue;
        try {
          const meta = JSON.parse(
            await fs.readFile(path.join(MEDIA_DIR, `${file}.json`), "utf-8"),
          );
          mediaCache.set(file, {
            filePath: path.join(MEDIA_DIR, file),
            mimeType: meta.mimeType,
            fileName: meta.fileName,
          });
        } catch {
          // Missing or invalid sidecar — skip
        }
      }
    } catch {
      // Directory empty or missing — fine
    }
  }

  function getDisplayName(jid: string): string {
    const c = contactNames.get(jid);
    if (c) return c;
    if (jid.endsWith("@g.us")) return groupSubjects.get(jid) ?? "그룹";
    return formatJid(jid);
  }

  function applyContact(id: string | null | undefined, name: string | null | undefined) {
    if (!id || !name) return;
    contactNames.set(id, name);
    const chat = chats.get(id);
    if (chat && chat.name === formatJid(id)) {
      const updated: ChatInfo = { ...chat, name };
      chats.set(id, updated);
      io.emit("chat-update", updated);
    }
  }

  function applyGroupName(id: string, name: string | null | undefined) {
    if (!id || !name) return;
    groupSubjects.set(id, name);
    const chat = chats.get(id);
    if (chat && (chat.name === "그룹" || chat.name === "Group")) {
      const updated: ChatInfo = { ...chat, name };
      chats.set(id, updated);
      io.emit("chat-update", updated);
    }
  }

  async function ensureGroupName(jid: string) {
    if (!jid.endsWith("@g.us")) return;
    if (groupSubjects.has(jid)) return;
    if (!sock) return;
    try {
      const meta = await sock.groupMetadata(jid);
      if (meta.subject) applyGroupName(jid, meta.subject);
    } catch (err) {
      console.error("groupMetadata failed", jid, err);
    }
  }

  function resolvePushName(jid: string): string | undefined {
    return contactNames.get(jid);
  }

  function extractQuoted(m: WAMessage): QuotedInfo | undefined {
    const ctx = extractContextInfo(m.message);
    if (!ctx?.stanzaId || !ctx.quotedMessage) return undefined;
    const preview = previewFromContent(ctx.quotedMessage);
    const participant = ctx.participant ?? undefined;
    const meId = sock?.user?.id;
    const fromMe = !!(participant && meId && jidsEqual(participant, meId));
    return {
      stanzaId: ctx.stanzaId,
      fromMe,
      participantJid: participant,
      pushName: participant ? resolvePushName(participant) : undefined,
      text: preview.text,
      type: preview.type,
    };
  }

  function upsertChat(c: Partial<ChatInfo> & { jid: string }) {
    const existing = chats.get(c.jid);
    const merged: ChatInfo = {
      jid: c.jid,
      name: c.name ?? existing?.name ?? getDisplayName(c.jid),
      isGroup: c.jid.endsWith("@g.us"),
      lastMessage: c.lastMessage ?? existing?.lastMessage,
      lastMessageTime: c.lastMessageTime ?? existing?.lastMessageTime,
      unreadCount: c.unreadCount ?? existing?.unreadCount ?? 0,
    };
    chats.set(c.jid, merged);
    return merged;
  }

  function previewFor(item: MessageItem): string {
    if (item.text) return item.text;
    switch (item.type) {
      case "image":
        return "📷 사진";
      case "video":
        return "🎥 영상";
      case "audio":
        return "🎵 오디오";
      case "voice":
        return "🎤 음성 메시지";
      case "document":
        return "📄 문서";
      case "sticker":
        return "스티커";
      case "contact":
        return "👤 연락처";
      case "location":
        return "📍 위치";
      case "poll":
        return "📊 투표";
      default:
        return "";
    }
  }

  function toMessageItem(m: WAMessage): { item: MessageItem | null; skip: boolean } {
    if (!m.key.id || !m.key.remoteJid) return { item: null, skip: true };
    const { text, type, skip } = previewFromContent(m.message);
    if (skip) return { item: null, skip: true };
    const tsRaw = m.messageTimestamp;
    const timestamp =
      typeof tsRaw === "number" ? tsRaw : tsRaw ? Number(tsRaw) : Math.floor(Date.now() / 1000);
    // Baileys 7.x exposes the phone-number JID alongside the @lid form via
    // remoteJidAlt / participantAlt. Learn the mapping from the message keys
    // so every chat lands under the phone-number JID regardless of which form
    // a particular event uses.
    const key = m.key as typeof m.key & {
      remoteJidAlt?: string | null;
      participantAlt?: string | null;
    };
    if (
      key.remoteJid?.endsWith("@lid") &&
      key.remoteJidAlt?.endsWith("@s.whatsapp.net")
    ) {
      lidToPhone.set(key.remoteJid, key.remoteJidAlt);
    }
    if (key.participant?.endsWith("@lid") && key.participantAlt?.endsWith("@s.whatsapp.net")) {
      lidToPhone.set(key.participant, key.participantAlt);
    }
    const item: MessageItem = {
      id: m.key.id,
      jid: m.key.remoteJid,
      fromMe: !!m.key.fromMe,
      text,
      type,
      timestamp,
      pushName: m.pushName ?? undefined,
      participantJid: m.key.participant ?? undefined,
      status: mapStatus(m.status),
      quoted: extractQuoted(m),
    };
    return { item, skip: false };
  }

  async function downloadMedia(m: WAMessage): Promise<MediaCacheEntry | null> {
    if (!m.key.id || !m.message) return null;
    const meta = getMediaMeta(m.message);
    if (!meta || !sock) return null;
    try {
      const buffer = await downloadMediaMessage(m, "buffer", {}, {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      });
      const filePath = path.join(MEDIA_DIR, m.key.id);
      await fs.writeFile(filePath, buffer);
      await fs.writeFile(`${filePath}.json`, JSON.stringify(meta));
      const entry: MediaCacheEntry = {
        filePath,
        mimeType: meta.mimeType,
        fileName: meta.fileName,
      };
      mediaCache.set(m.key.id, entry);
      return entry;
    } catch (err) {
      console.error("downloadMedia failed", m.key.id, err);
      return null;
    }
  }

  function attachMediaIfCached(item: MessageItem) {
    const cached = mediaCache.get(item.id);
    if (!cached) return;
    item.media = {
      url: `/media/${item.id}`,
      mimeType: cached.mimeType,
      fileName: cached.fileName,
    };
  }

  function upsertMessage(m: WAMessage, broadcast: boolean) {
    const { item, skip } = toMessageItem(m);
    if (!item || skip) return;
    // Merge LID JIDs into their phone-number JID counterparts so we don't
    // create duplicate chats when WhatsApp uses both forms for the same person.
    item.jid = canonicalJid(item.jid);
    if (item.participantJid) {
      item.participantJid = canonicalJid(item.participantJid);
    }

    if (m.key.id) rawMessages.set(m.key.id, m);

    if (!item.fromMe && item.pushName) {
      const senderJid = item.participantJid ?? item.jid;
      if (!senderJid.endsWith("@g.us") && !contactNames.has(senderJid)) {
        applyContact(senderJid, item.pushName);
      }
    }

    if (item.quoted?.participantJid && !item.quoted.pushName) {
      item.quoted.pushName = resolvePushName(item.quoted.participantJid);
    }

    attachMediaIfCached(item);
    const wasCached = !!item.media;
    const needsDownload = !wasCached && hasMedia(m.message);

    const list = messages.get(item.jid) ?? [];
    const existingIdx = list.findIndex((x) => x.id === item.id);
    if (existingIdx >= 0) {
      const merged = { ...list[existingIdx], ...item };
      list[existingIdx] = merged;
      messages.set(item.jid, list);
      if (broadcast) {
        io.emit("message-upsert", { jid: item.jid, message: merged });
      }
      if (needsDownload) scheduleMediaDownload(m, item.jid);
      return;
    }
    list.push(item);
    list.sort((a, b) => a.timestamp - b.timestamp);
    messages.set(item.jid, list);

    const preview = previewFor(item);
    const updated = upsertChat({
      jid: item.jid,
      lastMessage: preview,
      lastMessageTime: item.timestamp,
    });

    if (broadcast) {
      io.emit("message-upsert", { jid: item.jid, message: item });
      io.emit("chat-update", updated);
    }

    if (item.jid.endsWith("@g.us")) {
      ensureGroupName(item.jid).catch(() => {});
    }

    if (needsDownload) scheduleMediaDownload(m, item.jid);
  }

  function scheduleMediaDownload(m: WAMessage, jid: string) {
    downloadMedia(m).then((entry) => {
      if (!entry || !m.key.id) return;
      const list = messages.get(jid);
      if (!list) return;
      const idx = list.findIndex((x) => x.id === m.key.id);
      if (idx < 0) return;
      const merged = {
        ...list[idx],
        media: {
          url: `/media/${m.key.id}`,
          mimeType: entry.mimeType,
          fileName: entry.fileName,
        },
      };
      list[idx] = merged;
      io.emit("message-upsert", { jid, message: merged });
    });
  }

  async function start() {
    if (restarting) return;
    restarting = true;
    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: Browsers.macOS("Desktop"),
        // History sync disabled — only live messages from connection time onwards.
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: false,
        // When a recipient fails to decrypt a message we sent, WhatsApp asks us
        // to resend via a retry receipt. Baileys calls this callback to fetch
        // the original content from our local cache.
        getMessage: async (key) => {
          if (!key.id) return undefined;
          const cached = rawMessages.get(key.id);
          return cached?.message ?? undefined;
        },
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            currentQr = await qrcode.toDataURL(qr, { width: 280, margin: 1 });
            status = { state: "connecting" };
            io.emit("qr", { qr: currentQr });
            io.emit("status", status);
          } catch (err) {
            console.error("qr encoding failed", err);
          }
        }

        if (connection === "close") {
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
            ?.output?.statusCode;
          const isLoggedOut = code === DisconnectReason.loggedOut;
          status = { state: "disconnected" };
          currentQr = null;
          io.emit("status", status);
          sock = null;
          restarting = false;
          if (isLoggedOut) {
            console.log("Device logged out (code 401) - wiping auth and restarting for fresh QR");
            chats.clear();
            messages.clear();
            rawMessages.clear();
            contactNames.clear();
            groupSubjects.clear();
            lidToPhone.clear();
            try {
              await fs.rm(AUTH_DIR, { recursive: true, force: true });
              await fs.mkdir(AUTH_DIR, { recursive: true });
            } catch (err) {
              console.error("auth wipe failed", err);
            }
            setTimeout(() => {
              start().catch((e) => console.error("restart after logout failed", e));
            }, 1000);
          } else {
            setTimeout(() => {
              start().catch((e) => console.error("restart failed", e));
            }, 2000);
          }
        }

        if (connection === "open") {
          const me = sock?.user;
          status = {
            state: "connected",
            me: me ? { id: me.id, name: me.name ?? me.verifiedName ?? "Me" } : undefined,
          };
          currentQr = null;
          io.emit("status", status);
          io.emit("chats", Array.from(chats.values()));
          // Replenish our prekey bundle on the server so peers can establish
          // new sessions with us — running out of these causes the "Invalid
          // PreKey ID" decryption failures we keep seeing.
          sock?.uploadPreKeysToServerIfRequired().catch((err) => {
            console.error("uploadPreKeysToServerIfRequired failed", err);
          });
        }
      });

      // History sync is intentionally disabled (see makeWASocket options above).
      // We still listen here only to capture contact metadata (LID mapping, names)
      // — chat list and old messages are dropped so the UI starts empty.
      sock.ev.on("messaging-history.set", ({ contacts }) => {
        for (const c of contacts) {
          recordLid(c as { id?: string | null; lid?: string | null });
          applyContact(c.id, c.name ?? c.notify ?? c.verifiedName ?? null);
        }
      });

      sock.ev.on("contacts.upsert", (contacts) => {
        for (const c of contacts) {
          recordLid(c as { id?: string | null; lid?: string | null });
          applyContact(c.id, c.name ?? c.notify ?? c.verifiedName ?? null);
        }
      });

      sock.ev.on("contacts.update", (updates) => {
        for (const c of updates) {
          recordLid(c as { id?: string | null; lid?: string | null });
          applyContact(c.id, c.name ?? c.notify ?? c.verifiedName ?? null);
        }
      });

      sock.ev.on("chats.upsert", (newChats) => {
        for (const c of newChats) {
          if (!c.id) continue;
          if (c.id.endsWith("@g.us") && c.name) applyGroupName(c.id, c.name);
          upsertChat({
            jid: c.id,
            name: c.name ?? contactNames.get(c.id) ?? undefined,
            unreadCount: c.unreadCount ?? 0,
          });
          if (c.id.endsWith("@g.us") && !groupSubjects.has(c.id)) {
            ensureGroupName(c.id).catch(() => {});
          }
        }
        io.emit("chats", Array.from(chats.values()));
      });

      sock.ev.on("chats.update", (updates) => {
        for (const c of updates) {
          if (!c.id) continue;
          if (c.id.endsWith("@g.us") && c.name) applyGroupName(c.id, c.name);
          upsertChat({
            jid: c.id,
            name: c.name ?? undefined,
            unreadCount: c.unreadCount ?? undefined,
          });
        }
      });

      sock.ev.on("messages.upsert", ({ messages: msgs }) => {
        for (const m of msgs) {
          upsertMessage(m, true);
        }
      });

      sock.ev.on("messages.update", (updates) => {
        for (const u of updates) {
          if (!u.key.id || !u.key.remoteJid) continue;
          const list = messages.get(u.key.remoteJid);
          if (!list) continue;
          const idx = list.findIndex((x) => x.id === u.key.id);
          if (idx < 0) continue;
          const newStatus = mapStatus(u.update.status);
          if (newStatus) {
            const merged = { ...list[idx], status: newStatus };
            list[idx] = merged;
            io.emit("message-status", {
              id: u.key.id,
              jid: u.key.remoteJid,
              status: newStatus,
            });
          }
        }
      });

      sock.ev.on("presence.update", ({ id, presences }) => {
        if (!id) return;
        for (const [participantJid, p] of Object.entries(presences)) {
          if (!p?.lastKnownPresence) continue;
          io.emit("presence", {
            jid: id,
            participantJid: participantJid !== id ? participantJid : undefined,
            state: p.lastKnownPresence as PresenceState,
          });
        }
      });

      sock.ev.on("groups.update", (updates) => {
        for (const g of updates) {
          if (g.id && g.subject) applyGroupName(g.id, g.subject);
        }
      });

      sock.ev.on("groups.upsert", (groups) => {
        for (const g of groups) {
          if (g.id && g.subject) applyGroupName(g.id, g.subject);
        }
      });

      restarting = false;
    } catch (err) {
      restarting = false;
      throw err;
    }
  }

  await start();

  return {
    getStatus: () => status,
    getQr: () => currentQr,
    getChats: () => Array.from(chats.values()),
    loadMessages: (jid: string, limit = 50) => {
      const list = messages.get(jid) ?? [];
      return list.slice(-limit);
    },
    sendMessage: async (jid: string, text: string, replyToId?: string) => {
      if (!sock || status.state !== "connected") throw new Error("Not connected");
      const quoted = replyToId ? rawMessages.get(replyToId) : undefined;
      await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
    },
    sendMedia: async (
      jid: string,
      fileName: string,
      mimeType: string,
      buffer: Buffer,
      caption?: string,
      replyToId?: string,
    ) => {
      if (!sock || status.state !== "connected") throw new Error("Not connected");
      const opts = replyToId ? { quoted: rawMessages.get(replyToId) } : undefined;
      const quotedOpts = opts?.quoted ? { quoted: opts.quoted } : undefined;
      if (mimeType.startsWith("image/")) {
        await sock.sendMessage(jid, { image: buffer, caption, mimetype: mimeType }, quotedOpts);
      } else if (mimeType.startsWith("video/")) {
        await sock.sendMessage(jid, { video: buffer, caption, mimetype: mimeType }, quotedOpts);
      } else if (mimeType.startsWith("audio/")) {
        await sock.sendMessage(jid, { audio: buffer, mimetype: mimeType }, quotedOpts);
      } else {
        await sock.sendMessage(
          jid,
          { document: buffer, mimetype: mimeType, fileName, caption },
          quotedOpts,
        );
      }
    },
    getMediaEntry: (id: string) => mediaCache.get(id),
    markRead: async (jid: string) => {
      if (!sock || status.state !== "connected") return;
      const list = messages.get(jid);
      if (!list || list.length === 0) return;
      const unread = list.filter((m) => !m.fromMe && m.status !== "read");
      if (unread.length === 0) return;
      try {
        await sock.readMessages(
          unread.map((m) => ({
            id: m.id,
            remoteJid: jid,
            participant: m.participantJid,
            fromMe: false,
          })),
        );
        const chat = chats.get(jid);
        if (chat && chat.unreadCount > 0) {
          const updated: ChatInfo = { ...chat, unreadCount: 0 };
          chats.set(jid, updated);
          io.emit("chat-update", updated);
        }
      } catch (err) {
        console.error("markRead failed", err);
      }
    },
    sendTyping: async (jid: string, isTyping: boolean) => {
      if (!sock || status.state !== "connected") return;
      try {
        await sock.sendPresenceUpdate(isTyping ? "composing" : "paused", jid);
      } catch (err) {
        console.error("sendTyping failed", err);
      }
    },
    subscribePresence: async (jid: string) => {
      if (!sock || status.state !== "connected") return;
      try {
        await sock.presenceSubscribe(jid);
      } catch (err) {
        console.error("presenceSubscribe failed", err);
      }
    },
    logout: async () => {
      try {
        if (sock) await sock.logout();
      } catch (err) {
        console.error("logout error", err);
      }
      sock = null;
      chats.clear();
      messages.clear();
      rawMessages.clear();
      contactNames.clear();
      groupSubjects.clear();
      mediaCache.clear();
      lidToPhone.clear();
      await fs.rm(AUTH_DIR, { recursive: true, force: true });
      await fs.rm(MEDIA_DIR, { recursive: true, force: true });
      await fs.mkdir(AUTH_DIR, { recursive: true });
      await fs.mkdir(MEDIA_DIR, { recursive: true });
      status = { state: "disconnected" };
      io.emit("status", status);
      setTimeout(() => {
        start().catch((e) => console.error("restart after logout failed", e));
      }, 500);
    },
  };
}

function jidsEqual(a: string, b: string): boolean {
  const norm = (j: string) => j.split(/[:@]/)[0] ?? j;
  return norm(a) === norm(b);
}

export type WhatsAppClient = Awaited<ReturnType<typeof initWhatsApp>>;
