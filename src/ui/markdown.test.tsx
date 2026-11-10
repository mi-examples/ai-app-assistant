// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Markdown } from './markdown';

afterEach(cleanup);

describe('Markdown citations', () => {
  it('renders [n] as a badge, not a link, when citations is set', () => {
    const { container } = render(<Markdown text="Value [1]." citations={1} />);
    const badges = container.querySelectorAll('.aic-cite');

    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('1');
    expect(badges[0].getAttribute('aria-label')).toBe('Source 1');
    expect(container.querySelector('a')).toBeNull();
  });

  it('keeps [1] literal without the citations prop', () => {
    const { container } = render(<Markdown text="Value [1]." />);

    expect(container.querySelector('.aic-cite')).toBeNull();
    expect(container.textContent).toContain('[1]');
  });
});
