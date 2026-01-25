import { describe, expect, it } from 'vitest';
import { parsePptContent } from './ppt-content-parser';

const sample = `# Title

Intro content

---
# Slide Two

- Point one
- Point two

---
# Slide Three

Final notes`;

describe('parsePptContent', () => {
  it('returns an empty array for blank content', () => {
    expect(parsePptContent('')).toHaveLength(0);
  });

  it('splits content into slides using separators', () => {
    const slides = parsePptContent(sample);
    expect(slides).toHaveLength(3);
  });

  it('trims whitespace around slides', () => {
    const slides = parsePptContent('\n\n# One\n\n---\n\n# Two\n\n');
    expect(slides).toHaveLength(2);
  });
});
