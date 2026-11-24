// Records the screen part of one training video with Playwright.
// Usage: VIDEO_EMAIL=… VIDEO_PASSWORD=… node video/record.mjs s2-voorraadbewegingen [--live]
// Default is the CRM's ?demo=1 sample stock (no real writes). --live books real movements: only on the demo Supabase project.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [slug, ...flags] = process.argv.slice(2);
if (!slug) throw new Error('usage: node video/record.mjs <slug> [--live]');
const live = flags.includes('--live');
const base = process.env.VIDEO_BASE ?? 'http://127.0.0.1:3017';
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const out = `video/out/${slug}`;
mkdirSync(out, { recursive: true });
// Record outside the project: the Next.js dev server watches the project folder and reloads the page when files change in it, which wipes the form mid-take.
const scratch = mkdtempSync(join(tmpdir(), 'rec-'));

const withDemo = (url) => live ? url : url + (url.includes('?') ? '&' : '?') + 'demo=1';
// channel 'chrome': Playwright's bundled Chromium does not support macOS 12; the installed Google Chrome does.
const browser = await chromium.launch({ channel: 'chrome', slowMo: 350 });
// Warm-up: the Next.js dev server compiles each route on first visit and then reloads open pages, which wipes a half-filled form mid-take.
// Visit every page of this video once first (no recording), so nothing compiles while we film.
{
  const warm = await browser.newContext({ viewport: script.viewport });
  const wp = await warm.newPage();
  for (const scene of script.scenes) if (scene.url) {
    await wp.goto(base + withDemo(scene.url), { timeout: 240_000 }); await wp.waitForLoadState('networkidle', { timeout: 120_000 }).catch(() => {}); await wp.waitForTimeout(2500);
  }
  await warm.close();
}
// Local demo stock lives in local-data/keyforcars-stock-demo.json and persists between runs: reset it so every take starts from the same seed.
if (!live && /127\.0\.0\.1|localhost/.test(base)) {
  rmSync('local-data/keyforcars-stock-demo.json', { force: true });
  // One request seeds the file; the page's own parallel first requests would otherwise write it at the same time and corrupt it.
  await fetch(`${base}/api/admin/voorraad-local?demo=1`).then((r) => r.arrayBuffer());
  await new Promise((resolve) => setTimeout(resolve, 500));
}


const context = await browser.newContext({ viewport: script.viewport, deviceScaleFactor: 1, recordVideo: { dir: scratch, size: script.viewport }, locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
const page = await context.newPage();
// Visible cursor so the viewer can follow clicks. ponytail: a CSS dot, not a cursor library.
if (!process.env.VIDEO_BARE) await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
  const dot = Object.assign(document.createElement('div'), { id: '__cursor' });
  dot.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;background:rgba(250,204,21,.55);border:2px solid #ca8a04;pointer-events:none;transform:translate(-50%,-50%);transition:transform .08s';
  document.body.append(dot);
  document.addEventListener('mousemove', (e) => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; });
  document.addEventListener('mousedown', () => { dot.style.transform = 'translate(-50%,-50%) scale(1.6)'; });
  document.addEventListener('mouseup', () => { dot.style.transform = 'translate(-50%,-50%)'; });
}));

// Demo mode prints "· Proefvoorraad" next to the SKU and a "Voorbeeldgegevens" pill; the viewer must not see them. Never edit React's DOM
// (that resets the booking form): cover the text with fixed overlays outside the React tree instead.
if (!process.env.VIDEO_KEEP_LABEL && !process.env.VIDEO_BARE) await page.addInitScript(() => setInterval(() => {
  const boxes = [];
  const background = (start) => { let el = start, color = 'transparent'; while (el && (color === 'transparent' || color === 'rgba(0, 0, 0, 0)')) { color = getComputedStyle(el).backgroundColor; el = el.parentElement; } return color; };
  const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue;
    const at = text.indexOf(' · Proefvoorraad');
    if (at >= 0) {
      const range = document.createRange(); range.setStart(node, at); range.setEnd(node, text.length);
      boxes.push([range.getBoundingClientRect(), background(node.parentElement), 6]);
    } else if (text.trim() === 'Voorbeeldgegevens' && !node.parentElement.closest('button, a')) {
      boxes.push([node.parentElement.getBoundingClientRect(), background(node.parentElement.parentElement), 2]);
    }
  }
  const pool = document.querySelectorAll('.__mask');
  boxes.forEach(([box, color, pad], index) => {
    let mask = pool[index];
    if (!mask) { mask = document.createElement('div'); mask.className = '__mask'; mask.style.cssText = 'position:fixed;z-index:99998;pointer-events:none'; document.body?.append(mask); }
    Object.assign(mask.style, { display: 'block', left: `${box.left - 2}px`, top: `${box.top - 1}px`, width: `${box.width + pad}px`, height: `${box.height + 2}px`, background: color });
  });
  for (let index = boxes.length; index < pool.length; index++) pool[index].style.display = 'none';
}, 100));

// Cosmetics for the take (all outside React's tree or text-node-only, so forms never reset):
// hide the Next.js dev badge, show the demo account instead of the preview address, fix the label typo.
if (process.env.VIDEO_NO_SWAP) await page.addInitScript(() => { window.__noSwap = true; });
if (!process.env.VIDEO_NO_COSMETICS) await page.addInitScript(() => {
  const style = document.createElement('style');
  style.textContent = 'nextjs-portal{display:none!important}';
  const attach = () => (document.documentElement ? document.documentElement.append(style) : setTimeout(attach, 10));
  attach();
  const swaps = [['preview@example.invalid', 'demo@keyforcars.test'], ['Rallocatie', 'Locatie']];
  // start only after the page has hydrated: editing text before that makes React throw a hydration mismatch
  const seen = (() => { try { return sessionStorage.getItem('__seen') === '1'; } finally { try { sessionStorage.setItem('__seen', '1'); } catch {} } })();
  if (!window.__noSwap) setTimeout(() => setInterval(() => {
    const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
    {
      for (const [from, to] of swaps) if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
    }
  }, 150), seen ? 2000 : 4000);
});
// Shop photos come from the internet; offline they show as broken icons. Serve a neutral placeholder instead.
if (!process.env.VIDEO_NO_ROUTE) await context.route((url) => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname), (route) => route.request().resourceType() === 'image'
  ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="12" fill="#eef1f5"/><rect x="48" y="30" width="24" height="60" rx="8" fill="#c9d1db"/></svg>' })
  : route.continue());

if (process.env.VIDEO_EMAIL) {
  await page.goto(`${base}/admin/login`);
  await page.fill('input[name=email]', process.env.VIDEO_EMAIL);
  await page.fill('input[name=password]', process.env.VIDEO_PASSWORD ?? '');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

if (process.env.VIDEO_DEBUG) {
  const start = Date.now(); const at = () => ((Date.now() - start) / 1000).toFixed(1);
  page.on('framenavigated', (frame) => frame === page.mainFrame() && console.log(`[nav ${at()}s]`, frame.url()));
  page.on('console', (m) => /Fast Refresh|reload|HMR|error/i.test(m.text()) && console.log(`[console ${at()}s]`, m.text().slice(0, 120)));
  page.on('pageerror', (e) => console.log(`[pageerror ${at()}s]`, String(e).slice(0, 120)));
}
const t0 = Date.now();
const marks = [];
for (const scene of script.scenes) {
  if (scene.type) continue; // avatar/card scenes are not screen footage
  marks.push({ id: scene.id, at: (Date.now() - t0) / 1000 });
  if (scene.url) {
    await page.goto(base + withDemo(scene.url)); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
    // Stock page: the form is rebuilt once stock and catalogue have loaded, wiping anything typed before. Wait for the save button to exist AND be enabled.
    if (scene.url.startsWith('/admin/voorraad') && !scene.url.includes('view=')) {
      await page.locator('button:has-text("Beweging opslaan")').first().waitFor({ state: 'attached', timeout: 90_000 }).catch(() => {});
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Beweging opslaan')); return !!b && !b.disabled; }, null, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (page.url().includes('/admin/login')) throw new Error(`redirected to login at scene "${scene.id}": set VIDEO_EMAIL and VIDEO_PASSWORD`);
  }
  for (const step of scene.steps ?? []) {
   try {
    if (process.env.VIDEO_DEBUG && step.click?.includes('Beweging opslaan')) await page.screenshot({ path: `${out}/before-save-${scene.id}.png` });
    if (step.click) { await page.locator(step.click).first().hover(); await page.waitForTimeout(400); await page.locator(step.click).first().click(); }
    else if (step.fill) { const field = page.locator(step.fill[0]).first(); await field.click(); await field.fill(''); await field.pressSequentially(step.fill[1], { delay: 60 }); } // fill('') first: fields can be prefilled with the current bin
    else if (step.select) await page.locator(step.select[0]).first().selectOption(step.select[1]);
    else if (step.wait) await page.waitForTimeout(step.wait);
    if (step.click?.includes('Beweging opslaan')) { await page.waitForTimeout(900); const note = (await page.locator('body').innerText()).split('\n').filter((l) => /Voorraadbeweging opgeslagen|mislukt|Controleer artikel|Onvoldoende|Tel de |Tel deze|Dit artikel|Kies een/.test(l)).slice(0, 2).join(' | '); const invalid = await page.evaluate(() => [...document.querySelectorAll('form input:invalid, form select:invalid')].map((i) => `${i.name}="${i.value}" ${i.validationMessage}`).join('; ')); console.log(`[${scene.id}] ${note || '(no notice)'}${invalid ? ' INVALID: ' + invalid : ''}`); }
    await page.waitForTimeout(500);
   } catch (error) { await page.screenshot({ path: `${out}/fail-${scene.id}.png` }); throw error; }
  }
}
marks.push({ id: 'end', at: (Date.now() - t0) / 1000 });
const video = page.video();
await context.close();
await browser.close();
copyFileSync(await video.path(), `${out}/screen.webm`);
rmSync(scratch, { recursive: true, force: true });
writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 2));
console.log(`screen.webm + marks.json → ${out}`, marks);
