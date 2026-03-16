import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('App.svelte layout refactor guards', () => {
  const appSource = readFileSync(resolve(process.cwd(), 'src/App.svelte'), 'utf-8');

  it('keeps a dedicated scroll container for comments', () => {
    expect(appSource).toContain('data-comments-scroll="1"');
    expect(appSource).toContain('class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden');
  });

  it('uses top+bottom constraints for comments panel instead of fixed/max height', () => {
    expect(appSource).toContain('data-comments-panel="1"');
    expect(appSource).toContain('top-[var(--comments-top-px)]');
    expect(appSource).toContain('bottom-[calc(var(--mobile-comment-input-h)+env(safe-area-inset-bottom))]');
    expect(appSource).not.toContain('h-[calc(');
    expect(appSource).not.toContain('max-h-[calc(');
    expect(appSource).not.toMatch(/height\s*:\s*calc\(/);
    expect(appSource).not.toMatch(/max-height\s*:\s*calc\(/);
  });

  it('keeps fixed 8px vertical spacing via shared semantic variable', () => {
    expect(appSource).toContain('const LAYOUT_SECTION_GAP_PX = 8;');
    expect(appSource).toContain('style="margin-top: {LAYOUT_SECTION_GAP_PX}px;"');
    expect(appSource).toContain('panelRect.bottom - rootRect.top + LAYOUT_SECTION_GAP_PX');
  });
});
