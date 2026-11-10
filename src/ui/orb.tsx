import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

export interface OrbProps {
  size?: number;
  mood?: 'idle' | 'thinking' | 'happy';
  lookAtCursor?: boolean;
  bounceKey?: number;
  /** Stops the idle loop, e.g. while the orb is hidden. */
  paused?: boolean;
}

type Flash = 'blink' | 'happy' | 'wink' | 'bounce';

const IDLE_TICK_MS = 900;
const IDLE_CHANCE = 0.25;
const TRACK_RADIUS = 280;
const TRACK_PAUSE_MS = 1500;
const BOUNCE_MS = 560;

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const clamp = (n: number) => Math.max(-1, Math.min(1, n));

export function Orb({ size = 34, mood = 'idle', lookAtCursor = true, bounceKey, paused = false }: OrbProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const lastTrackedAt = useRef(0);
  const [flashes, setFlashes] = useState<Record<Flash, boolean>>({
    blink: false,
    happy: false,
    wink: false,
    bounce: false,
  });

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const flash = useCallback(
    (name: Flash, ms: number) => {
      setFlashes((f) => ({ ...f, [name]: true }));
      later(() => setFlashes((f) => ({ ...f, [name]: false })), ms);
    },
    [later],
  );

  // Eye offset is written straight to the element so tracking never re-renders.
  const setLook = useCallback(
    (x: number, y: number) => {
      const el = rootRef.current;

      if (!el) return;
      el.style.setProperty('--aic-ex', `${x * size * 0.13}px`);
      el.style.setProperty('--aic-ey', `${y * size * 0.1}px`);
    },
    [size],
  );

  // Clear every pending timeout on unmount.
  useEffect(() => {
    const pending = timers.current;

    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // Bounce on bounceKey change (skips the initial mount).
  const prevBounceKey = useRef(bounceKey);
  useEffect(() => {
    if (prevBounceKey.current === bounceKey) return;
    prevBounceKey.current = bounceKey;
    flash('bounce', BOUNCE_MS);
  }, [bounceKey, flash]);

  const thinking = mood === 'thinking';

  // Idle behaviour scheduler.
  useEffect(() => {
    if (paused || thinking || prefersReducedMotion()) return;
    const blink = () => flash('blink', 120);
    const acts: Array<() => void> = [
      blink,
      () => {
        blink();
        later(blink, 220);
      },
      () => {
        setLook(-1, 0);
        later(() => setLook(0, 0), 1100);
      },
      () => {
        setLook(1, 0);
        later(() => setLook(0, 0), 1100);
      },
      () => {
        setLook(-1, 0);
        later(() => setLook(1, 0), 600);
        later(() => setLook(0, 0), 1300);
      },
      () => {
        setLook(0.4, -1);
        later(() => setLook(0, 0), 900);
      },
      () => flash('happy', 1200),
      () => flash('wink', 350),
    ];
    const id = setInterval(() => {
      if (Date.now() - lastTrackedAt.current < TRACK_PAUSE_MS) return;
      if (Math.random() < IDLE_CHANCE) acts[Math.floor(Math.random() * acts.length)]();
    }, IDLE_TICK_MS);

    return () => clearInterval(id);
  }, [paused, thinking, flash, later, setLook]);

  // Cursor tracking.
  useEffect(() => {
    if (!lookAtCursor || thinking || prefersReducedMotion()) return;
    const onMove = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) < TRACK_RADIUS) {
        lastTrackedAt.current = Date.now();
        setLook(clamp(dx / 120), clamp(dy / 120));
      } else if (Date.now() - lastTrackedAt.current < 200) {
        setLook(0, 0);
      }
    };
    window.addEventListener('mousemove', onMove);

    return () => window.removeEventListener('mousemove', onMove);
  }, [lookAtCursor, thinking, setLook]);

  const classes = ['aic-orb'];
  if (thinking) classes.push('aic-orb--thinking');
  if (flashes.blink) classes.push('aic-orb--blink');
  if (flashes.wink) classes.push('aic-orb--wink');
  if (flashes.happy || mood === 'happy') classes.push('aic-orb--happy');
  if (flashes.bounce) classes.push('aic-orb--bounce');

  const style = {
    '--aic-s': `${size}px`,
  } as CSSProperties;

  return (
    <span ref={rootRef} className={classes.join(' ')} style={style} aria-hidden="true">
      <span className="aic-orb__eyes">
        <i />
        <i />
      </span>
    </span>
  );
}
