export type Status = {
  state: "disconnected" | "connecting" | "connected";
  me?: { id: string; name: string };
};

export type ChatInfo = {
  jid: string;
  name: string;
  isGroup: boolean;
  lastMessage?: string;
  lastMessageTime?: number;
  unreadCount: number;
};

export type MessageType =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "voice"
  | "document"
  | "sticker"
  | "contact"
  | "location"
  | "poll"
  | "system"
  | "other";

export type MessageStatus = "pending" | "sent" | "delivered" | "read";

export type MediaInfo = {
  url: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
};

export type QuotedInfo = {
  stanzaId: string;
  fromMe: boolean;
  participantJid?: string;
  pushName?: string;
  text: string;
  type: MessageType;
};

export type MessageItem = {
  id: string;
  jid: string;
  fromMe: boolean;
  text: string;
  type: MessageType;
  timestamp: number;
  pushName?: string;
  status?: MessageStatus;
  participantJid?: string;
  media?: MediaInfo;
  quoted?: QuotedInfo;
};

export type PresenceState =
  | "available"
  | "composing"
  | "recording"
  | "paused"
  | "unavailable";

export type PresenceUpdate = {
  jid: string;
  participantJid?: string;
  state: PresenceState;
};

export type MessageStatusUpdate = {
  id: string;
  jid: string;
  status: MessageStatus;
};
