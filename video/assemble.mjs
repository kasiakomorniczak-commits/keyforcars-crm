// Builds the finished video in the Key24 template.
//   intro   : the avatar clip, with the logo popping in next to her when she starts to speak
//   screens : the CRM recording slowed to the voice-over, a big-arrow cursor (recorded), zoom into every click, a click sound,
//             the Key24 plate over the CRM's own logo, the step number under it
//   cards   : animated, in the brand's editorial style (cream paper, big numerals, purple rules)
//   outro   : the avatar clip, then the Key24 logotype
//   captions: brand purple with a white outline, no dark shade
// Usage: node video/assemble.mjs <slug> <lang>   → video/out/<slug>/<slug>-<lang>.mp4
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';

const [slug, lang = 'nl'] = process.argv.slice(2);
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const out = `video/out/${slug}`, media = `${out}/${lang}`, tmp = resolve(`${out}/${lang}/tmp`);
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
const marks = JSON.parse(readFileSync(`${out}/marks.json`, 'utf8'));
const clicksAll = existsSync(`${out}/clicks.json`) ? JSON.parse(readFileSync(`${out}/clicks.json`, 'utf8')) : [];
const text = (o) => o[lang] ?? o.nl; // missing translation falls back to Dutch
const W = script.viewport.width, H = script.viewport.height, FPS = 30;
// Key24 brand (key24rework v2): aubergine purple, cream paper, IBM Plex Sans. The logo is the plain wordmark.
const brand = { name: 'KEY24', purple: '#541554', purpleDark: '#421043', cream: '#f4ede4', paper: '#faf7f2', lilac: '#ead7eb', ink: '#1d1c1d', grey: '#615a62', ...script.brand };
const FONTS = resolve('video/assets/fonts');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const norm = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'];
const pad4 = (n) => String(n).padStart(4, '0');

// ---------- HTML → PNG/JPG frames ----------
const fontCss = [['Regular', 400], ['Medium', 500], ['SemiBold', 600], ['Bold', 700]]
  .map(([name, weight]) => `@font-face{font-family:'IBM Plex Sans';font-weight:${weight};src:url('file://${FONTS}/IBMPlexSans-${name}.ttf')}`).join('');
const baseCss = (transparent) => `${fontCss}
  html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'IBM Plex Sans',system-ui,sans-serif;color:${brand.ink};${transparent ? 'background:transparent;' : ''}}
  .wm{font-weight:700;letter-spacing:-.04em;line-height:1;color:${brand.purple}}`;
const browser = await chromium.launch({ channel: 'chrome' });
let pageNo = 0;
async function openPage(html, transparent) {
  const file = join(tmp, `page${++pageNo}.html`);
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${baseCss(transparent)}</style>${html}`);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto('file://' + file);
  await page.evaluate(() => document.fonts.ready);
  return page;
}
// One still (a plate, a tag).
async function still(html, file) {
  const page = await openPage(html, true);
  await page.screenshot({ path: file, omitBackground: true }); await page.close();
}
// Animation → numbered frames. Every CSS animation is paused and stepped to the frame's time, so the result is exact.
async function frames(name, html, seconds, { transparent = false } = {}) {
  const dir = join(tmp, name); mkdirSync(dir, { recursive: true });
  const page = await openPage(html, transparent);
  await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
  const count = Math.ceil(seconds * FPS), ext = transparent ? 'png' : 'jpg';
  for (let i = 0; i < count; i++) {
    await page.evaluate((ms) => document.getAnimations().forEach((a) => { a.currentTime = ms; }), (i * 1000) / FPS);
    await page.screenshot(transparent ? { path: join(dir, `f${pad4(i)}.png`), omitBackground: true } : { path: join(dir, `f${pad4(i)}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.close();
  return { pattern: join(dir, `f%04d.${ext}`), count };
}

const paper = `background:${brand.cream} repeating-linear-gradient(90deg,transparent 0 119px,rgba(29,28,29,.045) 119px 120px);`;
const rise = (delay, d = 0.6) => `animation:rise ${d}s cubic-bezier(.2,.8,.2,1) ${delay.toFixed(2)}s both`;
const keyframes = `@keyframes rise{from{opacity:0;transform:translateY(34px)}to{opacity:1;transform:none}}
  @keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes sweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes pop{from{opacity:0;transform:translateX(110px) scale(.72)}to{opacity:1;transform:none}}`;

// ---------- cards ----------
// Text card: the heading, then each item (huge purple numeral + sentence) appears when the voice reaches it.
async function textCard(scene, seconds) {
  const heading = text({ nl: scene.heading ?? '', ...(scene.headingEn ? { en: scene.headingEn } : {}) }) || '';
  const items = (lang === 'en' && scene.itemsEn) ? scene.itemsEn : scene.items;
  const sentences = [heading, ...items], total = sentences.join('').length;
  let acc = 0; const at = sentences.map((s) => { const t = 0.25 + (seconds - 1.6) * (acc / total); acc += s.length; return t; });
  const rows = items.map((s, i) => `<div style="display:grid;grid-template-columns:200px 1fr;align-items:center;height:190px;border-top:2px solid ${brand.ink}22;${rise(at[i + 1])}">
      <div style="position:relative"><div class="wm" style="font-size:170px;letter-spacing:-.06em">${i + 1}</div>
        <div style="position:absolute;left:0;bottom:6px;width:120px;height:8px;background:${brand.purple};transform-origin:left;animation:sweep .5s ease-out ${(at[i + 1] + 0.35).toFixed(2)}s both"></div></div>
      <div style="font-size:46px;line-height:1.28;font-weight:500;max-width:1240px">${s}</div></div>`).join('');
  const html = `<style>${keyframes}</style><div style="${paper}position:absolute;inset:0;padding:70px 120px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${brand.ink};padding-bottom:22px">
      <div class="wm" style="font-size:38px">${brand.name}</div>
      <div style="font-size:17px;letter-spacing:.22em;color:${brand.grey};font-weight:500">${text(script.title).toUpperCase()}</div></div>
    <div style="font-size:92px;line-height:1.05;font-weight:700;letter-spacing:-.035em;margin:60px 0 44px;max-width:1500px;${rise(at[0])}">${heading}</div>
    ${rows}</div>`;
  const lastStart = Math.min(seconds, at[at.length - 1] + 1.2);
  return { ...(await frames(`card-${scene.id}`, html, lastStart)), animEnd: lastStart };
}
// Closing card: the logotype, letter by letter, a purple rule, then the line about the next video.
async function endCard(scene, seconds) {
  const letters = [...brand.name].map((c, i) => `<span style="display:inline-block;${rise(0.15 + i * 0.09, 0.55)}">${c}</span>`).join('');
  const html = `<style>${keyframes}</style><div style="${paper}position:absolute;inset:0;display:grid;place-items:center;text-align:center">
    <div><div class="wm" style="font-size:300px;letter-spacing:-.05em">${letters}</div>
      <div style="width:100%;height:12px;background:${brand.purple};margin:10px 0 40px;transform-origin:left;animation:sweep .7s ease-out .8s both"></div>
      <div style="font-size:40px;font-weight:500;color:${brand.grey};animation:fade .6s ease-out 1.5s both">${text(scene)}</div></div></div>`;
  return frames(`end-${scene.id}`, html, seconds);
}

// Phone scene: a phone mockup shows how scanning works (tap Scan, aim at the label, the item opens), beside the numbered steps.
// Everything is drawn here (no footage), so it needs no camera: the label photo is video/assets/labels/<scene.label>.
async function phoneScene(scene, seconds) {
  const T = seconds, at = (f) => (T * f).toFixed(2);
  const steps = (lang === 'en' && scene.stepsEn) ? scene.stepsEn : scene.steps;
  const heading = (lang === 'en' && scene.headingEn) ? scene.headingEn : (scene.heading ?? '');
  const ui = (lang === 'en' ? scene.uiEn : scene.ui) ?? scene.ui ?? {};
  const label = 'file://' + resolve(`video/assets/labels/${scene.label}`);
  const bulk = scene.variant === 'bulk';
  const shelf = bulk ? 'file://' + resolve(`video/assets/labels/${scene.photo}`) : '';
  const hide = bulk ? 'display:none;' : '';
  const bulkCam = !bulk ? '' : `<div style="position:absolute;left:0;right:0;top:110px;height:589px;overflow:hidden;animation:inA .5s ease ${at(0.24)}s both">
      <img src="${shelf}" style="width:100%;height:100%;display:block">
      ${(scene.boxes ?? []).map((b, k) => `<div style="position:absolute;left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;box-sizing:border-box;border:5px solid ${brand.purple};border-radius:8px;box-shadow:0 0 0 2px #fff inset;animation:lock .3s ease-out ${at(0.40 + 0.07 * k)}s both"><span style="position:absolute;left:-5px;top:-34px;background:${brand.purple};color:#fff;font-size:20px;font-weight:700;padding:3px 12px;border-radius:8px 8px 8px 0">${k + 1}</span></div>`).join('')}
      <div style="position:absolute;left:0;right:0;height:5px;background:${brand.purple};box-shadow:0 0 28px 8px ${brand.purple};border-radius:3px;animation:scanLine ${(T * 0.24).toFixed(2)}s ease-in-out ${at(0.34)}s both"></div></div>`;
  const bulkRes = !bulk ? '' : `<div style="margin-top:22px;border:2px solid ${brand.purple};border-radius:16px;background:#fff;padding:20px 22px;animation:cardUp .6s cubic-bezier(.2,.8,.2,1) ${at(0.78)}s both">
      ${(scene.result ?? []).map((r) => `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:12px 0;border-bottom:1px solid #e6e1e7"><div style="font-size:26px;font-weight:700">${r.code}</div><div style="font-size:30px;font-weight:700;color:${brand.purple}">${r.qty}×</div></div>`).join('')}
      <div style="margin-top:20px;height:58px;border-radius:12px;background:${brand.purple};color:#fff;font-size:21px;font-weight:600;display:grid;place-items:center">${ui.book ?? 'Telling opslaan'}</div></div>`;
  const stepAt = [0.04, 0.26, 0.70];
  const rows = steps.map((s, i) => `<div style="display:grid;grid-template-columns:150px 1fr;align-items:center;min-height:170px;border-top:2px solid ${brand.ink}22;${rise(T * stepAt[i], 0.6)}">
      <div style="position:relative"><div class="wm" style="font-size:130px;letter-spacing:-.06em">${i + 1}</div>
        <div style="position:absolute;left:0;bottom:4px;width:90px;height:7px;background:${brand.purple};transform-origin:left;animation:sweep .5s ease-out ${(T * stepAt[i] + 0.35).toFixed(2)}s both"></div></div>
      <div style="font-size:42px;line-height:1.25;font-weight:500">${s}</div></div>`).join('');
  const sb = `<div style="display:flex;justify-content:space-between;padding:22px 34px 0;font-size:17px;font-weight:600"><span>9:41</span><span>●●● ▮</span></div>`;
  const bar = `<div style="display:flex;align-items:center;gap:10px;padding:18px 26px 12px"><div class="wm" style="font-size:26px">${brand.name}</div><span style="font-size:14px;color:${brand.grey};letter-spacing:.2em">CRM</span></div>`;
  const css = `${keyframes}
    @keyframes phoneIn{from{opacity:0;transform:translateY(60px) scale(.76)}to{opacity:1;transform:scale(.8)}}
    @keyframes outA{from{opacity:1}to{opacity:0}}
    @keyframes inA{from{opacity:0}to{opacity:1}}
    @keyframes tap{0%{transform:scale(.2);opacity:.75}100%{transform:scale(2.4);opacity:0}}
    @keyframes press{0%,100%{transform:none}50%{transform:scale(.95)}}
    @keyframes slideLabel{from{opacity:0;transform:translateY(160px) rotate(-9deg) scale(.85)}to{opacity:1;transform:translateY(0) rotate(-3deg) scale(1)}}
    @keyframes scanLine{from{top:8%}to{top:88%}}
    @keyframes lock{from{opacity:0;transform:scale(1.25)}to{opacity:1;transform:none}}
    @keyframes cam{0%,${(22).toFixed(1)}%{opacity:0}${(22 + 400 / (T * 10)).toFixed(2)}%,${(72).toFixed(1)}%{opacity:1}${(72 + 400 / (T * 10)).toFixed(2)}%,100%{opacity:0}}
    @keyframes cardUp{from{opacity:0;transform:translateY(90px)}to{opacity:1;transform:none}}`;
  const html = `<style>${css}</style><div style="${paper}position:absolute;inset:0;padding:70px 120px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid ${brand.ink};padding-bottom:22px">
      <div class="wm" style="font-size:38px">${brand.name}</div>
      <div style="font-size:17px;letter-spacing:.22em;color:${brand.grey};font-weight:500">${text(script.title).toUpperCase()}</div></div>
    <div style="position:absolute;left:120px;top:210px;width:900px">
      <div style="font-size:84px;line-height:1.05;font-weight:700;letter-spacing:-.035em;margin-bottom:34px;${rise(0.1)}">${heading}</div>${rows}</div>
    <div style="position:absolute;left:1330px;top:175px;width:470px;height:960px;transform:scale(.8);transform-origin:0 0;border-radius:70px;background:${brand.ink};padding:14px;box-sizing:border-box;box-shadow:0 40px 90px rgba(84,21,84,.28),0 0 0 3px #3a393a inset;animation:phoneIn .8s cubic-bezier(.2,.8,.2,1) .15s both">
      <div style="position:absolute;left:50%;top:26px;width:130px;height:34px;margin-left:-65px;border-radius:20px;background:#000;z-index:9"></div>
      <div style="position:relative;width:100%;height:100%;border-radius:58px;overflow:hidden;background:#fff">
        <!-- 1: CRM on the phone -->
        <div style="position:absolute;inset:0;background:#fafafa;animation:outA .4s ease ${at(0.22)}s both">
          ${sb}${bar}
          <div style="padding:6px 26px"><div style="font-size:40px;font-weight:700;letter-spacing:-.03em">${ui.title ?? 'Artikelen'}</div>
            <div style="margin-top:18px;height:58px;border:2px solid #d9d4da;border-radius:12px;background:#fff;display:flex;align-items:center;padding:0 18px;color:#8a838b;font-size:19px">${ui.search ?? 'Zoek op artikel, SKU of locatie'}</div>
            <div style="position:relative;margin-top:18px;height:64px;border-radius:12px;background:${brand.purple};color:#fff;font-size:22px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;animation:press .35s ease ${at(0.12)}s both">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/></svg>${ui.scan ?? 'Scan QR / barcode'}
              <span style="position:absolute;left:50%;top:50%;width:60px;height:60px;margin:-30px;border-radius:50%;background:${brand.lilac};animation:tap .7s ease-out ${at(0.12)}s both"></span></div>
            <div style="margin-top:22px;border:2px solid #e6e1e7;border-radius:14px;background:#fff;padding:16px 18px"><div style="font-size:19px;font-weight:600">${ui.item ?? '147 GT 3knops klapsleutel'}</div><div style="margin-top:6px;font-size:16px;color:${brand.grey}">ALRK03</div></div></div></div>
        <!-- 2: camera -->
        <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 45%,#3a3238,#121012);animation:cam ${T.toFixed(2)}s linear 0s both">
          ${sb.replace('font-size:17px', 'font-size:17px;color:#fff')}
          <div style="${hide}position:absolute;left:44px;right:44px;top:250px;height:330px">
            <div style="position:absolute;inset:0;display:grid;place-items:center;animation:slideLabel .8s cubic-bezier(.2,.8,.2,1) ${at(0.26)}s both"><img src="${label}" style="width:330px;border-radius:6px;box-shadow:0 14px 40px rgba(0,0,0,.5)"></div>
            ${['0 0 auto auto', '0 auto auto 0', 'auto 0 0 auto', 'auto auto 0 0'].map((c, k) => { const [t, r, b, l] = c.split(' '); return `<div style="position:absolute;top:${t === 'auto' ? 'auto' : 0};right:${r === 'auto' ? 'auto' : 0};bottom:${b === 'auto' ? 'auto' : 0};left:${l === 'auto' ? 'auto' : 0};width:54px;height:54px;border:6px solid #fff;border-radius:6px;${t !== 'auto' ? 'border-bottom:0;' : 'border-top:0;'}${l !== 'auto' ? 'border-right:0;' : 'border-left:0;'}"></div>`; }).join('')}
            <div style="position:absolute;left:-10px;right:-10px;height:5px;background:${brand.purple};box-shadow:0 0 28px 8px ${brand.purple};border-radius:3px;animation:scanLine ${(T * 0.24).toFixed(2)}s ease-in-out ${at(0.36)}s both"></div></div>
          ${bulkCam}
          <div style="position:absolute;left:0;right:0;margin:0 auto;width:max-content;top:${bulk ? 770 : 660}px;padding:14px 26px;border-radius:30px;background:${brand.purple};color:#fff;font-size:24px;font-weight:600;white-space:nowrap;animation:lock .35s ease-out ${at(0.62)}s both">✓ ${ui.read ?? 'Code gelezen'}</div>
          <div style="position:absolute;left:0;right:0;bottom:70px;text-align:center;color:#d9d0d8;font-size:20px">${ui.aim ?? 'Richt de camera op het etiket'}</div></div>
        <!-- 3: result -->
        <div style="position:absolute;inset:0;background:#fafafa;animation:inA .4s ease ${at(0.72)}s both">
          ${sb}${bar}
          <div style="padding:6px 26px">
            <div style="padding:14px 18px;border-radius:12px;background:${brand.lilac};color:${brand.purpleDark};font-size:22px;font-weight:600;${rise(T * 0.74, 0.5)}">${ui.scanned ?? 'Gescand'}: ${ui.code ?? 'ALRK03'}</div>
            <div style="${hide}margin-top:22px;border:2px solid ${brand.purple};border-radius:16px;background:#fff;padding:22px;${`animation:cardUp .6s cubic-bezier(.2,.8,.2,1) ${at(0.78)}s both`}">
              <div style="font-size:34px;font-weight:700;letter-spacing:-.02em">ALRK03</div>
              <div style="margin-top:8px;font-size:21px;line-height:1.3">${ui.item ?? '147 GT 3knops klapsleutel'}</div>
              <div style="margin-top:18px;font-size:19px;color:${brand.grey}">${ui.location ?? 'Locatie'}: A-03-02 / DEMO-2 · 20 st.</div>
              <div style="margin-top:22px;height:58px;border-radius:12px;background:${brand.purple};color:#fff;font-size:21px;font-weight:600;display:grid;place-items:center">${ui.book ?? 'Beweging boeken'}</div></div>${bulkRes}</div></div>
      </div></div></div>`;
  return frames(`phone-${scene.id}`, html, seconds);
}
// Intro overlay: the logo pops in beside her, a rule sweeps under it, then the video's title.
async function introOverlay(seconds) {
  const html = `<style>${keyframes}</style>
    <div style="position:absolute;left:1210px;top:170px;width:590px;animation:pop .75s cubic-bezier(.2,1.35,.4,1) .15s both;transform-origin:left center">
      <div style="background:${brand.purple};border-radius:20px;padding:46px 52px 40px;box-shadow:0 22px 48px rgba(0,0,0,.30)">
        <div class="wm" style="font-size:150px;color:#fff">${brand.name}</div>
        <div style="height:8px;background:${brand.lilac};margin-top:26px;transform-origin:left;animation:sweep .6s ease-out .8s both"></div></div>
      <div style="margin-top:22px;background:#fff;border-radius:12px;padding:18px 28px;font-size:34px;font-weight:600;color:${brand.purple};box-shadow:0 12px 30px rgba(0,0,0,.22);animation:rise .6s cubic-bezier(.2,.8,.2,1) 1.2s both">${text(script.title)}</div></div>`;
  return frames('intro-overlay', html, seconds, { transparent: true });
}

// ---------- stills ----------
// Over the CRM's own header, so the customer's name is replaced by the brand's.
const plate = join(tmp, 'plate.png');
await still(`<div style="position:absolute;left:10px;top:12px;width:236px;height:56px;background:#fafafa;border-radius:10px;display:flex;align-items:center;padding-left:14px;gap:12px">
  <div class="wm" style="font-size:34px">${brand.name}</div><div style="font-size:13px;font-weight:600;letter-spacing:.16em;color:${brand.grey};margin-top:6px">CRM</div></div>`, plate);
// Step number under the logo (upper left).
const tag = (scene, file) => still(`<div style="position:absolute;left:24px;top:84px;display:flex;align-items:stretch;border-radius:12px;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.28)">
  <div style="background:${brand.purple};color:#fff;padding:12px 20px;font-size:34px;font-weight:700">${String(scene.chapterNo).padStart(2, '0')}</div>
  <div style="background:#fff;color:${brand.purple};padding:12px 26px;font-size:34px;font-weight:700;letter-spacing:-.01em">${scene.chapter}</div></div>`, file);

// ---------- click sound and zoom ----------
const clickWav = join(tmp, 'click.wav');
ff(['-f', 'lavfi', '-i', `aevalsrc='(0.45*sin(2*PI*2600*t)+0.4*sin(2*PI*950*t)+0.25*(random(0)*2-1)*exp(-t*260))*exp(-t*85)':s=48000:d=0.14`, '-af', 'volume=0.5', clickWav]);
const smooth = (u) => `((${u})*(${u})*(3-2*(${u})))`;
// 0 → 1 → 0 around a click at second c: rises over `a`, holds, falls over `b`.
const envelope = (c, a = 0.55, hold = 0.95, b = 0.6) => `(${smooth(`clip((on/${FPS}-${(c - a).toFixed(3)})/${a},0,1)`)}*(1-${smooth(`clip((on/${FPS}-${(c + hold).toFixed(3)})/${b},0,1)`)}))`;
const maxOf = (list) => list.reduce((acc, e) => (acc ? `max(${acc},${e})` : e), '');
function zoomFilter(clicks, amount = 0.5) {
  const env = clicks.map((c) => envelope(c.t));
  const z = `(1+${amount}*${maxOf(env)})`;
  const sum = env.join('+');
  const fx = `((${clicks.map((c, i) => `${env[i]}*${2 * c.x}`).join('+')})/(${sum}+0.000001))`;
  const fy = `((${clicks.map((c, i) => `${env[i]}*${2 * c.y}`).join('+')})/(${sum}+0.000001))`;
  // zoompan crops a window of iw/zoom; keeping the focal point where it is: x = f * (1 - 1/zoom). Work on a 2x frame so the movement is sub-pixel smooth.
  return `scale=${2 * W}:${2 * H}:flags=lanczos,zoompan=z='${z}':x='${fx}*(1-1/${z})':y='${fy}*(1-1/${z})':d=1:s=${W}x${H}:fps=${FPS}`;
}

// ---------- scenes ----------
const parts = [], subs = []; let clock = 0;
for (const scene of script.scenes) {
  const vo = `${media}/vo-${scene.id}.mp3`, seg = join(tmp, `${scene.id}.mp4`);
  if (scene.type === 'avatar') {
    const base = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`;
    const clip = `${media}/avatar-${scene.id}.mp4`;
    if (scene.id === 'intro') {
      const overlay = await introOverlay(2.8);
      ff(['-i', clip, '-framerate', String(FPS), '-itsoffset', '0.3', '-i', overlay.pattern,
        '-filter_complex', `[0:v]${base}[bg];[1:v]format=rgba[ov];[bg][ov]overlay=0:0:eof_action=repeat[v]`, '-map', '[v]', '-map', '0:a', ...norm, seg]);
    } else ff(['-i', clip, '-vf', base, ...norm, seg]);
  } else if (scene.type === 'card') {
    const voice = dur(vo), total = voice + 0.7;
    const card = await textCard(scene, voice);
    ff(['-framerate', String(FPS), '-i', card.pattern, '-i', vo,
      '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${Math.max(0, total - card.animEnd + 0.1).toFixed(2)},scale=${W}:${H},fps=${FPS}[v];[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2), ...norm, seg]);
  } else if (scene.type === 'phone') {
    const voice = dur(vo), total = voice + 0.7;
    const card = await phoneScene(scene, total);
    ff(['-framerate', String(FPS), '-i', card.pattern, '-i', vo,
      '-filter_complex', `[0:v]scale=${W}:${H},fps=${FPS}[v];[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2), ...norm, seg]);
  } else if (scene.type === 'endcard') {
    const seconds = scene.seconds ?? 3.6;
    const card = await endCard(scene, seconds);
    ff(['-framerate', String(FPS), '-i', card.pattern, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', seconds.toFixed(2), '-pix_fmt', 'yuv420p', ...norm, seg]);
  } else {
    const i = marks.findIndex((m) => m.id === scene.id);
    if (i < 0) throw new Error(`no mark for scene ${scene.id}`);
    const trim = scene.trim ?? 0; // seconds of page load/cosmetics warm-up to cut from the start of the footage
    const start = marks[i].at + trim, len = marks[i + 1].at - start, voice = dur(vo) + 0.5;
    // Footage shorter than the voice: slow it down (at most 1.6x), freeze the rest. Longer: let it run, the voice ends early.
    const factor = Math.min(1.6, Math.max(1, voice / len)), shown = len * factor, total = Math.max(shown, voice);
    const sceneClicks = clicksAll.filter((c) => c.scene === scene.id && c.t >= start - 0.3 && c.t <= start + len).map((c) => ({ t: (c.t - start) * factor, x: c.x, y: c.y })).filter((c) => c.t >= 0.2);
    const tagPng = join(tmp, `${scene.id}-tag.png`); await tag(scene, tagPng);
    const still_ = (png) => ['-loop', '1', '-framerate', String(FPS), '-t', total.toFixed(2), '-i', png];
    const zoom = sceneClicks.length ? zoomFilter(sceneClicks) : `scale=${W}:${H}`;
    const audioIn = sceneClicks.flatMap(() => ['-i', clickWav]);
    const mix = sceneClicks.map((c, k) => `[${4 + k}:a]adelay=${Math.round(c.t * 1000)}|${Math.round(c.t * 1000)}[c${k}]`).join(';');
    const audio = sceneClicks.length
      ? `[3:a]apad[v0];${mix};[v0]${sceneClicks.map((_, k) => `[c${k}]`).join('')}amix=inputs=${sceneClicks.length + 1}:normalize=0:duration=first[mx];[mx]alimiter=limit=0.89:attack=3:release=60[a]`
      : '[3:a]apad[a]';
    ff(['-ss', String(start), '-t', String(len), '-i', `${out}/screen.webm`, ...still_(plate), ...still_(tagPng), '-i', vo, ...audioIn,
      '-filter_complex', `[0:v]setpts=PTS*${factor.toFixed(4)},fps=${FPS},tpad=stop_mode=clone:stop_duration=${Math.max(0, total - shown + 0.2).toFixed(2)},${zoom}[z];` +
        `[z][1:v]overlay=0:0[p];[2:v]format=rgba,fade=t=in:st=0.4:d=0.4:alpha=1,fade=t=out:st=${Math.max(1, total - 0.8).toFixed(2)}:d=0.4:alpha=1[tg];[p][tg]overlay=0:0[v];${audio}`,
      '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2), ...norm, seg]);
  }
  const d = dur(seg);
  if (!['card', 'endcard'].includes(scene.type)) subs.push({ start: clock, end: clock + d, text: text(scene) }); // a card already shows its text
  clock += d; parts.push(seg);
}
await browser.close();

// ---------- captions (brand purple, white outline, no dark shade) ----------
const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
let n = 1, srt = '';
for (const { start, end, text } of subs) {
  const sentences = text.match(/[^.!?:]+[.!?:]+/g) ?? [text]; const total = sentences.join('').length; let t = start;
  for (const sentence of sentences) { const d = (end - start) * (sentence.length / total); srt += `${n++}\n${ts(t)} --> ${ts(t + d)}\n${sentence.trim()}\n\n`; t += d; }
}
writeFileSync(`${tmp}/subs.srt`, srt);
writeFileSync(`${tmp}/concat.txt`, parts.map((p) => `file '${p.split('/').pop()}'`).join('\n'));
const final = `${out}/${slug}-${lang}.mp4`;
const assColour = (hex) => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`.toUpperCase(); // #RRGGBB → ASS &H00BBGGRR
ff(['-f', 'concat', '-safe', '0', '-i', `${tmp}/concat.txt`,
  '-vf', `subtitles=${tmp}/subs.srt:fontsdir=${FONTS}:force_style='FontName=IBM Plex Sans,Bold=1,FontSize=12,PrimaryColour=${assColour(brand.purple)},OutlineColour=&H00FFFFFF,BorderStyle=1,Outline=3,Shadow=0,MarginV=22'`,
  ...norm, final]);
console.log(`${final}  ${dur(final).toFixed(1)}s`, subs.map((s) => `${s.text.slice(0, 18)}… ${(s.end - s.start).toFixed(1)}s`));
