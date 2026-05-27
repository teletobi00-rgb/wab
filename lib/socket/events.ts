import type {
  ChatInfo,
  CheckNumberResult,
  ContactItem,
  MessageItem,
  MessageStatusUpdate,
  PresenceUpdate,
  Status,
} from "../whatsapp/types";

export type SendMediaPayload = {
  jid: string;
  fileName: string;
  mimeType: string;
  data: ArrayBuffer;
  caption?: string;
  replyToId?: string;
};

export type ServerToClientEvents = {
  qr: (data: { qr: string }) => void;
  status: (status: Status) => void;
  chats: (chats: ChatInfo[]) => void;
  "chat-update": (chat: ChatInfo) => void;
  "message-upsert": (data: { jid: string; message: MessageItem }) => void;
  "message-status": (update: MessageStatusUpdate) => void;
  presence: (presence: PresenceUpdate) => void;
};

export type ClientToServerEvents = {
  "send-message": (data: { jid: string; text: string; replyToId?: string }) => void;
  "send-media": (data: SendMediaPayload) => void;
  "load-messages": (
    data: { jid: string; limit?: number },
    ack: (msgs: MessageItem[]) => void,
  ) => void;
  "mark-read": (data: { jid: string }) => void;
  typing: (data: { jid: string; isTyping: boolean }) => void;
  "subscribe-presence": (data: { jid: string }) => void;
  "list-contacts": (ack: (contacts: ContactItem[]) => void) => void;
  "check-number": (
    data: { phone: string },
    ack: (result: CheckNumberResult) => void,
  ) => void;
  "start-chat": (data: { jid: string }, ack: (chat: ChatInfo | null) => void) => void;
  logout: () => void;
};
