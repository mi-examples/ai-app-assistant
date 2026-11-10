// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Launcher } from './launcher';

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const orb = () => document.querySelector('.aic-orb') as HTMLElement;
const move = () => act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 })));

describe('Launcher orb', () => {
  it('tracks the cursor and idles while the launcher is visible', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<Launcher open={false} onClick={vi.fn()} />);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(orb().classList.contains('aic-orb--blink')).toBe(true);
    move();
    expect(orb().style.getPropertyValue('--aic-ex')).not.toBe('');
  });

  it('is still while hidden behind the open panel', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    render(<Launcher open onClick={vi.fn()} />);
    move();
    expect(orb().style.getPropertyValue('--aic-ex')).toBe('');
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(orb().className).toBe('aic-orb');
  });

  it('shows the default launcher text and takes labels.launcher', () => {
    const { unmount } = render(<Launcher open={false} onClick={vi.fn()} />);
    const btn = () => document.querySelector('.aic-launcher') as HTMLElement;
    expect(btn().getAttribute('aria-label')).toBe('Ask about this page');
    expect(btn().textContent).toContain('Ask about this page');
    unmount();
    render(<Launcher open={false} onClick={vi.fn()} labels={{ launcher: 'Ask Ann' }} />);
    expect(btn().getAttribute('aria-label')).toBe('Ask Ann');
    expect(btn().textContent).toContain('Ask Ann');
  });
});
