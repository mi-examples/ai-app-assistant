// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Orb } from './orb';

const stubMatchMedia = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => {
  vi.useFakeTimers();
  stubMatchMedia(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Orb', () => {
  it('renders two eyes and aria-hidden', () => {
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.classList.contains('aic-orb')).toBe(true);
    expect(root.querySelectorAll('.aic-orb__eyes > i')).toHaveLength(2);
    expect(root.style.getPropertyValue('--aic-s')).toBe('34px');
  });

  it('mood thinking sets the aic-orb--thinking class', () => {
    const { container, rerender } = render(<Orb mood="thinking" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('aic-orb--thinking')).toBe(true);
    rerender(<Orb mood="happy" />);
    expect(root.classList.contains('aic-orb--thinking')).toBe(false);
    expect(root.classList.contains('aic-orb--happy')).toBe(true);
  });

  it('idle scheduler does nothing when matchMedia reduce is true', () => {
    stubMatchMedia(true);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
    expect(root.className).toBe('aic-orb');
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    });
    expect(root.style.getPropertyValue('--aic-ex')).toBe('');
  });

  it('runs idle actions when motion is allowed', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always acts, picks blink
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(root.classList.contains('aic-orb--blink')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(120);
    });
    expect(root.classList.contains('aic-orb--blink')).toBe(false);
  });

  it('bounces when bounceKey changes, not on mount', () => {
    const { container, rerender } = render(<Orb bounceKey={0} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.classList.contains('aic-orb--bounce')).toBe(false);
    rerender(<Orb bounceKey={1} />);
    expect(root.classList.contains('aic-orb--bounce')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(560);
    });
    expect(root.classList.contains('aic-orb--bounce')).toBe(false);
  });

  const placeOrb = (root: HTMLElement) => {
    root.getBoundingClientRect = () =>
      ({ left: 400, top: 0, width: 34, height: 34, right: 434, bottom: 34, x: 400, y: 0 }) as DOMRect;
  };
  const move = (x: number) => {
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: 17 }));
    });
  };
  const ex = (root: HTMLElement) => root.style.getPropertyValue('--aic-ex');

  it('follows the cursor when near and ignores a far cursor', () => {
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    placeOrb(root);
    move(517);
    const near = ex(root);
    expect(parseFloat(near)).toBeGreaterThan(0);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    move(0);
    expect(ex(root)).toBe(near);
  });

  it('resets the gaze when the cursor leaves the radius right after tracking', () => {
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    placeOrb(root);
    move(517);
    expect(parseFloat(ex(root))).toBeGreaterThan(0);
    move(0);
    expect(parseFloat(ex(root))).toBe(0);
  });

  it('does not re-render on mousemove', () => {
    const { container } = render(<Orb />);
    const root = container.firstElementChild as HTMLElement;
    placeOrb(root);
    const mo = new MutationObserver(() => {});
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    move(517);
    expect(mo.takeRecords()).toHaveLength(0);
    mo.disconnect();
  });

  it('paused runs no idle loop and lookAtCursor false ignores the cursor', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { container } = render(<Orb paused lookAtCursor={false} />);
    const root = container.firstElementChild as HTMLElement;
    placeOrb(root);
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(root.className).toBe('aic-orb');
    move(417);
    expect(ex(root)).toBe('');
  });

  it('clears timers and listeners on unmount', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount, rerender } = render(<Orb bounceKey={0} />);
    rerender(<Orb bounceKey={1} />);
    act(() => {
      vi.advanceTimersByTime(900);
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('mousemove', expect.any(Function));
  });
});
