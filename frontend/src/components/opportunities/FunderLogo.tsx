'use client';
import { useState } from 'react';

interface FunderLogoProps {
  url?: string | null;
  name?: string | null;
  size?: 'sm' | 'md';
}

export default function FunderLogo({ url, name, size = 'sm' }: FunderLogoProps) {
  const [error, setError] = useState(false);
  const imgClass = size === 'md' ? 'h-8 w-auto max-w-[64px]' : 'h-5 w-auto max-w-[36px]';
  const pillClass = size === 'md' ? 'w-8 h-8 text-xs' : 'w-6 h-6 text-[9px]';

  if (url && !error) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name ?? ''}
        onError={() => setError(true)}
        className={`${imgClass} rounded object-contain shrink-0`}
      />
    );
  }

  const initials = (name ?? '?')
    .replace(/[^a-zA-Z\s]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <span className={`${pillClass} rounded-full bg-blue-100 text-blue-600 font-bold flex items-center justify-center shrink-0 select-none`}>
      {initials || '?'}
    </span>
  );
}
