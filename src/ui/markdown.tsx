import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { prepareCitations } from './citations';

const CITE_PREFIX = '#aic-cite-';

function isSameOrigin(src: string): boolean {
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

const components: Components = {
  // react-markdown blanks unsafe hrefs (javascript: etc.); show those as plain text.
  a: ({ href, children }) => {
    if (href?.startsWith(CITE_PREFIX)) {
      const n = href.slice(CITE_PREFIX.length);

      return (
        <span className="aic-cite" aria-label={`Source ${n}`}>
          {n}
        </span>
      );
    }

    return href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    );
  },
  img: ({ src, alt }) => {
    if (src && isSameOrigin(src)) return <img src={src} alt={alt ?? ''} />;
    if (!src) return <>{alt}</>;

    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || src}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="aic-table-wrap">
      <table>{children}</table>
    </div>
  ),
};

export function Markdown({ text, citations }: { text: string; citations?: number }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {citations === undefined ? text : prepareCitations(text, citations)}
    </ReactMarkdown>
  );
}
