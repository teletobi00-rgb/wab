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
  lastMessageFromMe?: boolean;
  lastMessageStatus?: MessageStatus;
  lastMessageId?: string;
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

export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

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

export type Reaction = {
  emoji: string;
  fromMe: boolean;
  sender?: string;
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
  reactions?: Reaction[];
  deleted?: boolean;
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

export type ContactItem = {
  jid: string;
  name: string;
  isGroup: boolean;
};

export type CheckNumberResult = {
  exists: boolean;
  jid?: string;
};
