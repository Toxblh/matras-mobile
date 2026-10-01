// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// matras: copied from comms apps/meeting-web/src/extensions/chat/store.ts (comms dc0ae61); keep in
// sync until the shared comms-core package (phase 4). Differences: no sessionStorage (the "seen"
// revision lives as long as the call), no file upload (phase 4), the API is injected.

// Meeting chat state (F09), one store per call, outside React so that the unread badge
// survives opening/closing the panel. The server is the source of truth: the store only merges
// what GET /v1/calls/{id}/chat?after_rev=N returns (new and deleted messages), woken by the
// event stream and a slow fallback poll.

export interface ChatAuthor {kind: 'employee' | 'guest' | 'bot'; name: string; me: boolean; principal_id?: string}
export interface ChatFile {file_id: string; name: string; mime: string; size: number; kind: 'image' | 'file'}
export interface ChatMessage {
    id: number; rev: number; author: ChatAuthor; source: 'web' | 'mattermost'; created_at: string;
    text: string; links: string[]; mentions: Array<{name: string; me: boolean}>; mentions_me: boolean;
    file: ChatFile | null; deleted: boolean; deleted_by_moderator: boolean; can_delete: boolean; employees_only?: boolean;
}
interface ReadResp {messages: ChatMessage[]; rev: number; can_post: boolean; moderator: boolean}

export interface ChatApi {
    req<T>(method: string, path: string, body?: unknown): Promise<T>;
    cmd<T>(path: string, body?: Record<string, unknown>): Promise<T>;
}

type Listener = () => void;

export class ChatStore {
    messages = new Map<number, ChatMessage>();
    rev = 0;
    loaded = false;
    error: string | null = null;
    canPost = false;
    open = false;
    unread = 0;
    mentioned = false;
    private seenRev = 0;
    private listeners = new Set<Listener>();
    private inflight: Promise<void> | null = null;
    private again = false;

    /** a new message from someone else arrived while the chat panel is closed */
    onFresh: ((m: ChatMessage) => void) | null = null;

    constructor(public callId: string, public api: ChatApi) {}

    subscribe(f: Listener) {
        this.listeners.add(f);
        return () => {
            this.listeners.delete(f);
        };
    }
    private emit() {
        this.listeners.forEach((f) => f());
    }

    list(): ChatMessage[] {
        return [...this.messages.values()].sort((a, b) => a.id - b.id);
    }

    /** Re-read changes after the last revision. Concurrent calls coalesce into one extra round. */
    refresh(): Promise<void> {
        if (this.inflight) {
            this.again = true;
            return this.inflight;
        }
        this.inflight = (async () => {
            do {
                this.again = false;
                try {
                    // eslint-disable-next-line no-await-in-loop
                    const j = await this.api.req<ReadResp>('GET', `/v1/calls/${this.callId}/chat?after_rev=${this.loaded ? this.rev : 0}`);
                    this.apply(j);
                    this.error = null;
                } catch (e) {
                    this.error = (e as Error)?.message ?? String(e);
                }
                this.emit();
            } while (this.again);
        })().finally(() => {
            this.inflight = null;
        });
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
                if (!first) {
                    this.onFresh?.(m); // not for the history loaded on (re)join
                }
                if (m.mentions_me) {
                    this.mentioned = true;
                }
            }
            if (prev && !prev.deleted && m.deleted && !this.open && this.unread > 0 && !m.author.me && m.rev > this.seenRev) {
                this.unread--;
            }
        }
        this.rev = Math.max(this.rev, j.rev);
        this.canPost = j.can_post;
        this.loaded = true;
        if (this.open) {
            this.markSeen();
        }
    }

    setOpen(open: boolean) {
        this.open = open;
        if (open) {
            this.markSeen();
        }
        this.emit();
    }

    private markSeen() {
        this.unread = 0;
        this.mentioned = false;
        this.seenRev = this.rev;
    }

    /** Optimistic merge of the server's answer to our own command (no false success: only after 2xx). */
    put(m: ChatMessage) {
        this.messages.set(m.id, m);
        if (this.open) {
            this.markSeen();
        }
        this.emit();
    }

    async post(text: string) {
        const r = await this.api.cmd<{message: ChatMessage}>(`/v1/calls/${this.callId}/chat/messages`, {text});
        this.put(r.message);
        this.refresh();
    }

    link(fileId: string) {
        return this.api.req<{url: string; expires_at: string; name: string}>('GET', `/v1/chat/files/${fileId}/link`);
    }
}
