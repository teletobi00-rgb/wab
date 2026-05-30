"use client";

import { useEffect, useRef, useState } from "react";
import { matchKeyword, useKeywords } from "@/lib/keywords";
import { useNotifications } from "@/lib/notifications";
import { useSocket } from "@/lib/socket/client";
import type {
  ChatInfo,
  MessageItem,
  MessageStatusUpdate,
  PresenceState,
  PresenceUpdate,
  ScheduledItem,
  Status,
} from "@/lib/whatsapp/types";
import { Avatar } from "./avatar";
import { ChatList } from "./chat-list";
import { ChatWindow } from "./chat-window";
import { ForwardModal } from "./forward-modal";
import { NewChatModal } from "./new-chat-modal";
import { QrLogin } from "./qr-login";
import { SearchBar } from "./search-bar";
import { SettingsModal } from "./settings-modal";

// Mirror the server's per-chat history cap so a long-lived client session
// doesn't accumulate unbounded message arrays in memory.
const MESSAGES_PER_CHAT_CAP = 500;

export function ChatApp() {
  const { socket, connected: socketConnected } = useSocket();
  const [status, setStatus] = useState<Status>({ state: "disconnected" });
  const [qr, setQr] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [messagesByJid, setMessagesByJid] = useState<Record<string, MessageItem[]>>({});
  const [presenceByJid, setPresenceByJid] = useState<Record<string, PresenceState>>({});
  const [query, setQuery] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [forwardMessageId, setForwardMessageId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);
  const notif = useNotifications();
  const { keywords, add: addKeyword, remove: removeKeyword } = useKeywords();
  const selectedJidRef = useRef<string | null>(null);
  const chatsRef = useRef<ChatInfo[]>([]);
  const keywordsRef = useRef<string[]>([]);

  useEffect(() => {
    keywordsRef.current = keywords;
  }, [keywords]);

  useEffect(() => {
    selectedJidRef.current = selectedJid;
  }, [selectedJid]);

  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);

  useEffect(() => {
    if (!socket) return;

    const onStatus = (s: Status) => {
      setStatus(s);
      if (s.state === "connected") setQr(null);
      if (s.state === "disconnected") {
        setChats([]);
        setMessagesByJid({});
        setPresenceByJid({});
        setSelectedJid(null);
      }
    };
    const onQr = ({ qr }: { qr: string }) => setQr(qr);
    const onChats = (cs: ChatInfo[]) => setChats(sortChats(cs));
    const onChatUpdate = (c: ChatInfo) => {
      // Keep the badge at 0 for the chat the user is actively viewing — we
      // mark-read on every incoming message there, so an interim chat-update
      // carrying unreadCount=1 would otherwise make it flash.
      const isFocusedChat =
        selectedJidRef.current === c.jid &&
        typeof document !== "undefined" &&
        document.visibilityState === "visible" &&
        document.hasFocus();
      const cc = isFocusedChat && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c;
      setChats((prev) => {
        const i = prev.findIndex((x) => x.jid === cc.jid);
        const next = i >= 0 ? [...prev.slice(0, i), cc, ...prev.slice(i + 1)] : [cc, ...prev];
        return sortChats(next);
      });
    };
    const onMessageUpsert = ({
      jid,
      message,
      tempId,
    }: {
      jid: string;
      message: MessageItem;
      tempId?: string;
    }) => {
      setMessagesByJid((prev) => {
        const list = prev[jid] ?? [];
        // 1) Exact optimistic replacement: the server echoes back the tempId
        // we sent, so we replace the precise placeholder (no fuzzy matching).
        if (tempId) {
          const ti = list.findIndex((m) => m.id === tempId);
          if (ti >= 0) {
            const next = list.slice();
            next[ti] = message;
            return { ...prev, [jid]: next };
          }
        }
        // 2) Already present (e.g. status/media update): merge in place.
        const idx = list.findIndex((m) => m.id === message.id);
        if (idx >= 0) {
          const next = list.slice();
          next[idx] = { ...next[idx], ...message };
          return { ...prev, [jid]: next };
        }
        // 3) New message: append, capped to mirror the server's per-chat limit.
        const appended = [...list, message].sort((a, b) => a.timestamp - b.timestamp);
        if (appended.length > MESSAGES_PER_CHAT_CAP) {
          appended.splice(0, appended.length - MESSAGES_PER_CHAT_CAP);
        }
        return { ...prev, [jid]: appended };
      });

      if (message.fromMe) return;
      const matched = matchKeyword(message.text, keywordsRef.current);
      const isCurrent = selectedJidRef.current === jid;
      const isVisible =
        typeof document !== "undefined" && document.visibilityState === "visible";
      const hasFocus = typeof document !== "undefined" && document.hasFocus();
      const inFocus = isCurrent && isVisible && hasFocus;

      // Auto mark-read when the message arrives in the chat the user is on,
      // and optimistically clear the badge so it doesn't flash 1→0.
      if (inFocus) {
        socket.emit("mark-read", { jid });
        setChats((prev) =>
          prev.map((c) => (c.jid === jid && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c)),
        );
        // A keyword hit still notifies even while the chat is focused.
        if (!matched) return;
      }

      const chat = chatsRef.current.find((c) => c.jid === jid);
      const baseTitle = chat?.name ?? message.pushName ?? "새 메시지";
      const title = matched ? `🔔 ${baseTitle}` : baseTitle;
      const sender = chat?.isGroup && message.pushName ? `${message.pushName}: ` : "";
      const body =
        (matched ? `[${matched}] ` : "") + sender + (message.text || messagePreview(message));
      notif.notify(title, body, () => setSelectedJid(jid));
    };
    const onMessageStatus = ({ id, jid, status }: MessageStatusUpdate) => {
      setMessagesByJid((prev) => {
        const list = prev[jid];
        if (!list) return prev;
        const idx = list.findIndex((m) => m.id === id);
        if (idx < 0) return prev;
        const next = list.slice();
        next[idx] = { ...next[idx], status };
        return { ...prev, [jid]: next };
      });
    };
    const onPresence = ({ jid, state }: PresenceUpdate) => {
      setPresenceByJid((prev) => ({ ...prev, [jid]: state }));
    };
    const onScheduled = (items: ScheduledItem[]) => setScheduled(items);

    socket.on("status", onStatus);
    socket.on("qr", onQr);
    socket.on("chats", onChats);
    socket.on("chat-update", onChatUpdate);
    socket.on("message-upsert", onMessageUpsert);
    socket.on("message-status", onMessageStatus);
    socket.on("presence", onPresence);
    socket.on("scheduled", onScheduled);

    return () => {
      socket.off("status", onStatus);
      socket.off("qr", onQr);
      socket.off("chats", onChats);
      socket.off("chat-update", onChatUpdate);
      socket.off("message-upsert", onMessageUpsert);
      socket.off("message-status", onMessageStatus);
      socket.off("presence", onPresence);
      socket.off("scheduled", onScheduled);
    };
  }, [socket, notif.notify]);

  useEffect(() => {
    if (!socket || !selectedJid) return;
    socket.emit("load-messages", { jid: selectedJid, limit: 100 }, (msgs) => {
      // Merge, don't replace: a live message-upsert can land between the server
      // computing this snapshot and the ack arriving. Dedupe by id (server copy
      // wins) and keep any optimistic/local placeholders not yet echoed.
      setMessagesByJid((prev) => {
        const existing = prev[selectedJid] ?? [];
        const byId = new Map<string, MessageItem>();
        for (const m of msgs) byId.set(m.id, m);
        for (const m of existing) if (!byId.has(m.id)) byId.set(m.id, m);
        const merged = Array.from(byId.values()).sort((a, b) => a.timestamp - b.timestamp);
        if (merged.length > MESSAGES_PER_CHAT_CAP) {
          merged.splice(0, merged.length - MESSAGES_PER_CHAT_CAP);
        }
        return { ...prev, [selectedJid]: merged };
      });
    });
    socket.emit("subscribe-presence", { jid: selectedJid });
    socket.emit("mark-read", { jid: selectedJid });
  }, [socket, selectedJid]);

  if (!socketConnected) return <Centered>서버 연결 중...</Centered>;
  if (status.state !== "connected") return <QrLogin qr={qr} status={status} />;

  const selectedChat = chats.find((c) => c.jid === selectedJid) ?? null;
  const selectedMessages = selectedJid ? (messagesByJid[selectedJid] ?? []) : [];
  const selectedPresence = selectedJid ? presenceByJid[selectedJid] : undefined;
  const totalUnread = chats.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <aside className="flex w-[360px] flex-col border-r border-wa-border bg-wa-panel">
        <Header
          me={status.me?.name ?? "Me"}
          notifEnabled={notif.enabled}
          onToggleNotif={notif.toggle}
          onNewChat={() => setNewChatOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onLogout={() => {
            if (confirm("정말 로그아웃 하시겠습니까? 세션이 삭제됩니다.")) {
              socket?.emit("logout");
            }
          }}
        />
        <SearchBar value={query} onChange={setQuery} />
        {totalUnread > 0 ? (
          <button
            type="button"
            onClick={() => socket?.emit("mark-all-read")}
            className="flex items-center justify-between border-b border-wa-border bg-wa-panel px-4 py-1.5 text-[12px] text-wa-text-muted transition-colors hover:bg-wa-panel-soft"
          >
            <span>안 읽음 {totalUnread}개</span>
            <span className="font-medium text-wa-green">모두 읽음</span>
          </button>
        ) : null}
        <ChatList chats={chats} selectedJid={selectedJid} onSelect={setSelectedJid} query={query} />
      </aside>
      <main className="flex flex-1 flex-col bg-wa-bg">
        {selectedChat ? (
          <ChatWindow
            key={selectedChat.jid}
            chat={selectedChat}
            messages={selectedMessages}
            presence={selectedPresence}
            onSend={(text, replyToId) => {
              if (!socket) return;
              // Optimistic add: render the message immediately as "pending".
              // The server echoes back our tempId so onMessageUpsert can swap
              // the exact placeholder; the ack surfaces a failed send.
              const tempId = `local-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
              const jid = selectedChat.jid;
              const optimistic: MessageItem = {
                id: tempId,
                jid,
                fromMe: true,
                text,
                type: "text",
                timestamp: Math.floor(Date.now() / 1000),
                status: "pending",
              };
              setMessagesByJid((prev) => ({
                ...prev,
                [jid]: [...(prev[jid] ?? []), optimistic],
              }));
              socket.emit("send-message", { jid, text, replyToId, tempId }, (res) => {
                setMessagesByJid((prev) => {
                  const list = prev[jid];
                  if (!list) return prev;
                  const ti = list.findIndex((m) => m.id === tempId);
                  if (ti < 0) return prev; // echo already replaced it
                  const next = list.slice();
                  next[ti] = res.ok
                    ? { ...next[ti], id: res.id ?? next[ti].id }
                    : { ...next[ti], status: "failed" };
                  return { ...prev, [jid]: next };
                });
              });
            }}
            onTyping={(isTyping) =>
              socket?.emit("typing", { jid: selectedChat.jid, isTyping })
            }
            onSendMedia={(fileName, mimeType, data, caption, replyToId) =>
              socket?.emit(
                "send-media",
                {
                  jid: selectedChat.jid,
                  fileName,
                  mimeType,
                  data,
                  caption,
                  replyToId,
                },
                (res) => {
                  if (!res.ok) alert(`'${fileName}' 전송에 실패했습니다.`);
                },
              )
            }
            onReact={(messageId, emoji) =>
              socket?.emit("send-reaction", { jid: selectedChat.jid, messageId, emoji })
            }
            onDelete={(messageId, forEveryone) =>
              socket?.emit("delete-message", { jid: selectedChat.jid, messageId, forEveryone })
            }
            onForward={(messageId) => setForwardMessageId(messageId)}
            onScheduleMessage={(text, sendAt) =>
              socket?.emit("schedule-message", { jid: selectedChat.jid, text, sendAt })
            }
          />
        ) : (
          <EmptyState />
        )}
      </main>
      {newChatOpen ? (
        <NewChatModal
          socket={socket}
          onClose={() => setNewChatOpen(false)}
          onStartChat={(jid) => {
            if (!socket) return;
            socket.emit("start-chat", { jid }, (chat) => {
              if (chat) {
                setChats((prev) => {
                  if (prev.find((c) => c.jid === chat.jid)) return prev;
                  return sortChats([chat, ...prev]);
                });
                setSelectedJid(chat.jid);
              }
            });
          }}
        />
      ) : null}
      {forwardMessageId ? (
        <ForwardModal
          chats={chats}
          onClose={() => setForwardMessageId(null)}
          onPick={(toJid) => {
            socket?.emit("forward-message", { toJid, messageId: forwardMessageId });
            setForwardMessageId(null);
            setSelectedJid(toJid);
          }}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsModal
          keywords={keywords}
          onAddKeyword={addKeyword}
          onRemoveKeyword={removeKeyword}
          scheduled={scheduled}
          chatNameOf={(jid) => chats.find((c) => c.jid === jid)?.name ?? jid.split("@")[0]}
          onCancelScheduled={(id) => socket?.emit("cancel-scheduled", { id })}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function messagePreview(m: MessageItem): string {
  switch (m.type) {
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
      return "새 메시지";
  }
}

function sortChats(cs: ChatInfo[]): ChatInfo[] {
  return cs.slice().sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));
}

function EmptyState() {
  return (
    <div className="chat-bg flex h-full w-full flex-col items-center justify-center text-center">
      <div className="mb-4 text-6xl opacity-30">💬</div>
      <h2 className="text-lg font-medium text-wa-text">WAB</h2>
      <p className="mt-1 max-w-sm text-sm text-wa-text-muted">
        좌측 목록에서 대화를 선택하면 메시지가 표시됩니다.
        <br />
        파일은 드래그&드롭하거나 📎 버튼으로 전송하세요.
      </p>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-wa-bg text-wa-text-muted">
      {children}
    </div>
  );
}

function Header({
  me,
  notifEnabled,
  onToggleNotif,
  onNewChat,
  onSettings,
  onLogout,
}: {
  me: string;
  notifEnabled: boolean;
  onToggleNotif: () => void;
  onNewChat: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-wa-border bg-wa-panel-soft px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={me} isGroup={false} size="sm" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium text-wa-text">{me}</div>
          <div className="flex items-center gap-1 text-[11px] text-wa-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-wa-green" />
            온라인
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={onNewChat}
          title="새 채팅"
          aria-label="새 채팅"
          className="flex h-8 w-8 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M16 4h2a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M12 3v10m-5-5h10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onToggleNotif}
          title={notifEnabled ? "알림 켜짐" : "알림 꺼짐"}
          aria-label={notifEnabled ? "알림 끄기" : "알림 켜기"}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-wa-panel-hover ${
            notifEnabled ? "text-wa-green" : "text-wa-text-muted"
          }`}
        >
          {notifEnabled ? <BellFilled /> : <BellOutline />}
        </button>
        <button
          type="button"
          onClick={onSettings}
          title="설정"
          aria-label="설정"
          className="flex h-8 w-8 items-center justify-center rounded-full text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="rounded px-2 py-1 text-[11px] text-wa-text-muted transition-colors hover:bg-wa-panel-hover hover:text-wa-text"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}

function BellOutline() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 7H4c.5-1.5 2-3 2-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BellFilled() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 7H4c.5-1.5 2-3 2-7Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 19a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
