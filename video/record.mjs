// Records the screen part of one training video with Playwright.
// Usage: VIDEO_EMAIL=… VIDEO_PASSWORD=… node video/record.mjs s2-voorraadbewegingen [--live]
// Default is the CRM's ?demo=1 sample stock (no real writes). --live books real movements: only on the demo Supabase project.
//
// Output in video/out/<slug>/: screen.webm, marks.json (scene → second) and clicks.json (every click: second, x, y, scene),
// which the assembly uses for the zoom and the click sound.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [slug, ...flags] = process.argv.slice(2);
if (!slug) throw new Error('usage: node video/record.mjs <slug> [--live]');
const live = flags.includes('--live');
const base = process.env.VIDEO_BASE ?? 'http://127.0.0.1:3017';
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const brand = { purple: '#541554', purpleHover: '#421043', lilac: '#ead7eb', ...script.brand };
const out = `video/out/${slug}`;
mkdirSync(out, { recursive: true });
// Record outside the project: the Next.js dev server watches the project folder and reloads the page when files change in it, which wipes the form mid-take.
const scratch = mkdtempSync(join(tmpdir(), 'rec-'));

const withDemo = (url) => live ? url : url + (url.includes('?') ? '&' : '?') + 'demo=1';
// channel 'chrome': Playwright's bundled Chromium does not support macOS 12; the installed Google Chrome does.
const browser = await chromium.launch({ channel: 'chrome' });

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

// Everything we add to the page lives outside React's tree (fixed overlays, a style tag) or edits text nodes only after hydration,
// because touching React's DOM resets the booking form.
await page.addInitScript((b) => {
  // --- style: hide the Next.js dev badge, recolour the CRM accent to the brand purple ---
  const style = document.createElement('style');
  style.textContent = `
    nextjs-portal{display:none!important}
    html body.kfc-shell,html:root{--primary:${b.purple};--primary-foreground:#fff;--ring:${b.purple};--chart-1:${b.purple};--sidebar-primary:${b.purple};--sidebar-primary-foreground:#fff;
      --crm-accent:${b.purple};--crm-accent-hover:${b.purpleHover};--crm-accent-soft:${b.lilac}}
    #__cursor{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:72px;height:72px;margin:0;opacity:0;will-change:transform;
      filter:drop-shadow(0 4px 6px rgba(0,0,0,.35));transition:opacity .15s}
    #__cursor svg{display:block;transform-origin:6px 4px;transition:transform .09s ease-out}
    #__cursor.down svg{transform:scale(.82)}
    .__ripple{position:fixed;z-index:2147483646;pointer-events:none;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;
      border:5px solid ${b.purple};background:${b.purple}33;animation:__ripple .65s ease-out forwards}
    @keyframes __ripple{from{transform:scale(.4);opacity:.95}to{transform:scale(3.4);opacity:0}}`;
  const attach = () => (document.documentElement ? document.documentElement.append(style) : setTimeout(attach, 10));
  attach();

  // --- cursor: a large arrow in the brand colour with a white outline (hotspot = the tip) ---
  document.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.innerHTML = `<svg width="72" height="72" viewBox="0 0 72 72"><path d="M6 4 L6 52 L18 41 L26 60 L35 56 L27 38 L44 38 Z" fill="${b.purple}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`;
    document.documentElement.append(cursor);
    document.addEventListener('mousemove', (e) => { cursor.style.opacity = '1'; cursor.style.transform = `translate(${e.clientX - 6}px,${e.clientY - 4}px)`; }, true);
    document.addEventListener('mousedown', (e) => {
      cursor.classList.add('down');
      const ring = document.createElement('div'); ring.className = '__ripple'; ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px';
      document.documentElement.append(ring); setTimeout(() => ring.remove(), 800);
    }, true);
    document.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
  });

  // --- demo-mode labels: cover "· Proefvoorraad" and the "Voorbeeldgegevens" pill with overlays ---
  setInterval(() => {
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
      if (!mask) { mask = document.createElement('div'); mask.className = '__mask'; mask.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none'; document.documentElement.append(mask); }
      Object.assign(mask.style, { display: 'block', left: `${box.left - 2}px`, top: `${box.top - 1}px`, width: `${box.width + pad}px`, height: `${box.height + 2}px`, background: color });
    });
    for (let index = boxes.length; index < pool.length; index++) pool[index].style.display = 'none';
  }, 100);

  // --- text swaps, only after hydration: the demo account, the label typo, the customer's name becomes the brand's ---
  const swaps = [['preview@example.invalid', 'demo@key24.nl'], ['demo@keyforcars.test', 'demo@key24.nl'], ['Rallocatie', 'Locatie'], ['KeyForCars', 'Key24']];
  const seen = (() => { try { return sessionStorage.getItem('__seen') === '1'; } finally { try { sessionStorage.setItem('__seen', '1'); } catch {} } })();
  setTimeout(() => setInterval(() => {
    const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      for (const [from, to] of swaps) if (node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.replace(from, to);
  }, 150), seen ? 2000 : 4000);
}, brand);

// Shop photos come from the internet; offline they show as broken icons. Serve a neutral placeholder instead.
await context.route((url) => !/^(127\.0\.0\.1|localhost)$/.test(url.hostname), (route) => route.request().resourceType() === 'image'
  ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="12" fill="#eef1f5"/><rect x="48" y="30" width="24" height="60" rx="8" fill="#c9d1db"/></svg>' })
  : route.continue());

if (process.env.VIDEO_EMAIL) {
  await page.goto(`${base}/admin/login`);
  await page.fill('input[name=email]', process.env.VIDEO_EMAIL);
  await page.fill('input[name=password]', process.env.VIDEO_PASSWORD ?? '');
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 20_000 });
}

const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const marks = [];
const clicks = [];
let cursor = { x: script.viewport.width * 0.55, y: script.viewport.height * 0.5 };

// The cursor glides to its target (eased, ~0.6 s) so the viewer can follow it, then a click is logged (second, x, y) for zoom and sound.
async function glide(x, y, ms = 650) {
  const steps = Math.max(12, Math.round(ms / 16));
  const from = cursor;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps, e = u < 0.5 ? 4 * u ** 3 : 1 - ((-2 * u + 2) ** 3) / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(16);
  }
  cursor = { x, y };
}
async function target(selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 60_000 });
  await loc.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await loc.boundingBox();
  return { loc, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function press(sceneId, x, y, real = true) {
  await page.waitForTimeout(180);
  clicks.push({ t: now(), x: Math.round(x), y: Math.round(y), scene: sceneId });
  if (real) { await page.mouse.down(); await page.waitForTimeout(70); await page.mouse.up(); }
}

for (const scene of script.scenes) {
  if (scene.type) continue; // avatar/card scenes are not screen footage
  marks.push({ id: scene.id, at: now() });
  if (scene.url) {
    await page.goto(base + withDemo(scene.url)); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
    // Stock page: the form is rebuilt once stock and catalogue have loaded, wiping anything typed before. Wait for the save button to exist AND be enabled.
    if (scene.url.startsWith('/admin/voorraad') && !scene.url.includes('view=')) {
      await page.locator('button:has-text("Beweging opslaan")').first().waitFor({ state: 'attached', timeout: 90_000 }).catch(() => {});
      await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('Beweging opslaan')); return !!b && !b.disabled; }, null, { timeout: 90_000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
    if (page.url().includes('/admin/login')) throw new Error(`redirected to login at scene "${scene.id}": set VIDEO_EMAIL and VIDEO_PASSWORD`);
    await page.mouse.move(cursor.x, cursor.y); // a new document has no cursor until the mouse moves
  }
  for (const step of scene.steps ?? []) {
    try {
      if (step.click) {
        const { loc, x, y } = await target(step.click);
        await glide(x, y);
        if (step.click.includes('Beweging opslaan')) await page.waitForFunction((el) => !el.disabled, await loc.elementHandle(), { timeout: 20_000 });
        await press(scene.id, x, y);
      } else if (step.fill) {
        const { loc, x, y } = await target(step.fill[0]);
        await glide(x, y);
        await press(scene.id, x, y);
        await loc.fill(''); // fields can be prefilled with the current bin
        await loc.pressSequentially(step.fill[1], { delay: 70 });
      } else if (step.select) {
        const { loc, x, y } = await target(step.select[0]);
        await glide(x, y);
        await press(scene.id, x, y, false); // a native dropdown would not render in the video: change it directly
        await loc.selectOption(step.select[1]);
      } else if (step.chooseFile) { // [button selector, file]: the button opens the file picker, answer it with a prepared photo
        const { loc, x, y } = await target(step.chooseFile[0]);
        await glide(x, y);
        await press(scene.id, x, y, false);
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), loc.click()]);
        await chooser.setFiles(step.chooseFile[1]);
      } else if (step.scrollTop) { await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' })); await page.waitForTimeout(900);
      } else if (step.wait) await page.waitForTimeout(step.wait);
      if (step.click?.includes('Beweging opslaan')) {
        await page.waitForTimeout(900);
        const note = (await page.locator('body').innerText()).split('\n').filter((l) => /Voorraadbeweging opgeslagen|mislukt|Controleer artikel|Onvoldoende|Tel de |Tel deze|Dit artikel|Kies een/.test(l)).slice(0, 2).join(' | ');
        console.log(`[${scene.id}] ${note || '(no notice)'}`);
      }
      await page.waitForTimeout(450);
    } catch (error) { await page.screenshot({ path: `${out}/fail-${scene.id}.png` }); throw error; }
  }
}
marks.push({ id: 'end', at: now() });
const video = page.video();
await context.close();
await browser.close();
copyFileSync(await video.path(), `${out}/screen.webm`);
rmSync(scratch, { recursive: true, force: true });
writeFileSync(`${out}/marks.json`, JSON.stringify(marks, null, 2));
writeFileSync(`${out}/clicks.json`, JSON.stringify(clicks, null, 2));
console.log(`screen.webm + marks.json + clicks.json → ${out}`, marks.map((m) => `${m.id}@${m.at.toFixed(1)}`).join(' '), `clicks:${clicks.length}`);
