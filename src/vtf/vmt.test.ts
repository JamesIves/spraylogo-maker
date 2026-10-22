import { describe, expect, it } from 'vitest';
import { createSprayVmt, sanitizeName } from './vmt';

describe('vmt', () => {
  it('points the material at the spray texture', () => {
    expect(createSprayVmt('cool')).toContain('"$basetexture"\t"vgui/logos/cool"');
  });

  it('makes names safe for the game', () => {
    expect(sanitizeName('Cool Spray!.PNG')).toBe('cool_spray');
    expect(sanitizeName('...')).toBe('spray');
  });
});
