// "Report a problem" in a call: the report goes out at once (the stats of the moment it broke:
// the last ~30 s as deltas, what everyone publishes and how they are connected, where the call
// runs); the person's symptoms and comment follow as an addendum to the same report id.

import type { CallTelemetry } from "./telemetry";

export const SYMPTOMS = ["no_one_hears_me", "cant_hear", "no_video", "video_freezes", "cant_share", "cant_connect", "other"] as const;
export type Symptom = (typeof SYMPTOMS)[number];

type Participant = {
  isLocal: boolean; connectionQuality: unknown; isSpeaking: boolean;
  getTrackPublication(source: any): { isMuted: boolean } | undefined;
};
type RoomLike = { localParticipant: Participant; remoteParticipants: Map<string, Participant> };

/** What everyone publishes and how they are connected (no names, no identities). */
export function peersOf(room: RoomLike | null) {
  if (!room) return [];
  const pubState = (p: Participant, s: string) => { const pub = p.getTrackPublication(s); return !pub ? "off" : pub.isMuted ? "muted" : "on"; };
  return [room.localParticipant, ...room.remoteParticipants.values()].slice(0, 50).map((p) => ({
    self: p.isLocal, quality: String(p.connectionQuality), mic: pubState(p, "microphone"), cam: pubState(p, "camera"),
    screen: !!p.getTrackPublication("screen_share"), speaking: p.isSpeaking,
  }));
}

/** The first, immediate report (POST /v1/diagnostics); the answer's report_id ties the addendum to it. */
export async function problemReport(o: {
  callId: string; connectionId: string; telemetry: CallTelemetry | null; room: RoomLike | null;
  /** the host's facts: quality, state, ua, visibility, embed, companion… */
  context: Record<string, unknown>;
}) {
  const w = await o.telemetry?.windowStats().catch(() => undefined);
  const at = new Date().toISOString();
  return {
    call_id: o.callId, connection_id: o.connectionId,
    reports: [
      { kind: "webrtc_stats", at, data: { stats: w?.stats ?? [], window_ms: w?.window_ms, peers: w?.peers, peers_poor: w?.peers_poor, peers_lost: w?.peers_lost } },
      { kind: "user_report", at, data: { ...o.context, peers: peersOf(o.room), window_ms: w?.window_ms } },
    ],
  };
}

/** The addendum: symptoms and a comment; null when there is nothing to add. */
export function reportAddendum(o: { callId: string; connectionId: string; reportId: string; symptoms: readonly string[]; comment: string }) {
  if ((!o.comment.trim() && !o.symptoms.length) || !o.reportId) return null;
  return {
    call_id: o.callId, connection_id: o.connectionId, report_id: o.reportId,
    reports: [{ kind: "user_report", at: new Date().toISOString(), data: { symptoms: o.symptoms, comment: o.comment.trim() } }],
  };
}
