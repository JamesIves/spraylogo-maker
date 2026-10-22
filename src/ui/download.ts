import { strToU8, zipSync } from 'fflate';
import { createSprayVmt } from '../vtf/vmt';

/**
 * Saves data as a file through a temporary link.
 */
export function download(
  data: Uint8Array | string,
  filename: string,
  type = 'application/octet-stream',
): void {
  const part = typeof data === 'string' ? data : data.slice();
  const url = URL.createObjectURL(new Blob([part], { type }));
  const link = Object.assign(document.createElement('a'), {
    href: url,
    download: filename,
  });
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Packs a Source spray with its materials, laid out to drop straight into a game
 * folder. The `ui` copy of the material is what the spray picker shows.
 */
export function sprayZip(name: string, vtf: Uint8Array): Uint8Array {
  const folder = 'materials/vgui/logos';
  return zipSync(
    {
      [`${folder}/${name}.vtf`]: vtf,
      [`${folder}/${name}.vmt`]: strToU8(createSprayVmt(name)),
      [`${folder}/ui/${name}.vmt`]: strToU8(createSprayVmt(name)),
    },
    { level: 0 },
  );
}
