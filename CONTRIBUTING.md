# Contributing

<img align="right" width="180" height="auto" src="./.github/docs/spray.png" alt="A sprayed Half-Life lambda">

Thank you for your interest in contributing to this project! Please review the general process and scope before starting a contribution.

## Scope 📋

The core requirements for this project are:

1. Make working sprays for Source (VTF) and GoldSrc (`tempdecal.wad`) games from common image, animation and video formats.
2. Run entirely in the browser. Files are never uploaded anywhere, and there is no server.
3. Stay simple to use: sensible defaults for each kind of spray, with the detail tucked away in tabs.

## Process 🛠️

1. Install [Node.js](https://nodejs.org) 22.22 or newer (`.nvmrc` has the version CI uses).
2. Clone the project, then install dependencies. This also sets up the Git hooks.

   ```bash
   npm install
   ```

3. Start the development server and open the address it prints.

   ```bash
   npm run dev
   ```

4. Make your changes, adding or updating tests next to the code they cover.
5. Check everything passes before committing.

   ```bash
   npm run check
   ```

6. Commit. A pre-commit hook runs ESLint and Prettier on your staged files and rejects the commit if there are lint errors.
7. Open a pull request against `main`. CI runs the same checks and a production build. Once merged, the site deploys to GitHub Pages automatically.

| Script               | Does                                                       |
| -------------------- | ---------------------------------------------------------- |
| `npm run dev`        | Starts the Vite development server                         |
| `npm run build`      | Type checks and builds the site to `dist`                  |
| `npm run preview`    | Serves the production build locally                        |
| `npm test`           | Runs the Vitest suite once                                 |
| `npm run test:watch` | Runs Vitest in watch mode                                  |
| `npm run lint`       | Runs ESLint                                                |
| `npm run format`     | Formats everything with Prettier                           |
| `npm run check`      | Runs everything CI runs: formatting, lint, types and tests |

> [!NOTE]
> Deploys use the workflow in `.github/workflows/deploy.yml`. In the repository settings, set **Pages** > **Build and deployment** > **Source** to **GitHub Actions** once. The build uses relative paths, so it works from any Pages URL.

## Coding Standards 📏

ESLint enforces these, so `npm run lint` will tell you when something's off.

- Every function, method and class has a multi-line JSDoc comment saying what it does. So do interfaces, their properties and type aliases. Inline callbacks, like the one passed to `.map`, are exempt.
- Functions declare their return types, `any` isn't allowed, and arrays are written as `Type[]`.
- Names say what they hold. Single letter names aren't allowed; prefer `row` and `column` to `x` and `y`, and `channel` to `c`.
- Tests live next to the code they cover, named `*.test.ts`.

## Architecture 🏛️

```
public/          static files copied as-is: icons and footer images
src/
  index.html     the page; Vite compiles it to dist/index.html
  main.ts        wires the page together
  animation/     picking and retiming animation frames
  encoder/       the Web Worker that builds sprays, and its client
  goldsrc/       WAD3 (tempdecal.wad) files and 256 colour palettes
  image/         image types, resampling filters, sharpening, transparency bleed
  input/         decoding images, GIFs, video, TGA, VTF and WAD files
  spray/         settings and the pipelines that turn frames into a spray file
  styles/        the Source-style stylesheet
  ui/            form state, presets, preview, tabs, meter, filmstrip, downloads
  vtf/           VTF files, DXT compression and uncompressed pixel formats, VMT
```

Building a spray runs in a Web Worker so the page stays responsive. The page decodes whatever the user opens into RGBA frames and hands them to the worker once. After that, each settings change only sends the settings, and the worker sends back the finished file. The preview reads that file back, so it shows exactly what will be saved.

## Resources 📚

- [Getting Started and Usage](README.md)
- [VTF format on the Valve Developer Wiki](https://developer.valvesoftware.com/wiki/VTF)
- [VTFLib and VTFEdit](https://github.com/NeilJed/VTFLib)
- [GoldSrc spray format notes](https://github.com/cs16forge/goldsrc-formats/blob/main/spray-tempdecal.md)
