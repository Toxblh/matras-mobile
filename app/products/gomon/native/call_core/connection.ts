// Client-side part of SM3 (spec/state-machines/sm3-connection.yaml). The table
// below mirrors the spec ids; undeclared events leave the state unchanged and
// record an error instead of pretending success.

export type ConnState =
  | "PREJOIN" | "AUTHORIZING" | "CONNECTING" | "CONNECTED" | "RECONNECTING"
  | "DISCONNECTED" | "LEAVING" | "LEFT" | "REMOVED" | "SESSION_ENDED" | "AUTH_REVOKED";

export type ConnEvent =
  | { type: "JoinRequested" }
  | { type: "TokenIssued" }
  | { type: "JoinRejected"; reason: string }
  | { type: "ParticipantJoined" }
  | { type: "ConnectDeadline" }
  | { type: "TransportLost" }
  | { type: "TransportRestored" }
  | { type: "ReconnectGaveUp" }
  | { type: "LeaveConnection" }
  | { type: "ParticipantLeft" }
  | { type: "Removed" }
  | { type: "SessionEnded" }
  | { type: "AuthRevoked" }
  | { type: "SetIntent"; mic?: boolean; cam?: boolean }
  | { type: "Reset" };

export interface ConnModel {
  state: ConnState;
  reason?: string;
  error?: string;
  intent: { mic: boolean; cam: boolean };
  trail: string[];
}

type Row = [id: string, from: ConnState[], to: ConnState, event: ConnEvent["type"]];

export const TABLE: Row[] = [
  ["SM3-T01", ["PREJOIN"], "AUTHORIZING", "JoinRequested"],
  ["SM3-T02", ["AUTHORIZING"], "CONNECTING", "TokenIssued"],
  ["SM3-T03", ["AUTHORIZING"], "DISCONNECTED", "JoinRejected"],
  ["SM3-T04", ["CONNECTING"], "CONNECTED", "ParticipantJoined"],
  ["SM3-T05", ["CONNECTING"], "DISCONNECTED", "ConnectDeadline"],
  ["SM3-T06", ["CONNECTED"], "RECONNECTING", "TransportLost"],
  ["SM3-T07", ["RECONNECTING"], "CONNECTED", "TransportRestored"],
  ["SM3-T08", ["RECONNECTING"], "DISCONNECTED", "ReconnectGaveUp"],
  ["SM3-T09", ["CONNECTED"], "LEAVING", "LeaveConnection"],
  ["SM3-T10", ["LEAVING"], "LEFT", "ParticipantLeft"],
  ["SM3-T11", ["CONNECTED"], "LEFT", "ParticipantLeft"],
  ["SM3-T12", ["CONNECTING", "CONNECTED"], "REMOVED", "Removed"],
  ["SM3-T13", ["AUTHORIZING", "CONNECTING", "CONNECTED", "LEAVING"], "SESSION_ENDED", "SessionEnded"],
  ["SM3-T14", ["CONNECTING", "CONNECTED"], "AUTH_REVOKED", "AuthRevoked"],
  ["SM3-T15", ["CONNECTING"], "LEFT", "LeaveConnection"],
];

export function initial(intent = { mic: true, cam: true }): ConnModel {
  return { state: "PREJOIN", intent, trail: [] };
}

export function reduce(m: ConnModel, e: ConnEvent): ConnModel {
  if (e.type === "SetIntent") {
    return { ...m, intent: { mic: e.mic ?? m.intent.mic, cam: e.cam ?? m.intent.cam } };
  }
  if (e.type === "Reset") {
    return initial(m.intent);
  }
  // RECONNECTING is a sub-state of an established connection: server verdicts apply to it too.
  const from = m.state === "RECONNECTING" && ["Removed", "SessionEnded", "AuthRevoked", "LeaveConnection"].includes(e.type) ? "CONNECTED" : m.state;
  const row = TABLE.find(([, f, , ev]) => ev === e.type && f.includes(from));
  if (!row) {
    return { ...m, error: `${e.type} in ${m.state} is not declared` };
  }
  const reason = e.type === "JoinRejected" ? e.reason : m.reason;
  return { ...m, state: row[2], reason, error: undefined, trail: [...m.trail, row[0]] };
}

export const isTerminal = (s: ConnState) =>
  ["DISCONNECTED", "LEFT", "REMOVED", "SESSION_ENDED", "AUTH_REVOKED"].includes(s);
