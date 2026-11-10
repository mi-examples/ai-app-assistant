import type { ReactNode } from 'react';

const Svg = ({ size = 16, children }: { size?: number; children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const PlusIcon = () => (
  <Svg>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const ChevronDownIcon = () => (
  <Svg>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const ArrowUpIcon = () => (
  <Svg size={14}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
);
export const StopIcon = () => (
  <svg width={11} height={11} viewBox="0 0 10 10" aria-hidden="true">
    <rect width="10" height="10" rx="2" fill="currentColor" />
  </svg>
);
export const RetryIcon = () => (
  <Svg size={14}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const TableIcon = () => (
  <Svg size={12}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
  </Svg>
);

export const ThumbUpIcon = () => (
  <Svg size={14}>
    <path d="M7 10v11H3V10zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7" />
  </Svg>
);
export const ThumbDownIcon = () => (
  <Svg size={14}>
    <path d="M17 14V3h4v11zM17 14l-4 8a3 3 0 0 1-3-3v-4H4a2 2 0 0 1-2-2.3l1.4-8A2 2 0 0 1 5.4 3H17" />
  </Svg>
);
export const CopyIcon = () => (
  <Svg size={14}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
);
