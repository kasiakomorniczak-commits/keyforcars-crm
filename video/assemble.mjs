// Builds the finished video from screen.webm + per-scene voice-overs + avatar clips, in the Key24 template.
// Per screen scene: footage slowed to the voice-over, chapter tag lower-left. Cards and avatar clips are used as they are.
// Burns captions, concatenates.   Usage: node video/assemble.mjs <slug> <lang>   → video/out/<slug>/<slug>-<lang>.mp4
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const [slug, lang = 'nl'] = process.argv.slice(2);
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const out = `video/out/${slug}`, media = `${out}/${lang}`, tmp = `${out}/${lang}/tmp`;
mkdirSync(tmp, { recursive: true });
const marks = JSON.parse(readFileSync(`${out}/marks.json`, 'utf8'));
const text = (o) => o[lang] ?? o.nl; // missing translation falls back to Dutch
const W = script.viewport.width, H = script.viewport.height, FPS = 30;
const brand = { name: 'KEY24', navy: '#0F2147', ...script.brand }; // Key24 is one colour: dark navy. White is only the background.
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const norm = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'];
const wordmark = (size) => `<span style="font-weight:800;letter-spacing:.02em;font-size:${size}px;color:${brand.navy}">${brand.name}</span>`;

const browser = await chromium.launch({ channel: 'chrome' });
async function shot(html, file, transparent = false) {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  await p.setContent(`<body style="margin:0;font-family:Inter,'DejaVu Sans',Helvetica,sans-serif;${transparent ? '' : 'background:#fff;'}color:${brand.navy}">${html}</body>`);
  await p.screenshot({ path: file, omitBackground: transparent }); await p.close();
}
// Full-screen card: wordmark, accent rule, the text.
const card = (scene, file) => shot(`<div style="height:${H}px;display:grid;place-items:center"><div style="max-width:1280px"><div style="margin-bottom:36px">${wordmark(54)}</div><div style="width:120px;height:8px;background:${brand.navy};margin-bottom:44px"></div><div style="font-size:54px;font-weight:600;line-height:1.35">${text(scene)}</div></div></div>`, file);
// Chapter tag, lower-left, over the screen footage (transparent PNG).
const tag = (scene, file) => shot(`<div style="position:absolute;left:64px;bottom:112px;display:flex;align-items:stretch;box-shadow:0 8px 24px rgba(0,0,0,.30);border-radius:10px;overflow:hidden"><div style="background:${brand.navy};color:#fff;padding:14px 22px;font-size:34px;font-weight:800">${String(scene.chapterNo).padStart(2, '0')}</div><div style="background:#fff;color:${brand.navy};padding:14px 28px;font-size:34px;font-weight:700">${scene.chapter}</div></div>`, file, true);
// Title tag over the intro avatar.
const titleTag = (file) => shot(`<div style="position:absolute;left:64px;bottom:112px;display:flex;align-items:stretch;box-shadow:0 8px 24px rgba(0,0,0,.30);border-radius:10px;overflow:hidden"><div style="background:#fff;padding:14px 22px">${wordmark(34)}</div><div style="background:${brand.navy};color:#fff;padding:14px 28px;font-size:34px;font-weight:700">${text(script.title)}</div></div>`, file, true);

const parts = [], subs = []; let clock = 0;
// A still PNG has one frame, so loop it for the scene's length or the fade-in/out would have nothing to animate.
const tagInput = (png, seconds) => ['-loop', '1', '-framerate', String(FPS), '-t', seconds.toFixed(2), '-i', png];
const withTag = (base, png, from, to, seconds) => [...tagInput(png, seconds), '-filter_complex', `${base}[bg];[1:v]format=rgba,fade=t=in:st=${from}:d=0.4:alpha=1,fade=t=out:st=${to - 0.4}:d=0.4:alpha=1[tag];[bg][tag]overlay=0:0:eof_action=pass[v]`];
for (const scene of script.scenes) {
  const vo = `${media}/vo-${scene.id}.mp3`, seg = `${tmp}/${scene.id}.mp4`;
  if (scene.type === 'avatar') {
    const base = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`;
    if (scene.id === 'intro') {
      const png = `${tmp}/intro-tag.png`; await titleTag(png);
      ff(['-i', `${media}/avatar-${scene.id}.mp4`, ...withTag(base, png, 0.8, 5.5, dur(`${media}/avatar-${scene.id}.mp4`)), '-map', '[v]', '-map', '0:a', ...norm, seg]);
    } else ff(['-i', `${media}/avatar-${scene.id}.mp4`, '-vf', base.replace('[0:v]', ''), ...norm, seg]);
  } else if (scene.type === 'card') {
    const png = `${tmp}/${scene.id}.png`; await card(scene, png);
    ff(['-loop', '1', '-i', png, '-i', vo, '-shortest', '-vf', `scale=${W}:${H}`, ...norm, seg]);
  } else {
    const i = marks.findIndex((m) => m.id === scene.id);
    if (i < 0) throw new Error(`no mark for scene ${scene.id}`);
    const trim = scene.trim ?? 0; // seconds of page load/cosmetics warm-up to cut from the start of the footage
    const start = marks[i].at + trim, len = marks[i + 1].at - start, voice = dur(vo) + 0.5;
    // Footage shorter than the voice: slow it down (at most 1.6x), freeze the rest. Longer: let it run, the voice ends early.
    const factor = Math.min(1.6, Math.max(1, voice / len)), shown = len * factor, total = Math.max(shown, voice);
    const png = `${tmp}/${scene.id}-tag.png`; await tag(scene, png);
    const base = `[0:v]setpts=PTS*${factor.toFixed(4)},tpad=stop_mode=clone:stop_duration=${Math.max(0, total - shown + 0.1).toFixed(2)},scale=${W}:${H},fps=${FPS}`;
    ff(['-ss', String(start), '-t', String(len), '-i', `${out}/screen.webm`, ...tagInput(png, total), '-i', vo,
      '-filter_complex', `${base}[bg];[1:v]format=rgba,fade=t=in:st=0.4:d=0.4:alpha=1,fade=t=out:st=3.8:d=0.4:alpha=1[tag];[bg][tag]overlay=0:0:eof_action=pass[v];[2:a]apad[a]`,
      '-map', '[v]', '-map', '[a]', '-t', total.toFixed(2), ...norm, seg]);
  }
  const d = dur(seg); if (scene.type !== 'card') subs.push({ start: clock, end: clock + d, text: text(scene) }); // a card already shows its text
  clock += d; parts.push(seg);
}
await browser.close();

// Captions: a scene's text split into sentences, timed by character share. Boxed, so they read on any footage.
const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
let n = 1, srt = '';
for (const { start, end, text } of subs) {
  const sentences = text.match(/[^.!?:]+[.!?:]+/g) ?? [text]; const total = sentences.join('').length; let t = start;
  for (const sentence of sentences) { const d = (end - start) * (sentence.length / total); srt += `${n++}\n${ts(t)} --> ${ts(t + d)}\n${sentence.trim()}\n\n`; t += d; }
}
writeFileSync(`${tmp}/subs.srt`, srt);
writeFileSync(`${tmp}/concat.txt`, parts.map((p) => `file '${p.split('/').pop()}'`).join('\n'));
const final = `${out}/${slug}-${lang}.mp4`;
ff(['-f', 'concat', '-safe', '0', '-i', `${tmp}/concat.txt`, '-vf', `subtitles=${tmp}/subs.srt:force_style='FontName=Inter,FontSize=10,Bold=1,PrimaryColour=&HFFFFFF&,BorderStyle=3,Outline=1,Shadow=0,BackColour=&H6647210F,MarginV=14'`, ...norm, final]);
console.log(`${final}  ${dur(final).toFixed(1)}s`, subs.map((s) => `${s.text.slice(0, 18)}… ${(s.end - s.start).toFixed(1)}s`));
