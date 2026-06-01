import type {
  ChatInfo,
  CheckNumberResult,
  ContactItem,
  MessageItem,
  MessageStatusUpdate,
  PresenceUpdate,
  ScheduledItem,
  Status,
} from "../whatsapp/types";

export type SendMediaPayload = {
  jid: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  caption?: string;
  replyToId?: string;
  tempId?: string;
};

export type SendAck = { ok: boolean; id?: string };

export type ServerToClientEvents = {
  qr: (data: { qr: string }) => void;
  status: (status: Status) => void;
  chats: (chats: ChatInfo[]) => void;
  "chat-update": (chat: ChatInfo) => void;
  "message-upsert": (data: { jid: string; message: MessageItem; tempId?: string }) => void;
  "message-status": (update: MessageStatusUpdate) => void;
  presence: (presence: PresenceUpdate) => void;
  scheduled: (items: ScheduledItem[]) => void;
};

export type ClientToServerEvents = {
  "send-message": (
    data: { jid: string; text: string; replyToId?: string; tempId?: string },
    ack?: (res: SendAck) => void,
  ) => void;
  "send-media": (data: SendMediaPayload, ack?: (res: SendAck) => void) => void;
  "load-messages": (
    data: { jid: string; limit?: number },
    ack: (msgs: MessageItem[]) => void,
  ) => void;
  "mark-read": (data: { jid: string }) => void;
  "mark-all-read": () => void;
  "send-reaction": (data: { jid: string; messageId: string; emoji: string }) => void;
  "delete-message": (data: { jid: string; messageId: string; forEveryone: boolean }) => void;
  "forward-message": (data: { toJid: string; messageId: string }) => void;
  "schedule-message": (data: { jid: string; text: string; sendAt: number }) => void;
  "cancel-scheduled": (data: { id: string }) => void;
  typing: (data: { jid: string; isTyping: boolean }) => void;
  "subscribe-presence": (data: { jid: string }) => void;
  "list-contacts": (ack: (contacts: ContactItem[]) => void) => void;
  "check-number": (
    data: { phone: string },
    ack: (result: CheckNumberResult) => void,
  ) => void;
  "start-chat": (data: { jid: string }, ack: (chat: ChatInfo | null) => void) => void;
  "set-alias": (data: { jid: string; name: string }) => void;
  logout: () => void;
};
