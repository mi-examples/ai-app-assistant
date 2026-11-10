import { forwardRef } from 'react';
import { resolveLabels } from '../types';
import type { AssistantLabels } from '../types';
import { Orb } from './orb';

export interface LauncherProps {
  open: boolean;
  onClick: () => void;
  labels?: Partial<AssistantLabels>;
}

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export const Launcher = forwardRef<HTMLButtonElement, LauncherProps>(function Launcher({ open, onClick, labels }, ref) {
  const text = resolveLabels(labels).launcher;

  return (
    <button
      ref={ref}
      type="button"
      className={`aic-launcher${open ? ' aic-launcher--hidden' : ''}`}
      onClick={onClick}
      aria-label={text}
      aria-expanded={open}
      tabIndex={open ? -1 : 0}
    >
      <Orb size={34} mood="idle" lookAtCursor={!open} paused={open} />
      <span>{text}</span>
      <kbd className="aic-kbd">{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
    </button>
  );
});
