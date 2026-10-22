import { describe, expect, it } from 'vitest';
import { toFloat } from './image';
import { resample, resize } from './resample';

describe('resample', () => {
  it('works in premultiplied alpha so transparent colour does not leak', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);
    const { data: output } = resize({ width: 2, height: 1, data }, 1, 1, 'box');
    expect(output[0]).toBeCloseTo(1);
    expect(output[1]).toBeCloseTo(0);
    expect(output[3]).toBeCloseTo(0.5);
  });

  it('accepts float and 8-bit input alike', () => {
    const bytes = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([51, 102, 153, 255]),
    };
    const area = { left: 0, top: 0, width: 1, height: 1 };
    const fromBytes = resample(bytes, area, 2, 2, 'catrom');
    const fromFloats = resample(toFloat(bytes), area, 2, 2, 'catrom');
    expect([...fromBytes.data]).toEqual([...fromFloats.data]);
  });

  it('copies exact pixels with point sampling', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const { data: output } = resize({ width: 2, height: 1, data }, 4, 1, 'point');
    const reds = [...output].filter((_, index) => index % 4 === 0);
    expect(reds).toEqual([1, 1, 0, 0]);
  });
});
