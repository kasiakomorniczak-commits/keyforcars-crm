// Records the screen part of one training video with Playwright.
// Usage: VIDEO_EMAIL=… VIDEO_PASSWORD=… node video/record.mjs s2-voorraadbewegingen [--live]
// Default is the CRM's ?demo=1 sample stock (no real writes). --live books real movements: only on the demo Supabase project.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';

const [slug, ...flags] = process.argv.slice(2);
if (!slug) throw new Error('usage: node video/record.mjs <slug> [--live]');
const live = flags.includes('--live');
const base = process.env.VIDEO_BASE ?? 'http://127.0.0.1:3017';
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const out = `video/out/${slug}`;
mkdirSync(out, { recursive: true });

// Local demo stock lives in local-data/keyforcars-stock-demo.json and persists between runs: reset it so every take starts from the same seed.
if (!live && /127\.0\.0\.1|localhost/.test(base)) {
  rmSync('local-data/keyforcars-stock-demo.json', { force: true });
  // One request seeds the file; the page's own parallel first requests would otherwise write it at the same time and corrupt it.
  await fetch(`${base}/api/admin/voorraad-local?demo=1`).then((r) => r.arrayBuffer());
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const withDemo = (url) => live ? url : url + (url.includes('?') ? '&' : '?') + 'demo=1';
// channel 'chrome': Playwright's bundled Chromium does not support macOS 12; the installed Google Chrome does.
const browser = await chromium.launch({ channel: 'chrome', slowMo: 350 });
const context = await browser.newContext({ viewport: script.viewport, deviceScaleFactor: 1, recordVideo: { dir: out, size: script.viewport }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
const page = await context.newPage();
// Visible cursor so the viewer can follow clicks. ponytail: a CSS dot, not a cursor library.
await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  const dot = Object.assign(document.createElement('div'), { id: '__cursor' });
  dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;background:rgba(250,204,21,.55);border:2px solid #ca8a04;pointer-events:none;transform:translate(-50%,-50%);transition:transform .08s';
  document.body.append(dot);
  document.addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
  document.addEventListener('mousedown', () => { dot.style.transform = 'translate(-50%,-50%) scale(1.6)'; });
  document.addEventListener('mouseup', () => { dot.style.transform = 'translate(-50%,-50%)'; });
}));

// Demo mode prints "· Proefvoorraad" next to the SKU; the viewer must not see it. Never edit React's DOM (that resets the booking form):
// cover the text with a fixed overlay outside the React tree instead.
if (!process.env.VIDEO_KEEP_LABEL) await page.addInitScript(() => setInterval(() => {
  let mask = document.getElementById('__mask');
  if (!mask) { mask = Object.assign(document.createElement('div'), { id: '__mask' }); mask.style.cssText = 'position:fixed;z-index:99998;pointer-events:none;display:none'; document.body?.append(mask); }
  for (const small of document.querySelectorAll('small')) for (const node of small.childNodes) {
    const at = node.nodeType === 3 ? node.nodeValue.indexOf(' · Proefvoorraad') : -1;
    if (at < 0) continue;
    const range = document.createRange(); range.setStart(node, at); range.setEnd(node, node.nodeValue.length);
    const box = range.getBoundingClientRect();
    let el = small, color = 'transparent';
    while (el && (color === 'transparent' || color === 'rgba(0, 0, 0, 0)')) { color = getComputedStyle(el).backgroundColor; el = el.parentElement; }
    Object.assign(mask.style, { display: 'block', left: `${box.left - 2}px`, top: `${box.top - 1}px`, width: `${box.width + 6}px`, height: `${box.height + 2}px`, background: color });
    return;
  }
  mask.style.display = 'none';
}, 100));

if (process.env.VIDEO_EMAIL) {
  await page.goto(`${base}/admin/login`);
  await page.fill('input[name=email]', process.env.VIDEO_EMAIL);
  await page.fill('input[name=password]', process.env.VIDEO_PASSWORD ?? '');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

const t0 = Date.now();
const marks = [];
for (const scene of script.scenes) {
  if (scene.type) continue; // avatar/card scenes are not screen footage
  marks.push({ id: scene.id, at: (Date.now() - t0) / 1000 });
  if (scene.url) {
    await page.goto(base + withDemo(scene.url)); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
    // Stock page: the save button stays disabled until the full catalogue has loaded.
    if (scene.url.startsWith('/admin/voorraad')) await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Beweging opslaan')); return !b || !b.disabled; }, null, { timeout: 90_000 }).catch(() => {});
    if (page.url().includes('/admin/login')) throw new Error(`redirected to login at scene "${scene.id}": set VIDEO_EMAIL and VIDEO_PASSWORD`);
  }
  for (const step of scene.steps ?? []) {
   try {
    if (step.click) { await page.locator(step.click).first().hover(); await page.waitForTimeout(400); await page.locator(step.click).first().click(); }
    else if (step.fill) { const field = page.locator(step.fill[0]).first(); await field.click(); await field.fill(''); await field.pressSequentially(step.fill[1], { delay: 60 }); } // fill('') first: fields can be prefilled with the current bin
    else if (step.select) await page.locator(step.select[0]).first().selectOption(step.select[1]);
    else if (step.wait) await page.waitForTimeout(step.wait);
    if (step.click?.includes('Beweging opslaan')) { await page.waitForTimeout(900); const note = (await page.locator('body').innerText()).split('\n').filter((l) => /opgeslagen|mislukt|Controleer|Tel |Onvoldoende|Kies /i.test(l)).slice(0, 2).join(' | '); const invalid = await page.evaluate(() => [...document.querySelectorAll('form input:invalid, form select:invalid')].map((i) => `${i.name}="${i.value}" ${i.validationMessage}`).join('; ')); console.log(`[${scene.id}] ${note || '(no notice)'}${invalid ? ' INVALID: ' + invalid : ''}`); }
    await page.waitForTimeout(500);
   } catch (error) { await page.screenshot({ path: `${out}/fail-${scene.id}.png` }); throw error; }
  }
}
marks.push({ id: 'end', at: (Date.now() - t0) / 1000 });
const video = page.video();
await context.close();
await browser.close();
renameSync(await video.path(), `${out}/screen.webm`);
writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 2));
console.log(`screen.webm + marks.json → ${out}`, marks);
