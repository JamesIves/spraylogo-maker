/**
 * Builds the material file that points the game at a spray texture. Sprays only
 * read `$basetexture` from it; the rest matches the stock TF2 logo materials.
 */
export function createSprayVmt(name: string, folder = 'vgui/logos'): string {
  return `"UnlitGeneric"
{
\t"$basetexture"\t"${folder}/${name}"
\t"$translucent"\t"1"
\t"$ignorez"\t"1"
\t"$vertexcolor"\t"1"
\t"$vertexalpha"\t"1"
}
`;
}

/**
 * Lowercase, file system and Source friendly version of a spray name.
 */
export function sanitizeName(name: string): string {
  const clean = name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return clean || 'spray';
}
