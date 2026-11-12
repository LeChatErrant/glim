// Renders Glim's icon set (the jewel mark: warm core, dark gap, ivory ring, glow) into assets/.
// resvg is a dev tool only (MPL-2.0), never a dependency: install it without saving, then run:
//   npm i --no-save @resvg/resvg-js@2.6.2 && node scripts/icons.mjs assets
import { Resvg } from '@resvg/resvg-js';
import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2] ?? 'assets';

/** The mark: warm core, dark gap, ivory ring, glow. ring = ring radius as a share of the canvas. */
function svg(S, { ring, bg = null, glow = true, mono = false }) {
  const c = S / 2;
  const R = ring * S;
  const core = R * 0.82;
  const stroke = Math.max(1.5, R * 0.065);
  const defs = `
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#FFDEB0" stop-opacity="0.42"/>
      <stop offset="0.4" stop-color="#FFC27A" stop-opacity="0.14"/>
      <stop offset="1" stop-color="#FFC27A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0.3" stop-color="#FFC27A" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#FFC27A" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="core" cx="50%" cy="40%" r="60%">
      <stop offset="0" stop-color="#FFFBF3"/>
      <stop offset="0.3" stop-color="#FFE9C8"/>
      <stop offset="0.72" stop-color="#FFC27A"/>
      <stop offset="1" stop-color="#F2A35E"/>
    </radialGradient>
  </defs>`;
  const parts = [];
  if (bg) parts.push(`<rect width="${S}" height="${S}" fill="${bg}"/>`);
  if (mono) {
    parts.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="#fff" stroke-width="${stroke * 1.4}"/>`);
    parts.push(`<circle cx="${c}" cy="${c}" r="${core * 0.92}" fill="#fff"/>`);
  } else {
    if (glow) {
      parts.push(`<circle cx="${c}" cy="${c}" r="${Math.min(R * 2.6, S / 2)}" fill="url(#glow)"/>`);
      parts.push(`<circle cx="${c}" cy="${c}" r="${R * 1.58}" fill="url(#halo)"/>`);
    }
    parts.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="#050506"/>`);
    parts.push(`<circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="rgba(255,246,230,0.85)" stroke-width="${stroke}"/>`);
    parts.push(`<circle cx="${c}" cy="${c}" r="${core}" fill="url(#core)"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">${defs}${parts.join('')}</svg>`;
}

function render(name, S, opts) {
  const png = new Resvg(svg(S, opts), { fitTo: { mode: 'width', value: S } }).render().asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log(name, S);
}

const GROUND = '#050506';
render('icon.png', 1024, { ring: 0.2, bg: GROUND });
// Adaptive icon: 108dp canvas, only the central 66dp circle is sure to show.
render('android-icon-foreground.png', 1024, { ring: 0.165 });
render('android-icon-background.png', 512, { ring: 0, bg: GROUND, glow: false });
render('android-icon-monochrome.png', 432, { ring: 0.165, mono: true });
render('splash-icon.png', 1024, { ring: 0.2 });
render('favicon.png', 48, { ring: 0.22, bg: GROUND });
