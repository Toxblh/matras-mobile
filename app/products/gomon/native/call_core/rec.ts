// Recording in a call (contracts/openapi-rec.yaml): the snapshot's `recording` and
// `recording_options`, the start command's choices and what to tell people when it ends.

export type RecState = "REQUESTED" | "STARTING" | "RETRY_PENDING" | "RECORDING" | "STOPPING" | "FINALIZING" | "READY" | "PARTIAL" | "FAILED" | "DELETING" | "DELETED" | "DELETE_FAILED";
export interface CallRecording { recording_id: string; state: RecState; started_at: string; by: string }
export interface RecOptions { default: string; allowed: string[]; enabled: boolean; modes?: string[]; summary_available?: boolean }
export interface CallBroadcast {
  broadcast_id?: string; state: "LIVE" | "ENDED" | "REVOKED"; hls_state?: string; viewers_now?: number;
  token?: string; watch_url?: string; embed_url?: string; hls_url?: string; iframe?: string; hls_error?: string | null;
}
/** What to record: video and sound, or sound only (for transcription and the AI summary). */
export type RecMode = "video" | "audio";

export const RETENTION_LABEL: Record<string, string> = { unlimited: "Без ограничения", "365d": "1 год", "90d": "90 дней", "30d": "30 дней" };

export const STATE_LABEL: Record<string, string> = {
  REQUESTED: "Запускается", STARTING: "Запускается", RETRY_PENDING: "Повторный запуск", RECORDING: "Идёт запись",
  STOPPING: "Останавливается", FINALIZING: "Обработка", READY: "Готова", PARTIAL: "Частично", FAILED: "Ошибка",
  DELETING: "Удаляется", DELETED: "Удалена", DELETE_FAILED: "Не удалось удалить",
};

export const recOf = (call: unknown) => ((call as { recording?: CallRecording } | null)?.recording ?? null);
export const recOptionsOf = (call: unknown) => ((call as { recording_options?: RecOptions } | null)?.recording_options ?? null);
export const broadcastOf = (call: unknown) => ((call as { broadcast?: CallBroadcast } | null)?.broadcast ?? null);
export const recStarting = (r: CallRecording | null) => !!r && ["REQUESTED", "STARTING", "RETRY_PENDING"].includes(r.state);
export const recStopping = (r: CallRecording | null) => !!r && ["STOPPING", "FINALIZING"].includes(r.state);

/** The start command's body (POST /v1/calls/{id}/recording/start). */
export const recStartBody = (retention: string, mode: RecMode, summary: boolean, opts: RecOptions | null) =>
  ({ retention, mode, summary: summary && !!opts?.summary_available });

/** How a stopped recording ended, said honestly (an egress can die on its own: CPU, storage, SFU). */
export function recOutcome(r: { state: string; outcome_reason: string | null } | null): string {
  if (r?.state === "READY") return "Запись сохранена — она в разделе «Записи»";
  if (r?.state === "PARTIAL") return `Запись прервалась и сохранена частично: ${r.outcome_reason ?? ""}`;
  if (r?.state === "FAILED") return `Запись не удалась: ${r.outcome_reason ?? ""}`;
  return "Запись остановлена";
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${m}:${String(ss).padStart(2, "0")}`;
}
export function fmtClock(sec: number): string { return fmtDur(sec * 1000); }
