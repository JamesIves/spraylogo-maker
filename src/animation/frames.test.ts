import { describe, expect, it } from 'vitest';
import { selectFrames, type FrameOptions } from './frames';

/**
 * Frame options left at their defaults, apart from any overrides.
 */
const options = (overrides: Partial<FrameOptions> = {}): FrameOptions => ({
  timing: 'all',
  start: 1,
  end: Infinity,
  step: 1,
  reverse: false,
  maxFrames: 0,
  excluded: new Set(),
  ...overrides,
});

describe('selectFrames', () => {
  const durations = [100, 100, 100, 100, 100, 100];

  it('keeps every frame by default', () => {
    expect(selectFrames(durations, options())).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('retimes to the spray frame rate', () => {
    expect(selectFrames(durations, options({ timing: 'spray' }))).toEqual([0, 2, 4]);
    expect(selectFrames([500, 100], options({ timing: 'spray' }))).toEqual([0, 0, 0]);
  });

  it('applies range, exclusions, step and reverse', () => {
    const picked = selectFrames(
      durations,
      options({ start: 2, end: 6, excluded: new Set([3]), step: 2, reverse: true }),
    );
    expect(picked).toEqual([4, 1]);
  });

  it('drops frames evenly to hit a maximum', () => {
    expect(selectFrames(durations, options({ maxFrames: 3 }))).toEqual([0, 2, 4]);
  });
});
