// Tile images into one contact sheet:  node tools/montage.mjs out.png cols img1 img2 ...
import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [out, colsArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg);
const cell = Math.floor(1900 / cols);
const html = `<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(${cols},${cell}px);width:${cell * cols}px">${
  files.map((f) => `<div style="position:relative"><img src="${pathToFileURL(path.resolve(f))}" style="width:${cell}px;display:block">
  <span style="position:absolute;left:4px;top:2px;font:12px sans-serif;color:#000;background:#fffa;padding:0 3px">${path.basename(f)}</span></div>`).join('')}</body>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cell * cols, height: 600 } });
const tmp = path.resolve(out + '.html');
(await import('node:fs')).writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href);
await page.waitForLoadState('networkidle');
(await import('node:fs')).unlinkSync(tmp);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
