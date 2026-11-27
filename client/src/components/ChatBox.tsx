import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, messageOf } from '../lib/api.ts';
import type { Message } from '../lib/types.ts';
import { inputClass, primaryButtonClass } from './Field.tsx';
import { ErrorNotice } from './LoadState.tsx';

const POLL_MS = 5000;

function isMissingEndpoint(err: unknown) {
  return err instanceof ApiError && err.code === 'NOT_FOUND';
}

export function ChatBox({ groupId }: { groupId: number }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const mounted = useRef(true);
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    const isStale = () => !mounted.current || request !== latestRequest.current;
    try {
      const reply = await api<{ messages: Message[] }>(`/groups/${groupId}/messages`);
      if (isStale()) return;
      setMessages([...reply.messages].reverse());
      setLoadError(null);
    } catch (err) {
      if (isStale()) return;
      if (isMissingEndpoint(err)) setUnavailable(true);
      else setLoadError(err);
    }
  }, [groupId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (unavailable) return;
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load, unavailable]);

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setSendError(null);
    try {
      await api(`/groups/${groupId}/messages`, { method: 'POST', body: { body } });
      setDraft('');
      await load();
    } catch (err) {
      if (isMissingEndpoint(err)) setUnavailable(true);
      else setSendError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-xl font-semibold">Chat</h2>
      {unavailable ? (
        <p className="text-content-muted">Chat is not available yet.</p>
      ) : (
        <>
          {loadError ? (
            <div className="mb-3">
              <ErrorNotice error={loadError} onRetry={() => void load()} />
            </div>
          ) : null}
          <div className="mb-3 flex max-h-96 flex-col gap-2 overflow-y-auto rounded-sm border border-subtle bg-surface-raised p-3">
            {messages === null ? (
              <p className="text-sm text-content-muted">
                {loadError ? 'Messages could not be loaded.' : 'Loading…'}
              </p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-content-muted">No messages yet. Say hello.</p>
            ) : (
              messages.map((m) => (
                <div key={m.messageId}>
                  <p className="text-sm">
                    <span className="font-semibold">{m.displayName}</span>{' '}
                    <span className="text-content-faint">
                      {new Date(m.createdAt).toLocaleString()}
                    </span>
                  </p>
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={onSend} className="flex gap-2">
            <input
              aria-label="Message"
              placeholder="Write a message"
              className={inputClass}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              disabled={sending || draft.trim() === ''}
              className={primaryButtonClass}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
          {sendError && <p className="mt-2 text-sm text-danger">{sendError}</p>}
        </>
      )}
    </section>
  );
}
