import { describe, expect, it } from 'vitest';
import { bleedEdges, clearAlpha, flatten } from './filters';
import { createImage } from './image';

describe('filters', () => {
  it('bleeds edge colour into transparent pixels', () => {
    const image = createImage(4, 1);
    image.data.set([1, 0, 0, 1], 0);
    bleedEdges(image);
    expect(image.data[12]).toBe(1);
    expect(image.data[15]).toBe(0);
  });

  it('flattens transparency onto a background colour', () => {
    const image = createImage(1, 1);
    image.data.set([1, 1, 1, 0.5]);
    flatten(image, [0, 0, 0]);
    expect([...image.data]).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('clears alpha but keeps colour', () => {
    const image = createImage(1, 1);
    image.data.set([0.25, 0.5, 0.75, 1]);
    clearAlpha(image);
    expect([...image.data]).toEqual([0.25, 0.5, 0.75, 0]);
  });
});
