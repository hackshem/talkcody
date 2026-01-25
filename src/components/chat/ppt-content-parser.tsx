// src/components/chat/ppt-content-parser.ts

import type { ReactNode } from 'react';
import MyMarkdown from './my-markdown';

const SLIDE_SEPARATOR = /^---\s*$/m;

function normalizeSlides(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const segments = trimmed.split(SLIDE_SEPARATOR).map((segment) => segment.trim());
  return segments.filter(Boolean);
}

function hashSlide(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash << 5) - hash + content.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function parsePptContent(content: string): ReactNode[] {
  const slides = normalizeSlides(content);
  if (!slides.length) return [];

  const counts = new Map<string, number>();

  return slides.map((slide) => {
    const base = hashSlide(slide);
    const nextCount = (counts.get(base) ?? 0) + 1;
    counts.set(base, nextCount);

    return (
      <div key={`ppt-slide-${base}-${nextCount}`} className="h-full w-full">
        <MyMarkdown content={slide} />
      </div>
    );
  });
}
