import { useEffect, useState } from 'react';
import type { ChatMessage } from '../chat/use-concierge-chat';
import { CopyIcon, RetryIcon, ThumbDownIcon, ThumbUpIcon } from './icons';
import { Markdown } from './markdown';

export const NO_SOURCES_COPY = "You don't have access to any Concierge sources. Ask your administrator.";
const STILL_THINKING_MS = 10_000;

function Thinking() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), STILL_THINKING_MS);

    return () => clearTimeout(t);
  }, []);

  return <div className="aic-think">{slow ? 'Still thinking…' : 'Thinking…'}</div>;
}

function routeLabel(message: ChatMessage): string | null {
  if (message.status === 'pending') return message.forwarded ? 'Asking MI Concierge…' : null;
  if (message.status !== 'done' || !message.route) return null;
  const secs = ((message.elapsedMs ?? 0) / 1000).toFixed(1);

  return message.route === 'page' ? `Answered from this page · ${secs}s` : `Answered by MI Concierge · ${secs}s`;
}

export interface MessageProps {
  message: ChatMessage;
  feedbackAvailable: boolean;
  onRetry: (id: string) => void;
  onLike: (id: string, v: 'like' | 'dislike') => void;
}

export function Message({ message, feedbackAvailable, onRetry, onLike }: MessageProps) {
  const [voted, setVoted] = useState<'like' | 'dislike' | null>(null);

  // A retried answer is a new answer: drop the vote given to the old one.
  useEffect(() => {
    if (message.status === 'pending') setVoted(null);
  }, [message.status]);

  if (message.role === 'user') {
    return (
      <div className="aic-row aic-row--user" data-msg={message.id}>
        <div className="aic-u">{message.text}</div>
      </div>
    );
  }

  const vote = (v: 'like' | 'dislike') => {
    setVoted(v);
    onLike(message.id, v);
  };
  const copy = () => {
    void navigator.clipboard?.writeText(message.text).catch(() => undefined);
  };
  const label = routeLabel(message);
  const isPage = message.route === 'page';

  return (
    <div className="aic-row" data-msg={message.id}>
      <div className="aic-a">
        {label && (
          <div className="aic-route">
            <span className={`aic-route__dot aic-route__dot--${isPage ? 'page' : 'concierge'}`} aria-hidden="true" />
            {label}
          </div>
        )}
        {message.status === 'pending' && <Thinking />}
        {message.status === 'error' &&
          (message.errorKind === 'no_sources' ? (
            <p>{NO_SOURCES_COPY}</p>
          ) : (
            <p>
              Something went wrong.{' '}
              <button type="button" className="aic-link" onClick={() => onRetry(message.id)}>
                Try again
              </button>
            </p>
          ))}
        {message.status === 'done' && (
          <>
            <Markdown text={message.text} citations={isPage ? message.citations : undefined} />
            {!!message.sources?.length && (
              <ol className="aic-srcs">
                {message.sources.map((s, i) => (
                  <li key={i}>
                    <span className="aic-srcs__n">{i + 1}</span>
                    <b>{s.label}</b> {s.detail}
                  </li>
                ))}
              </ol>
            )}
            <div className="aic-actions">
              <button type="button" className="aic-ic" aria-label="Copy answer" onClick={copy}>
                <CopyIcon />
              </button>
              <button type="button" className="aic-ic" aria-label="Retry" onClick={() => onRetry(message.id)}>
                <RetryIcon />
              </button>
              {message.route === 'concierge' && feedbackAvailable && (
                <>
                  <button
                    type="button"
                    className={`aic-ic${voted === 'like' ? ' aic-ic--on' : ''}`}
                    aria-label="Helpful"
                    aria-pressed={voted === 'like'}
                    onClick={() => vote('like')}
                  >
                    <ThumbUpIcon />
                  </button>
                  <button
                    type="button"
                    className={`aic-ic${voted === 'dislike' ? ' aic-ic--on' : ''}`}
                    aria-label="Not helpful"
                    aria-pressed={voted === 'dislike'}
                    onClick={() => vote('dislike')}
                  >
                    <ThumbDownIcon />
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
