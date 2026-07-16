import { describe, it, expect } from 'vitest';
import { Stamp } from '@/components/ui/stamp';

const render = (node: unknown): string => String((node as { toString(): string }).toString());

describe('Stamp — rubber-stamp state marker', () => {
  it('renders the label (the label carries meaning, never colour alone)', () => {
    const html = render(<Stamp>Allowed</Stamp>);
    expect(html).toContain('Allowed');
    expect(html).toContain('uppercase');
  });

  it('affirm tone uses the working ink; event and refuse use the pop ink', () => {
    expect(render(<Stamp>Proof</Stamp>)).toContain('border-accent-text');
    expect(render(<Stamp tone="event">Sign-off</Stamp>)).toContain('border-pop-text');
    expect(render(<Stamp tone="refuse">Denied</Stamp>)).toContain('border-pop-text');
  });

  it('tilt adds the hand-stamped rotation; none by default', () => {
    expect(render(<Stamp>Live</Stamp>)).not.toContain('rotate');
    expect(render(<Stamp tilt="down">Denied</Stamp>)).toContain('rotate-3');
    expect(render(<Stamp tilt="up">Live</Stamp>)).toContain('-rotate-3');
  });

  it('merges the class escape hatch after base classes', () => {
    expect(render(<Stamp class="mt-2">Live</Stamp>)).toMatch(/class="[^"]*mt-2/);
  });
});
