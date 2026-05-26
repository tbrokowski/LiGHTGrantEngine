'use client';
import dynamic from 'next/dynamic';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

const ReactMarkdown = dynamic(() => import('react-markdown'), {
  loading: () => <p className="text-sm text-gray-400 animate-pulse">Loading…</p>,
  ssr: false,
});

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-semibold text-gray-900 mt-6 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-sm font-semibold text-gray-800 mt-5 mb-2 first:mt-0 border-b border-gray-100 pb-1">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-gray-700 mt-4 mb-1">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-sm font-medium text-gray-700 mt-3 mb-1">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-sm text-gray-700 leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-outside ml-5 space-y-1 mb-3 text-sm text-gray-700">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside ml-5 space-y-1 mb-3 text-sm text-gray-700">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="leading-relaxed pl-0.5">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 hover:text-blue-800 underline underline-offset-2 break-words"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  em: ({ children }) => (
    <em className="italic text-gray-600">{children}</em>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-blue-200 pl-4 py-1 my-3 text-sm italic text-gray-500 bg-blue-50/40 rounded-r">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className="block bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono text-gray-700 overflow-x-auto whitespace-pre">
          {children}
        </code>
      );
    }
    return (
      <code className="text-xs bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded font-mono">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-x-auto text-xs font-mono text-gray-700 mb-3 whitespace-pre">
      {children}
    </pre>
  ),
  hr: () => <hr className="border-gray-200 my-4" />,
  table: ({ children }) => (
    <div className="overflow-x-auto mb-4 rounded-lg border border-gray-200">
      <table className="text-sm w-full border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-gray-50">{children}</thead>
  ),
  th: ({ children }) => (
    <th className="text-left text-xs font-semibold text-gray-600 uppercase tracking-wide px-4 py-2.5 border-b border-gray-200">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="text-sm text-gray-700 px-4 py-2.5 border-b border-gray-100 last:border-0">
      {children}
    </td>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-gray-50 transition-colors">{children}</tr>
  ),
};

interface ProseContentProps {
  content: string;
  className?: string;
}

export default function ProseContent({ content, className = '' }: ProseContentProps) {
  if (!content) return null;
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
