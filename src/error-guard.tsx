import { Component } from 'react';
import type { ReactNode } from 'react';

/**
 * Renders nothing once a child throws. Used around the assistant in the page's tree, and inside the
 * shadow root, which is a separate React root that no outer guard can see.
 */
export class ErrorGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.warn('[ai-app-assistant] disabled after error', error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
