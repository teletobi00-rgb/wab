import fs from "node:fs/promises";
import path from "node:path";
// Baileys is ESM-only; load it dynamically inside initWhatsApp so CJS output
// (Electron production build) can interop with it.
import type { WAMessage, WAMessageContent, WASocket } from "@whiskeysockets/baileys";
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

function buildLogger() {
  const level = process.env.WAB_LOG_LEVEL ?? "warn";
  const logFile = process.env.WAB_LOG_FILE;
  if (!logFile) return pino({ level });
  try {
    const fsSync = require("node:fs") as typeof import("node:fs");
    fsSync.mkdirSync(path.dirname(logFile), { recursive: true });
    return pino({ level }, pino.destination({ dest: logFile, sync: false, mkdir: true }));
  } catch (err) {
    console.error("log file setup failed, falling back to stdout", err);
    return pino({ level });
  }
}
const logger = buildLogger();

function resolveAuthDir(): string {
  return process.env.WAB_AUTH_DIR ?? path.join(process.cwd(), "auth_info_baileys");
}

function resolveMediaDir(): string {
  return process.env.WAB_MEDIA_DIR ?? path.join(process.cwd(), "media_cache");
}

function resolveAliasFile(): string {
  return process.env.WAB_ALIAS_FILE ?? path.join(process.cwd(), "aliases.json");
}

type IO = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

type MediaCacheEntry = {
  filePath: string;
  mimeType: string;
  fileName?: string;
  size: number;
};

// Caps for in-memory growth — this is a long-running tray app, so unbounded
// Maps/arrays would leak over days of uptime.
const RAW_MESSAGE_CAP = 1000; // originals kept only for retry-receipt resends
const MESSAGES_PER_CHAT_CAP = 500; // rendered history per conversation
// Disk + in-memory cap for the media cache, enforced on boot AND at runtime.
const MEDIA_CACHE_MAX_BYTES = 500 * 1024 * 1024; // 500 MB
// Messages older than this relative to the connection time are treated as
// history-sync replay and hidden from the UI. Offline-delivered messages
// (type "append") that arrived while we were briefly disconnected are newer
// than this and stay visible — losing those was the whole bug.
const HISTORY_CUTOFF_SECONDS = 24 * 60 * 60; // 1 day

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
  // Newer wrappers that may not be in the static Baileys types yet but show
  // up on the wire — peel them off so the inner media still renders.
  const wrappers: Array<keyof WAMessageContent> = [
    "deviceSentMessage" as keyof WAMessageContent,
    "messageHistoryBundle" as keyof WAMessageContent,
  ];
  for (const key of wrappers) {
    const w = (msg as Record<string, unknown>)[key as string] as
      | { message?: WAMessageContent }
      | undefined;
    if (w?.message) return unwrap(w.message);
  }
  return msg;
}

function previewFromContent(content: WAMessageContent | null | undefined): {
  text: string;
  type: MessageType;
  skip: boolean;
} {
  const msg = unwrap(content);
  if (!msg) return { text: "", type: "system", skip: true };

  // Reactions / poll updates are decorations on other messages, not standalone.
  if (msg.reactionMessage || msg.pollUpdateMessage) {
    return { text: "", type: "system", skip: true };
  }

  // IMPORTANT: check actual content BEFORE skipping for protocol/keydist envelopes.
  // Group messages routinely arrive with senderKeyDistributionMessage attached
  // alongside real content (extendedTextMessage, imageMessage, …) — skipping on
  // sight there silently drops every "first-message-after-key-rotation" in a group.
  if (msg.conversation) return { text: msg.conversation, type: "text", skip: false };
  if (msg.extendedTextMessage?.text)
    return { text: msg.extendedTextMessage.text, type: "text", skip: false };
  if (msg.imageMessage) return { text: msg.imageMessage.caption ?? "", type: "image", skip: false };
  if (msg.videoMessage) return { text: msg.videoMessage.caption ?? "", type: "video", skip: false };
  if (msg.audioMessage)
    return { text: "", type: msg.audioMessage.ptt ? "voice" : "audio", skip: false };
  if (msg.documentMessage) {
    // Document messages can carry a caption alongside the file. Surface the
    // caption as the bubble's text so it renders below the file badge; the
    // file name is kept separately on media.fileName.
    const caption = msg.documentMessage.caption ?? "";
    const fileName = msg.documentMessage.fileName ?? "";
    return { text: caption || fileName || "문서", type: "document", skip: false };
  }
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

  // No user-visible content matched — must be protocol / album linker /
  // unknown wrapper / messageContextInfo-only / etc. Skip silently rather
  // than render an empty "(빈 메시지)" bubble. The cost is that genuinely
  // new WhatsApp message types we haven't added support for would also be
  // hidden, which is the right trade for cleanliness here.
  return { text: "", type: "system", skip: true };
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
  // User-assigned display names (overrides), persisted to disk so they survive
  // re-login / restart. jid → custom name.
  const aliases = new Map<string, string>();
  const ALIAS_FILE = resolveAliasFile();
  // jid → profile picture URL (null = fetched but none / failed, don't retry).
  const avatarCache = new Map<string, string | null>();
  const mediaCache = new Map<string, MediaCacheEntry>();
  // Running total of bytes held in mediaCache, so we can evict at runtime
  // instead of only on boot.
  let mediaTotalBytes = 0;
  // Maps a sent message's real id → the client's optimistic tempId, so the
  // echo broadcast can carry the tempId back and the UI replaces the exact
  // placeholder (instead of fuzzy text+timestamp matching).
  const pendingTempIds = new Map<string, string>();
  // Scheduled (future-send) messages, in memory while the app runs.
  type ScheduledEntry = {
    id: string;
    jid: string;
    text: string;
    sendAt: number;
    timer: ReturnType<typeof setTimeout>;
  };
  const scheduled = new Map<string, ScheduledEntry>();
  let scheduleCounter = 0;
  // Maps @lid JIDs to their canonical @s.whatsapp.net counterpart so all
  // messages for a contact end up under the same chat regardless of which
  // JID form WhatsApp uses on a given event.
  const lidToPhone = new Map<string, string>();
  let restarting = false;
  // Pending reconnect timer + socket generation, so overlapping reconnects
  // can't spawn duplicate live sockets and stale events get ignored.
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let activeGen = 0;
  // Unix seconds. Set on connection.open. Messages older than this are treated
  // as history and not surfaced in the UI even though Baileys still processes
  // them internally (so LID mappings and session state stay current).
  let connectedAt = 0;

  function recordLid(contact: { id?: string | null; lid?: string | null } | undefined | null) {
    if (!contact?.id || !contact.lid) return;
    if (contact.id.endsWith("@s.whatsapp.net") && contact.lid.endsWith("@lid")) {
      lidToPhone.set(contact.lid, contact.id);
    }
  }

  function consumeTempId(id: string): string | undefined {
    const t = pendingTempIds.get(id);
    if (t) pendingTempIds.delete(id);
    return t;
  }

  function canonicalJid(jid: string | null | undefined): string {
    if (!jid) return jid ?? "";
    if (jid.endsWith("@lid")) {
      return lidToPhone.get(jid) ?? jid;
    }
    return jid;
  }

  // Strip the device suffix (e.g. "123:5@s.whatsapp.net" → "123@s.whatsapp.net")
  // then canonicalize @lid → phone, so the same person is one identity. Without
  // this, reactions from different devices doubled up.
  function normalizeSender(jid: string | null | undefined): string {
    if (!jid) return "";
    return canonicalJid(jid.replace(/:\d+(?=@)/, ""));
  }

  await fs.mkdir(AUTH_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await rehydrateMediaCache();
  await loadAliases();

  async function loadAliases() {
    try {
      const raw = await fs.readFile(ALIAS_FILE, "utf-8");
      const obj = JSON.parse(raw);
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string" && v) aliases.set(k, v);
      }
    } catch {
      // no alias file yet — fine
    }
  }

  async function saveAliases() {
    try {
      await fs.writeFile(ALIAS_FILE, JSON.stringify(Object.fromEntries(aliases)));
    } catch (err) {
      console.error("saveAliases failed", err);
    }
  }

  async function rehydrateMediaCache() {
    try {
      const files = await fs.readdir(MEDIA_DIR);
      // Collect entries with size + mtime, then populate the Map in mtime
      // order so the Map's iteration order is oldest-first — runtime eviction
      // relies on that (keys().next() === oldest).
      const entries: { id: string; size: number; mtimeMs: number; meta: MediaCacheEntry }[] = [];
      for (const file of files) {
        if (file.endsWith(".json")) continue;
        const full = path.join(MEDIA_DIR, file);
        try {
          const meta = JSON.parse(await fs.readFile(`${full}.json`, "utf-8"));
          const stat = await fs.stat(full);
          entries.push({
            id: file,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            meta: {
              filePath: full,
              mimeType: meta.mimeType,
              fileName: meta.fileName,
              size: stat.size,
            },
          });
        } catch {
          // Missing or invalid sidecar — skip
        }
      }
      entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
      mediaTotalBytes = 0;
      for (const e of entries) {
        mediaCache.set(e.id, e.meta);
        mediaTotalBytes += e.size;
      }
      await enforceMediaCap();
    } catch {
      // Directory empty or missing — fine
    }
  }

  async function removeMediaEntry(id: string) {
    const e = mediaCache.get(id);
    if (!e) return;
    mediaCache.delete(id);
    mediaTotalBytes = Math.max(0, mediaTotalBytes - e.size);
    try {
      await fs.rm(e.filePath, { force: true });
      await fs.rm(`${e.filePath}.json`, { force: true });
    } catch (err) {
      console.error("media evict failed for", id, err);
    }
  }

  // Evict oldest cached media until under the cap. Runs after every download
  // and on boot, so a long session can't grow the cache without bound.
  async function enforceMediaCap() {
    while (mediaTotalBytes > MEDIA_CACHE_MAX_BYTES && mediaCache.size > 0) {
      const oldest = mediaCache.keys().next().value;
      if (oldest === undefined) break;
      await removeMediaEntry(oldest);
    }
  }

  function getDisplayName(jid: string): string {
    // User-assigned alias always wins.
    const alias = aliases.get(jid);
    if (alias) return alias;
    const c = contactNames.get(jid);
    if (c) return c;
    if (jid.endsWith("@g.us")) return groupSubjects.get(jid) ?? "그룹";
    return formatJid(jid);
  }

  function setAlias(jid: string, name: string) {
    const v = (name ?? "").trim();
    if (v) aliases.set(jid, v);
    else aliases.delete(jid);
    saveAliases().catch(() => {});
    const chat = chats.get(jid);
    if (chat) {
      const updated: ChatInfo = { ...chat, name: getDisplayName(jid) };
      chats.set(jid, updated);
      io.emit("chat-update", updated);
    }
  }

  function applyContact(id: string | null | undefined, name: string | null | undefined) {
    if (!id || !name) return;
    contactNames.set(id, name);
    // Reflect the resolved name (alias wins over contact name) onto the chat.
    const chat = chats.get(id);
    const resolved = getDisplayName(id);
    if (chat && chat.name !== resolved) {
      const updated: ChatInfo = { ...chat, name: resolved };
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

  // Fetch a chat's profile picture once (cached). The URL is a WhatsApp CDN
  // link the renderer loads directly; if it's unreachable the UI falls back to
  // the initials avatar.
  async function ensureAvatar(jid: string) {
    if (avatarCache.has(jid)) return;
    if (!sock || status.state !== "connected") return;
    avatarCache.set(jid, null); // mark in-flight so we don't refetch
    try {
      // Try full image, then the smaller preview (more permissive under some
      // privacy settings). Either returns undefined when there's no picture.
      let url = await sock.profilePictureUrl(jid, "image").catch((e) => {
        logger.warn({ jid, err: String(e) }, "profilePictureUrl image failed");
        return undefined;
      });
      if (!url) {
        url = await sock.profilePictureUrl(jid, "preview").catch(() => undefined);
      }
      if (url) {
        avatarCache.set(jid, url);
        const chat = chats.get(jid);
        if (chat) {
          const updated: ChatInfo = { ...chat, avatarUrl: url };
          chats.set(jid, updated);
          io.emit("chat-update", updated);
        }
      } else {
        logger.warn({ jid }, "no profile picture available");
      }
    } catch {
      avatarCache.set(jid, null);
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
      lastMessageFromMe: c.lastMessageFromMe ?? existing?.lastMessageFromMe,
      lastMessageStatus: c.lastMessageStatus ?? existing?.lastMessageStatus,
      lastMessageId: c.lastMessageId ?? existing?.lastMessageId,
      unreadCount: c.unreadCount ?? existing?.unreadCount ?? 0,
      avatarUrl: c.avatarUrl ?? existing?.avatarUrl ?? avatarCache.get(c.jid) ?? undefined,
    };
    chats.set(c.jid, merged);
    return merged;
  }

  function mergeLidChatIntoPhone(lid: string, phone: string) {
    const lidChat = chats.get(lid);
    if (!lidChat) return;
    const existing = chats.get(phone);
    const lidNewer = (lidChat.lastMessageTime ?? 0) > (existing?.lastMessageTime ?? 0);
    // Re-resolve the display name from the canonical phone JID — copying the
    // LID-keyed chat's fallback "name" verbatim used to leak the @lid number
    // into the sidebar even after the chats had been unified.
    const resolvedName = getDisplayName(phone);
    const merged: ChatInfo = {
      jid: phone,
      name: resolvedName,
      isGroup: lidChat.isGroup,
      lastMessage: lidNewer ? lidChat.lastMessage : existing?.lastMessage,
      lastMessageTime:
        Math.max(lidChat.lastMessageTime ?? 0, existing?.lastMessageTime ?? 0) || undefined,
      lastMessageFromMe: lidNewer ? lidChat.lastMessageFromMe : existing?.lastMessageFromMe,
      lastMessageStatus: lidNewer ? lidChat.lastMessageStatus : existing?.lastMessageStatus,
      unreadCount: (existing?.unreadCount ?? 0) + lidChat.unreadCount,
    };
    chats.set(phone, merged);
    chats.delete(lid);

    const lidMsgs = messages.get(lid);
    if (lidMsgs && lidMsgs.length > 0) {
      const phoneMsgs = messages.get(phone) ?? [];
      const seen = new Set<string>();
      const combined = [...phoneMsgs, ...lidMsgs.map((m) => ({ ...m, jid: phone }))]
        .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
        .sort((a, b) => a.timestamp - b.timestamp);
      messages.set(phone, combined);
    }
    messages.delete(lid);

    io.emit("chats", Array.from(chats.values()));
  }

  function recordLidMapping(lid: string, phone: string) {
    if (lidToPhone.get(lid) === phone) return;
    lidToPhone.set(lid, phone);
    mergeLidChatIntoPhone(lid, phone);
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
    // a particular event uses. Discovering a new mapping also merges any
    // duplicate @lid-keyed chat we'd already created into the phone one.
    const key = m.key as typeof m.key & {
      remoteJidAlt?: string | null;
      participantAlt?: string | null;
    };
    if (key.remoteJid?.endsWith("@lid") && key.remoteJidAlt?.endsWith("@s.whatsapp.net")) {
      recordLidMapping(key.remoteJid, key.remoteJidAlt);
    }
    if (key.participant?.endsWith("@lid") && key.participantAlt?.endsWith("@s.whatsapp.net")) {
      recordLidMapping(key.participant, key.participantAlt);
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
    // Defense in depth: the message id becomes a filename, so never allow path
    // separators / traversal (Baileys ids are normally safe base16/64 strings).
    if (/[/\\]|\.\./.test(m.key.id)) {
      logger.warn({ id: m.key.id }, "unsafe media id, skipping cache");
      return null;
    }
    const meta = getMediaMeta(m.message);
    if (!meta || !sock) return null;
    try {
      const buffer = await downloadMediaMessage(
        m,
        "buffer",
        {},
        {
          logger,
          reuploadRequest: sock.updateMediaMessage,
        },
      );
      const filePath = path.join(MEDIA_DIR, m.key.id);
      await fs.writeFile(filePath, buffer);
      await fs.writeFile(`${filePath}.json`, JSON.stringify(meta));
      const entry: MediaCacheEntry = {
        filePath,
        mimeType: meta.mimeType,
        fileName: meta.fileName,
        size: buffer.length,
      };
      // Account for re-download of the same id, refresh insertion order, then
      // evict oldest if we're over the cap.
      const prev = mediaCache.get(m.key.id);
      if (prev) mediaTotalBytes -= prev.size;
      mediaCache.delete(m.key.id);
      mediaCache.set(m.key.id, entry);
      mediaTotalBytes += buffer.length;
      await enforceMediaCap();
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
    if (!item || skip) {
      if (broadcast) {
        const msg = unwrap(m.message);
        const fields = msg
          ? Object.keys(msg).filter((k) => msg[k as keyof WAMessageContent] != null)
          : [];
        logger.warn(
          { id: m.key.id, jid: m.key.remoteJid, fromMe: m.key.fromMe, fields },
          "upsertMessage skipped",
        );
      }
      return;
    }
    // Merge LID JIDs into their phone-number JID counterparts so we don't
    // create duplicate chats when WhatsApp uses both forms for the same person.
    item.jid = canonicalJid(item.jid);
    if (item.participantJid) {
      item.participantJid = canonicalJid(item.participantJid);
    }

    if (m.key.id) {
      // Refresh insertion order on re-set, then evict oldest beyond the cap.
      rawMessages.delete(m.key.id);
      rawMessages.set(m.key.id, m);
      if (rawMessages.size > RAW_MESSAGE_CAP) {
        const oldest = rawMessages.keys().next().value;
        if (oldest !== undefined) rawMessages.delete(oldest);
      }
    }

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
        io.emit("message-upsert", {
          jid: item.jid,
          message: merged,
          tempId: consumeTempId(merged.id),
        });
      }
      if (needsDownload) scheduleMediaDownload(m, item.jid);
      return;
    }
    list.push(item);
    list.sort((a, b) => a.timestamp - b.timestamp);
    // Keep only the most recent N per chat so a busy conversation doesn't grow
    // without bound over a long session.
    if (list.length > MESSAGES_PER_CHAT_CAP) {
      list.splice(0, list.length - MESSAGES_PER_CHAT_CAP);
    }
    messages.set(item.jid, list);

    const preview = previewFor(item);
    const existingChat = chats.get(item.jid);
    // Only bump the chat preview if this message is at least as recent as
    // what's already there (history events can arrive after live ones).
    const isLatest = (existingChat?.lastMessageTime ?? 0) <= item.timestamp;
    const incrementUnread = broadcast && !item.fromMe ? 1 : 0;
    const updated = upsertChat({
      jid: item.jid,
      lastMessage: isLatest ? preview : existingChat?.lastMessage,
      lastMessageTime: isLatest ? item.timestamp : existingChat?.lastMessageTime,
      lastMessageFromMe: isLatest ? item.fromMe : existingChat?.lastMessageFromMe,
      lastMessageStatus: isLatest ? item.status : existingChat?.lastMessageStatus,
      lastMessageId: isLatest ? item.id : existingChat?.lastMessageId,
      unreadCount: (existingChat?.unreadCount ?? 0) + incrementUnread,
    });

    if (broadcast) {
      io.emit("message-upsert", {
        jid: item.jid,
        message: item,
        tempId: consumeTempId(item.id),
      });
      io.emit("chat-update", updated);
    }

    if (item.jid.endsWith("@g.us")) {
      ensureGroupName(item.jid).catch(() => {});
    }
    // Lazily fetch the chat's avatar the first time we see it.
    ensureAvatar(item.jid).catch(() => {});

    if (needsDownload) scheduleMediaDownload(m, item.jid);
  }

  function scheduleMediaDownload(m: WAMessage, jid: string) {
    downloadMedia(m)
      .then((entry) => {
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
      })
      .catch((err) => console.error("scheduleMediaDownload failed", err));
  }

  function scheduleReconnect(delayMs: number) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      start().catch((e) => console.error("reconnect failed", e));
    }, delayMs);
  }

  // Apply a reaction (or its removal when emoji is "") to a stored message and
  // re-emit it. One reaction per sender (keyed by sender jid).
  function applyReaction(
    jid: string,
    targetId: string,
    emoji: string,
    fromMe: boolean,
    sender: string | undefined,
  ) {
    const list = messages.get(jid);
    if (!list) return;
    const idx = list.findIndex((m) => m.id === targetId);
    if (idx < 0) return;
    const key = sender ?? "";
    // One reaction per sender: drop their previous one, then add the new emoji
    // (empty emoji = reaction removed).
    const prev = list[idx].reactions ?? [];
    const reactions = prev.filter((r) => (r.sender ?? "") !== key);
    if (emoji) {
      const senderName = fromMe ? "나" : sender ? getDisplayName(sender) : undefined;
      reactions.push({ emoji, fromMe, sender, senderName });
    }
    const merged = { ...list[idx], reactions };
    list[idx] = merged;
    io.emit("message-upsert", { jid, message: merged });
  }

  // Mark a stored message as deleted (revoked) and re-emit it.
  function markDeleted(jid: string, targetId: string) {
    const list = messages.get(jid);
    if (!list) return;
    const idx = list.findIndex((m) => m.id === targetId);
    if (idx < 0) return;
    const merged: MessageItem = {
      ...list[idx],
      deleted: true,
      text: "",
      media: undefined,
      reactions: [],
    };
    list[idx] = merged;
    io.emit("message-upsert", { jid, message: merged });
  }

  function listScheduled() {
    return Array.from(scheduled.values())
      .map(({ timer, ...s }) => s)
      .sort((a, b) => a.sendAt - b.sendAt);
  }

  function emitScheduled() {
    io.emit("scheduled", listScheduled());
  }

  function scheduleMessage(jid: string, text: string, sendAt: number) {
    const id = `sched_${sendAt}_${scheduleCounter++}`;
    // setTimeout caps at ~24.8 days (2^31 ms); clamp so we don't fire instantly.
    const delay = Math.min(Math.max(0, sendAt - Date.now()), 2 ** 31 - 1);
    const timer = setTimeout(async () => {
      scheduled.delete(id);
      try {
        if (sock && status.state === "connected") {
          const sent = await sock.sendMessage(jid, { text });
          if (sent?.key?.id) rawMessages.set(sent.key.id, sent);
        }
      } catch (err) {
        console.error("scheduled send failed", err);
      }
      emitScheduled();
    }, delay);
    scheduled.set(id, { id, jid, text, sendAt, timer });
    emitScheduled();
  }

  function cancelScheduled(id: string) {
    const s = scheduled.get(id);
    if (!s) return;
    clearTimeout(s.timer);
    scheduled.delete(id);
    emitScheduled();
  }

  async function markReadInternal(jid: string) {
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
  }

  async function start() {
    if (restarting) return;
    restarting = true;
    // Newest start() wins; events from any earlier socket are ignored via this
    // generation token so overlapping reconnects can't corrupt state.
    const myGen = ++activeGen;
    try {
      // Tear down any prior socket before creating a new one (Baileys removes
      // its listeners on end(), so the old socket's events stop firing).
      if (sock) {
        try {
          sock.end(undefined);
        } catch {
          // already closed
        }
        sock = null;
      }
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: state,
        logger,
        browser: Browsers.macOS("Desktop"),
        // We let Baileys do its normal history sync — disabling it caused the
        // "DANGER: PREVENTS BAILEYS FROM ACCESSING INITIAL LID MAPPINGS"
        // warning and led to dropped messages. We filter history out of the UI
        // ourselves below by ignoring messaging-history.set chats/messages and
        // dropping messages older than the connection timestamp.
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: false,
        // Allow Baileys more chances to recover failed message decryption via
        // retry receipts before giving up (default is fairly low and we see
        // intermittent drops on the new LID identifier format).
        maxMsgRetryCount: 15,
        retryRequestDelayMs: 500,
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
        // Ignore events from a socket superseded by a newer start().
        if (myGen !== activeGen) return;
        const { connection, lastDisconnect, qr } = update;

        // Diagnostic: trace every Baileys connection transition so we can tell
        // whether the WhatsApp WebSocket is being blocked (DLP/firewall) vs a
        // session conflict vs a logged-out device. Always at warn level so it
        // lands in wab.log even in production.
        logger.warn(
          {
            connection: connection ?? "(none)",
            hasQr: !!qr,
            code: (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
              ?.output?.statusCode,
            err: (lastDisconnect?.error as Error | undefined)?.message,
          },
          "connection.update",
        );

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
            scheduleReconnect(1000);
          } else {
            scheduleReconnect(2000);
          }
        }

        if (connection === "open") {
          const me = sock?.user;
          status = {
            state: "connected",
            me: me ? { id: me.id, name: me.name ?? me.verifiedName ?? "Me" } : undefined,
          };
          currentQr = null;
          connectedAt = Math.floor(Date.now() / 1000);
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
          const jid = canonicalJid(c.id);
          if (jid.endsWith("@g.us") && c.name) applyGroupName(jid, c.name);
          upsertChat({
            jid,
            name: c.name ?? contactNames.get(jid) ?? undefined,
            unreadCount: c.unreadCount ?? 0,
          });
          if (jid.endsWith("@g.us") && !groupSubjects.has(jid)) {
            ensureGroupName(jid).catch(() => {});
          }
        }
        io.emit("chats", Array.from(chats.values()));
      });

      sock.ev.on("chats.update", (updates) => {
        for (const c of updates) {
          if (!c.id) continue;
          const jid = canonicalJid(c.id);
          if (jid.endsWith("@g.us") && c.name) applyGroupName(jid, c.name);
          // Intentionally NOT forwarding c.unreadCount — Baileys was sending
          // delayed phone-side values that clobbered locally-incremented
          // counts (and 0 ?? undefined === 0 silently reset to zero).
          // unread is now owned by upsertMessage (increment) + markRead (zero).
          upsertChat({
            jid,
            name: c.name ?? undefined,
          });
        }
      });

      sock.ev.on("messages.upsert", ({ messages: msgs, type }) => {
        for (const m of msgs) {
          // Incoming delete (revoke): mark the target message as deleted rather
          // than rendering the protocol envelope. type 0 === REVOKE.
          const proto = m.message?.protocolMessage;
          if (proto?.type === 0 && proto.key?.id && m.key.remoteJid) {
            markDeleted(canonicalJid(m.key.remoteJid), proto.key.id);
            continue;
          }
          // Hide only clearly-old history-sync replay. Messages delivered
          // because we were offline arrive as type "append" with timestamps
          // from while we were disconnected — those are recent (within
          // HISTORY_CUTOFF_SECONDS) and must stay visible, otherwise messages
          // received while the laptop was asleep silently vanish. Dedup in
          // upsertMessage handles any re-delivery.
          const tsRaw = m.messageTimestamp;
          const ts = typeof tsRaw === "number" ? tsRaw : tsRaw ? Number(tsRaw) : 0;
          if (
            type !== "notify" &&
            ts > 0 &&
            connectedAt > 0 &&
            ts < connectedAt - HISTORY_CUTOFF_SECONDS
          ) {
            continue;
          }
          upsertMessage(m, true);
        }
      });

      sock.ev.on("messages.update", (updates) => {
        for (const u of updates) {
          if (!u.key.id || !u.key.remoteJid) continue;
          const jid = canonicalJid(u.key.remoteJid);
          // The message may have been stored under the canonical phone JID
          // while this update still carries the raw @lid form (or vice versa
          // if the mapping was learned later) — try both so status ticks don't
          // silently fail for LID-merged chats.
          const list = messages.get(jid) ?? messages.get(u.key.remoteJid);
          if (!list) continue;
          const idx = list.findIndex((x) => x.id === u.key.id);
          if (idx < 0) continue;
          const newStatus = mapStatus(u.update.status);
          if (newStatus) {
            const merged = { ...list[idx], status: newStatus };
            list[idx] = merged;
            io.emit("message-status", { id: u.key.id, jid, status: newStatus });
            // If this is the chat's most recent message, propagate the status
            // to the chat preview so the sidebar's read-receipt indicator updates.
            const chat = chats.get(jid);
            if (chat && chat.lastMessageId === u.key.id && chat.lastMessageFromMe) {
              const updatedChat: ChatInfo = { ...chat, lastMessageStatus: newStatus };
              chats.set(jid, updatedChat);
              io.emit("chat-update", updatedChat);
            }
          }
        }
      });

      sock.ev.on("messages.reaction", (reactions) => {
        for (const r of reactions) {
          if (!r.key.remoteJid || !r.key.id) continue;
          const jid = canonicalJid(r.key.remoteJid);
          const emoji = r.reaction?.text ?? "";
          const reactorKey = r.reaction?.key;
          const fromMe = !!reactorKey?.fromMe;
          // For our own reaction, the echo's key.remoteJid is the chat (the peer),
          // not us — so use our own id to match the optimistic entry's sender and
          // avoid a duplicate.
          const rawSender = fromMe
            ? sock?.user?.id
            : (reactorKey?.participant ?? reactorKey?.remoteJid ?? undefined);
          applyReaction(jid, r.key.id, emoji, fromMe, normalizeSender(rawSender));
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
      // Don't throw — a failed first connect (e.g. fetchLatestBaileysVersion
      // blocked by the network) shouldn't prevent the app/window from opening.
      // Reconnect in the background instead.
      console.error("start failed, scheduling reconnect", err);
      logger.warn(
        { err: (err as Error)?.message ?? String(err) },
        "start failed, scheduling reconnect",
      );
      restarting = false;
      scheduleReconnect(3000);
    }
  }

  await start();

  return {
    getStatus: () => status,
    getQr: () => currentQr,
    getChats: () => Array.from(chats.values()),
    getContacts: () => {
      const items: { jid: string; name: string; isGroup: boolean }[] = [];
      for (const [jid, name] of contactNames.entries()) {
        if (!jid.endsWith("@s.whatsapp.net")) continue;
        items.push({ jid, name, isGroup: false });
      }
      for (const [jid, subject] of groupSubjects.entries()) {
        items.push({ jid, name: subject, isGroup: true });
      }
      return items.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    },
    checkOnWhatsApp: async (phone: string): Promise<{ exists: boolean; jid?: string }> => {
      if (!sock || status.state !== "connected") return { exists: false };
      const cleaned = phone.replace(/\D/g, "");
      if (!cleaned) return { exists: false };
      try {
        const results = await sock.onWhatsApp(cleaned);
        if (results && results.length > 0 && results[0].exists) {
          return { exists: true, jid: results[0].jid };
        }
        return { exists: false };
      } catch (err) {
        console.error("checkOnWhatsApp failed", err);
        return { exists: false };
      }
    },
    ensureChat: (rawJid: string) => {
      const jid = canonicalJid(rawJid);
      const existing = chats.get(jid);
      if (existing) return existing;
      const created = upsertChat({ jid, unreadCount: 0 });
      ensureAvatar(jid).catch(() => {});
      io.emit("chat-update", created);
      return created;
    },
    ensureAvatar: (jid: string) => ensureAvatar(jid),
    setAlias: (jid: string, name: string) => setAlias(jid, name),
    loadMessages: (jid: string, limit = 50) => {
      const list = messages.get(jid) ?? [];
      return list.slice(-limit);
    },
    sendMessage: async (
      jid: string,
      text: string,
      replyToId?: string,
      tempId?: string,
    ): Promise<string | undefined> => {
      if (!sock || status.state !== "connected") throw new Error("Not connected");
      const quoted = replyToId ? rawMessages.get(replyToId) : undefined;
      const sent = await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
      const id = sent?.key?.id ?? undefined;
      if (id && tempId) pendingTempIds.set(id, tempId);
      return id;
    },
    sendMedia: async (
      jid: string,
      fileName: string,
      mimeType: string,
      buffer: Buffer,
      caption?: string,
      replyToId?: string,
      tempId?: string,
    ): Promise<string | undefined> => {
      if (!sock || status.state !== "connected") throw new Error("Not connected");
      const opts = replyToId ? { quoted: rawMessages.get(replyToId) } : undefined;
      const quotedOpts = opts?.quoted ? { quoted: opts.quoted } : undefined;
      let sent: Awaited<ReturnType<NonNullable<typeof sock>["sendMessage"]>> | undefined;
      if (mimeType.startsWith("image/")) {
        sent = await sock.sendMessage(
          jid,
          { image: buffer, caption, mimetype: mimeType },
          quotedOpts,
        );
      } else if (mimeType.startsWith("video/")) {
        sent = await sock.sendMessage(
          jid,
          { video: buffer, caption, mimetype: mimeType },
          quotedOpts,
        );
      } else if (mimeType.startsWith("audio/")) {
        sent = await sock.sendMessage(jid, { audio: buffer, mimetype: mimeType }, quotedOpts);
      } else {
        sent = await sock.sendMessage(
          jid,
          { document: buffer, mimetype: mimeType, fileName, caption },
          quotedOpts,
        );
      }
      const id = sent?.key?.id ?? undefined;
      if (id && tempId) pendingTempIds.set(id, tempId);
      return id;
    },
    getMediaEntry: (id: string) => mediaCache.get(id),
    markRead: (jid: string) => markReadInternal(jid),
    markAllRead: async () => {
      for (const chat of Array.from(chats.values())) {
        if (chat.unreadCount > 0) await markReadInternal(chat.jid);
      }
    },
    sendReaction: async (jid: string, messageId: string, emoji: string) => {
      if (!sock || status.state !== "connected") return;
      const raw = rawMessages.get(messageId);
      if (!raw?.key?.remoteJid) return;
      try {
        // Send to the chat the message key actually belongs to — the react
        // payload's key.remoteJid (@lid or @s form) must match the destination
        // jid, otherwise WhatsApp silently drops the reaction. Our `jid` arg is
        // the canonicalized phone form, which mismatched.
        await sock.sendMessage(raw.key.remoteJid, { react: { text: emoji, key: raw.key } });
        applyReaction(
          canonicalJid(raw.key.remoteJid),
          messageId,
          emoji,
          true,
          normalizeSender(sock.user?.id),
        );
      } catch (err) {
        console.error("sendReaction failed", err);
      }
    },
    deleteMessage: async (jid: string, messageId: string, forEveryone: boolean) => {
      if (!sock || status.state !== "connected") return;
      try {
        if (forEveryone) {
          const raw = rawMessages.get(messageId);
          if (raw) await sock.sendMessage(jid, { delete: raw.key });
        }
        // "delete for me" (and the local echo of "for everyone") just hide it.
        markDeleted(jid, messageId);
      } catch (err) {
        console.error("deleteMessage failed", err);
      }
    },
    forwardMessage: async (toJid: string, messageId: string) => {
      if (!sock || status.state !== "connected") return;
      const raw = rawMessages.get(messageId);
      if (!raw) return;
      try {
        await sock.sendMessage(toJid, { forward: raw });
      } catch (err) {
        console.error("forwardMessage failed", err);
      }
    },
    getScheduled: () => listScheduled(),
    scheduleMessage: (jid: string, text: string, sendAt: number) =>
      scheduleMessage(jid, text, sendAt),
    cancelScheduled: (id: string) => cancelScheduled(id),
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
      // Cancel any pending reconnect and invalidate the current socket's events
      // (incl. its logged-out close handler) so they don't double-fire here.
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      activeGen++;
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
      avatarCache.clear();
      mediaCache.clear();
      mediaTotalBytes = 0;
      lidToPhone.clear();
      pendingTempIds.clear();
      for (const s of scheduled.values()) clearTimeout(s.timer);
      scheduled.clear();
      emitScheduled();
      await fs.rm(AUTH_DIR, { recursive: true, force: true });
      await fs.rm(MEDIA_DIR, { recursive: true, force: true });
      await fs.mkdir(AUTH_DIR, { recursive: true });
      await fs.mkdir(MEDIA_DIR, { recursive: true });
      status = { state: "disconnected" };
      io.emit("status", status);
      scheduleReconnect(500);
    },
  };
}

function jidsEqual(a: string, b: string): boolean {
  const norm = (j: string) => j.split(/[:@]/)[0] ?? j;
  return norm(a) === norm(b);
}

export type WhatsAppClient = Awaited<ReturnType<typeof initWhatsApp>>;
