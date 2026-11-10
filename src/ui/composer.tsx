import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { ArrowUpIcon, StopIcon, TableIcon } from './icons';

export interface ComposerProps {
  /** Access denied: nothing can be asked. */
  disabled: boolean;
  /** An answer is pending: the send button becomes Stop and Enter does nothing. */
  busy: boolean;
  /** The page supplies page data; without it the chip is hidden. */
  hasPageData: boolean;
  includePageData: boolean;
  onTogglePageData: (v: boolean) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  /** A stopped question; put into the box only when the box is empty. `key` changes per stop. */
  restore?: { text: string; key: number };
  inputRef: RefObject<HTMLTextAreaElement>;
  placeholder: string;
  disclaimer: string;
}

export function Composer(props: ComposerProps) {
  const {
    disabled,
    busy,
    hasPageData,
    includePageData,
    onTogglePageData,
    onSend,
    onStop,
    restore,
    inputRef,
    placeholder,
    disclaimer,
  } = props;
  const [value, setValue] = useState('');
  const locked = disabled || busy;
  const wasLocked = useRef(locked);

  useEffect(() => {
    // Clicking Send or Stop leaves focus on a button that may turn disabled; give it back to the box.
    if (wasLocked.current && !locked) inputRef.current?.focus();
    wasLocked.current = locked;
  }, [locked, inputRef]);

  useEffect(() => {
    if (restore) setValue((v) => (v.trim() === '' ? restore.text : v));
  }, [restore]);

  const submit = () => {
    const q = value.trim();
    if (!q || locked) return;
    setValue('');
    onSend(q);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="aic-composer">
      <div className="aic-box">
        <textarea
          ref={inputRef}
          className="aic-input"
          rows={2}
          placeholder={placeholder}
          aria-label="Your question"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="aic-box__bar">
          {hasPageData ? (
            <button
              type="button"
              aria-pressed={includePageData}
              className={`aic-pd${includePageData ? ' aic-pd--on' : ''}`}
              onClick={() => onTogglePageData(!includePageData)}
            >
              <TableIcon />
              Page data
              {includePageData && <span aria-hidden="true">✓</span>}
            </button>
          ) : (
            <span />
          )}
          {busy ? (
            <button type="button" className="aic-send" aria-label="Stop" onClick={onStop}>
              <StopIcon />
            </button>
          ) : (
            <button
              type="button"
              className="aic-send"
              aria-label="Send"
              disabled={disabled || !value.trim()}
              onClick={submit}
            >
              <ArrowUpIcon />
            </button>
          )}
        </div>
      </div>
      <div className="aic-note">{disclaimer}</div>
    </div>
  );
}
