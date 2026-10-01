// Meeting chat state (F09), one store per call, outside the UI so that the unread badge on
// the toolbar survives opening/closing the panel. The server is the source of truth: the
// store only merges what GET /v1/calls/{id}/chat?after_rev=N returns (new and deleted
// messages), woken by the ordinary event stream and a slow fallback poll. File upload is the
// host's (XHR with progress on the web, a native file on phones): POST /v1/calls/{id}/chat/files.

export interface ChatAuthor { kind: "employee" | "guest" | "bot"; name: string; me: boolean; principal_id?: string }
export interface ChatFile { file_id: string; name: string; mime: string; size: number; kind: "image" | "file" }
export interface ChatMessage {
  id: number; rev: number; author: ChatAuthor; source: "web" | "mattermost"; created_at: string;
  text: string; links: string[]; mentions: { name: string; me: boolean }[]; mentions_me: boolean;
  file: ChatFile | null; deleted: boolean; deleted_by_moderator: boolean; can_delete: boolean; employees_only?: boolean;
}
export interface ChatFilesPolicy { can_upload: boolean; max_bytes: number; extensions: string[] }
interface ReadResp { messages: ChatMessage[]; rev: number; can_post: boolean; moderator: boolean; files?: ChatFilesPolicy; guest_history?: string }

/** The part of the API client the chat needs. */
export interface ChatApi {
  token?: string | null;
  req<T>(method: string, path: string, body?: unknown): Promise<T>;
  cmd<T>(path: string, body?: Record<string, unknown>): Promise<T>;
}
/** Where the last seen revision survives a reload (sessionStorage on the web); none = per store. */
export interface SeenStore { get(key: string): string | null; set(key: string, value: string): void }

type Listener = () => void;

export class ChatStore {
  messages = new Map<number, ChatMessage>();
  rev = 0;
  loaded = false;
  error: string | null = null;
  canPost = false;
  moderator = false;
  files: ChatFilesPolicy = { can_upload: false, max_bytes: 0, extensions: [] };
  guestHistory = "since_join";
  open = false;
  unread = 0;
  mentioned = false;
  private seenRev = 0;
  private listeners = new Set<Listener>();
  private inflight: Promise<void> | null = null;
  private again = false;
  onMention: ((m: ChatMessage) => void) | null = null;
  /** a new message from someone else arrived while the chat panel is closed */
  onFresh: ((m: ChatMessage) => void) | null = null;

  constructor(public callId: string, public api: ChatApi, private seen?: SeenStore) {
    try { this.seenRev = Number(seen?.get(this.key()) ?? 0) || 0; } catch { /* private mode */ }
  }

  private key() { return `comms.chat.seen.${this.callId}`; }
  subscribe(f: Listener) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  protected emit() { this.listeners.forEach((f) => f()); }

  list(): ChatMessage[] { return [...this.messages.values()].sort((a, b) => a.id - b.id); }

  /** Re-read changes after the last revision. Concurrent calls coalesce into one extra round. */
  refresh(): Promise<void> {
    if (this.inflight) { this.again = true; return this.inflight; }
    this.inflight = (async () => {
      do {
        this.again = false;
        try {
          const j = await this.api.req<ReadResp>("GET", `/v1/calls/${this.callId}/chat?after_rev=${this.loaded ? this.rev : 0}`);
          this.apply(j);
          this.error = null;
        } catch (e: any) {
          this.error = String(e?.message ?? e);
        }
        this.emit();
      } while (this.again);
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private apply(j: ReadResp) {
    const first = !this.loaded;
    for (const m of j.messages) {
      const prev = this.messages.get(m.id);
      this.messages.set(m.id, m);
      const fresh = !prev && !m.deleted && !m.author.me && m.rev > this.seenRev;
      if (fresh && !this.open) {
        this.unread++;
        if (!first) this.onFresh?.(m); // not for the history loaded on (re)join
        if (m.mentions_me) {
          this.mentioned = true;
          if (!first) this.onMention?.(m); // no toast storm for history on (re)load
        }
      }
      if (prev && !prev.deleted && m.deleted && !this.open && this.unread > 0 && !m.author.me && m.rev > this.seenRev) this.unread--;
    }
    this.rev = Math.max(this.rev, j.rev);
    this.canPost = j.can_post;
    this.moderator = j.moderator;
    if (j.files) this.files = j.files;
    if (j.guest_history) this.guestHistory = j.guest_history;
    this.loaded = true;
    if (this.open) this.markSeen();
  }

  setOpen(open: boolean) {
    this.open = open;
    if (open) this.markSeen();
    this.emit();
  }

  private markSeen() {
    this.unread = 0;
    this.mentioned = false;
    this.seenRev = this.rev;
    try { this.seen?.set(this.key(), String(this.rev)); } catch { /* ignore */ }
  }

  /** Optimistic merge of the server's answer to our own command (no false success: only after 2xx). */
  put(m: ChatMessage) {
    this.messages.set(m.id, m);
    if (this.open) this.markSeen();
    this.emit();
  }

  async post(text: string, fileId: string | null = null, mentions: string[] = []) {
    const r = await this.api.cmd<{ message: ChatMessage }>(`/v1/calls/${this.callId}/chat/messages`, {
      text, ...(fileId ? { file_id: fileId } : {}), ...(mentions.length ? { mentions } : {}),
    });
    this.put(r.message);
    void this.refresh();
  }

  async remove(id: number) {
    const r = await this.api.cmd<{ message: ChatMessage }>(`/v1/chat/messages/${id}/delete`);
    this.put(r.message);
  }

  /** The upload endpoint: the raw file body, its name in the query. */
  uploadPath(name: string) { return `/v1/calls/${this.callId}/chat/files?name=${encodeURIComponent(name)}`; }

  link(fileId: string, inline = false) {
    return this.api.req<{ url: string; expires_at: string; name: string }>("GET", `/v1/chat/files/${fileId}/link${inline ? "?inline=1" : ""}`);
  }
}

/** Human Russian text for chat/file error codes (humanError knows the general ones). */
export function chatError(e: unknown): string {
  const err = e as { code?: string; message?: string; raw?: string; details?: { max_bytes?: number } } | undefined;
  const code = err?.code;
  const max = err?.details?.max_bytes;
  const raw = err?.raw ?? err?.message ?? "";
  const by: Record<string, string> = {
    executable: "Исполняемые файлы и скрипты отправлять нельзя.",
    forbidden_type: "Этот тип файла не разрешён политикой организации.",
    type_mismatch: "Содержимое файла не совпадает с его расширением.",
    too_large: max ? `Файл больше допустимого размера (${fmtSize(max)}).` : "Файл слишком большой.",
    infected: "Антивирус обнаружил угрозу в файле — он не отправлен.",
    files_disabled: "Отправка файлов отключена политикой организации.",
    scanner_unavailable: "Проверка файлов временно недоступна. Попробуйте позже.",
    quota_exceeded: "Хранилище файлов этой встречи заполнено.",
    rate_limited: "Слишком часто. Подождите несколько секунд.",
    invalid_transition: "Встреча уже завершена — писать в чат нельзя.",
    validation: raw.includes("longer") ? "Сообщение слишком длинное." : raw.includes("empty") ? "Пустое сообщение." : "Проверьте сообщение.",
    aborted: "Загрузка отменена.",
  };
  return (code && by[code]) || err?.message || "Не удалось выполнить действие.";
}

export function fmtSize(b: number) {
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(b >= 10 << 20 ? 0 : 1)} МБ`;
  if (b >= 1 << 10) return `${Math.round(b / 1024)} КБ`;
  return `${b} Б`;
}
