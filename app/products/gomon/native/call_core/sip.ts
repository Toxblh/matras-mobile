// SIP telephony in a call (docs/areas/sip.md): the snapshot's `sip` part, leg states, error
// texts, DTMF codes and the dial-in text for a partner.

export interface Leg {
  leg_id: string; direction: "inbound" | "outbound"; state: string; number: string; number_masked: string; display_name: string;
  target_kind: string; connection_id: string | null; reason: string | null; sip_status: number | null; created_at: string; terminal: boolean;
  requested_by: string | null;
}
export interface SipView {
  phone_connections?: Record<string, { number: string; leg_id: string; direction: string }>;
  phone_admissions?: Record<string, { number: string }>;
  dial_in?: { numbers: string[]; pin: string | null };
  legs?: Leg[]; can_dial?: boolean; partner_policy?: "lobby" | "direct"; partners?: { id: string; name: string; company: string }[];
}
export interface DirEmp { id: string; display_name: string; number: string; label: string }
export interface DirPartner { id: string; name: string; company: string; numbers: { number_masked: string; ref: number; label: string }[] }

export const sipOf = (call: unknown): SipView => ((call as { sip?: SipView } | null)?.sip ?? {});

/** Leg state → [label, tone]. */
export const SIP_STATE: Record<string, [string, string]> = {
  REQUESTED: ["Запрос…", ""], VALIDATING: ["Проверка…", ""], DIALING: ["Набор номера", "accent"], RINGING: ["Звонит", "accent"],
  ANSWERED: ["На связи", "ok"], BUSY: ["Занято", "warn"], NO_ANSWER: ["Не ответил", "warn"], FAILED: ["Не удалось", "danger"],
  CANCELLING: ["Отмена…", ""], CANCELLED: ["Отменён", ""], UNKNOWN_OUTCOME: ["Исход неизвестен", "danger"], HANGING_UP: ["Кладём трубку…", ""],
  HUNG_UP: ["Завершён", ""], REJECTED: ["Отклонён", "danger"], IVR: ["В голосовом меню", "accent"], WAITING_LOBBY: ["Ждёт в лобби", "warn"],
  CONNECTING: ["Подключается", "accent"],
};

const SIP_ERR: Record<string, string> = {
  sip_destination_forbidden: "Этот номер не входит в разрешённые направления.",
  sip_quota_exceeded: "Превышена квота исходящих звонков.",
  sip_lines_busy: "Все телефонные линии заняты.",
  sip_no_trunk: "Телефония не настроена администратором.",
  forbidden: "Звонить на телефоны могут только ведущие.",
  validation: "Проверьте номер.",
};

/** A dial/leg command's error for people (an API error by its code, anything else as is). */
export function sipError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err && typeof err.code === "string") return SIP_ERR[err.code] ?? err.message ?? String(e);
  return String(e);
}

export const legInFlight = (l: Leg) => l.state === "DIALING" || l.state === "RINGING";

export const DTMF_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
/** RFC 4733 event code of a keypad key (LiveKit's publishDtmf). */
export const dtmfCode = (k: string) => (k === "*" ? 10 : k === "#" ? 11 : Number(k));

/** Ready text for a partner: how to join by phone (+ the meeting link). */
export function dialInText(title: string | undefined, d: { numbers: string[]; pin: string | null }, url?: string) {
  return `Подключиться к звонку «${title || "Звонок"}» по телефону: ${d.numbers.join(", ")}`
    + (d.pin ? `, после ответа введите PIN ${d.pin} и #` : "") + (url ? `\nСсылка на встречу: ${url}` : "");
}
