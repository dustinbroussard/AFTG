import React from 'react';

const ALLOWED_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'ul', 'ol', 'li', 'code']);

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeHtml(node.textContent || '');
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const children = Array.from(element.childNodes).map(sanitizeNode).join('');

  if (!ALLOWED_TAGS.has(tag)) {
    return children;
  }

  if (tag === 'br') {
    return '<br />';
  }

  return `<${tag}>${children}</${tag}>`;
}

export function sanitizeRichTextHtml(value: string | undefined | null): string {
  const normalizedValue = typeof value === 'string' ? value.trim() : '';
  if (!normalizedValue) {
    return '';
  }

  if (typeof DOMParser === 'undefined') {
    return escapeHtml(normalizedValue).replaceAll('\n', '<br />');
  }

  const document = new DOMParser().parseFromString(normalizedValue, 'text/html');
  return Array.from(document.body.childNodes).map(sanitizeNode).join('');
}

interface SafeRichTextProps {
  as?: keyof React.JSX.IntrinsicElements;
  className?: string;
  html?: string | null;
}

export const SafeRichText: React.FC<SafeRichTextProps> = ({ as = 'div', className, html }) => {
  const sanitizedHtml = sanitizeRichTextHtml(html);
  const Component = as;

  if (!sanitizedHtml) {
    return null;
  }

  return <Component className={className} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
};
