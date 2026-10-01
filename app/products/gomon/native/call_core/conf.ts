// Conference protocol: the `conf` part of the call snapshot (hands, spotlight, what I may do),
// reactions, and the server-sent control messages (LiveKit data packets on topic "conf").

export interface Hand { connection_ids: string[]; display_name: string; kind: "employee" | "guest"; principal_id?: string; position?: number; raised_at?: string }
export interface Spot { connection_id: string; source: "camera" | "screen" }
export interface Caps { raise_hand: boolean; react: boolean; lower_other_hand: boolean; mute_other: boolean; mute_all: boolean; request_unmute: boolean; spotlight: boolean }
export interface Conf { hands: Hand[]; spotlight: Spot[]; my_hand: { raised: boolean; position: number | null }; can: Caps }

const NO_CAPS: Caps = { raise_hand: false, react: false, lower_other_hand: false, mute_other: false, mute_all: false, request_unmute: false, spotlight: false };

/** The `conf` part of a call snapshot (nothing allowed while there is none). */
export const confOf = (call: unknown): Conf =>
  (call as { conf?: Conf } | null | undefined)?.conf ?? { hands: [], spotlight: [], my_hand: { raised: false, position: null }, can: NO_CAPS };

export const handOf = (conf: Conf, identity: string) => conf.hands.find((h) => h.connection_ids.includes(identity));

export const REACTIONS: { key: string; emoji: string; ru: string; en: string }[] = [
  { key: "thumbs_up", emoji: "👍", ru: "Нравится", en: "Thumbs up" },
  { key: "clap", emoji: "👏", ru: "Аплодисменты", en: "Clap" },
  { key: "heart", emoji: "❤️", ru: "Сердце", en: "Heart" },
  { key: "laugh", emoji: "😂", ru: "Смешно", en: "Laugh" },
  { key: "wow", emoji: "😮", ru: "Удивление", en: "Wow" },
  { key: "party", emoji: "🎉", ru: "Праздник", en: "Party" },
];
export const emojiOf = (k: string) => REACTIONS.find((r) => r.key === k)?.emoji ?? "";

export const tileKey = (identity: string, source: "camera" | "screen") => identity + (source === "screen" ? ":screen" : ":cam");

// ---------------------------------------------------------------- server control messages
export type ServerMsg =
  | { type: "reaction"; reaction: string; connection_id: string; name: string; at: string }
  | { type: "muted"; by: string; all?: boolean }
  | { type: "unmute_request"; by: string; request_id: string };

/** The JSON body of a control packet (null for anything else). */
export function decodeServerMsg(payload: Uint8Array): ServerMsg | null {
  try {
    const m = JSON.parse(new TextDecoder().decode(payload));
    if (m && typeof m.type === "string") return m as ServerMsg;
  } catch { /* not ours */ }
  return null;
}

/** Accept a packet only if the SFU delivered it without a sender (server-sent), on our topic
 *  (RoomEvent.DataReceived's payload, participant identity and topic). Participants cannot
 *  publish data at all (token grant), this is defence in depth. */
export function parseServerData(payload: Uint8Array, senderIdentity: string | undefined, topic: string | undefined): ServerMsg | null {
  if (senderIdentity || topic !== "conf") return null;
  return decodeServerMsg(payload);
}
