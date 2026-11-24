// Cuts screen.webm per scene, stretches each cut to its voice-over, adds avatar intro/outro and card scenes,
// burns subtitles, concatenates. ffmpeg only; HyperFrames polish is optional on top.
// Usage: node video/assemble.mjs <slug> <lang>   → video/out/<slug>/<slug>-<lang>.mp4
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const [slug, lang = 'nl'] = process.argv.slice(2);
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const out = `video/out/${slug}`, media = `${out}/${lang}`, tmp = `${out}/${lang}/tmp`;
mkdirSync(tmp, { recursive: true });
const marks = JSON.parse(readFileSync(`${out}/marks.json`, 'utf8'));
const text = (o) => o[lang] ?? o.nl; // missing translation falls back to Dutch
const W = script.viewport.width, H = script.viewport.height, FPS = 30;
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());
const norm = ['-r', String(FPS), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2'];

// Card scene → PNG via the browser (text wrapping for free).
async function card(scene, file) {
  const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(`<body style="margin:0;background:#0f172a;color:#f8fafc;font:600 56px/1.3 -apple-system,Helvetica;display:grid;place-items:center;height:100vh"><div style="max-width:70%;text-align:center"><div style="font-size:30px;letter-spacing:.2em;color:#facc15;margin-bottom:40px">${text(script.title).toUpperCase()}</div>${text(scene)}</div></body>`);
  await p.screenshot({ path: file }); await b.close();
}

const parts = [], subs = []; let clock = 0;
for (const scene of script.scenes) {
  const vo = `${media}/vo-${scene.id}.mp3`, seg = `${tmp}/${scene.id}.mp4`;
  if (scene.type === 'avatar') {
    ff(['-i', `${media}/avatar-${scene.id}.mp4`, '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2`, ...norm, seg]);
  } else if (scene.type === 'card') {
    const png = `${tmp}/${scene.id}.png`; await card(scene, png);
    ff(['-loop', '1', '-i', png, '-i', vo, '-shortest', '-vf', `scale=${W}:${H}`, ...norm, seg]);
  } else {
    const i = marks.findIndex((m) => m.id === scene.id);
    if (i < 0) throw new Error(`no mark for scene ${scene.id}`);
    const start = marks[i].at, len = marks[i + 1].at - start, voice = dur(vo);
    // Footage shorter than the voice: freeze the last frame. Longer: let the footage run, voice ends early.
    const pad = Math.max(0, voice - len + 0.4);
    ff(['-ss', String(start), '-t', String(len), '-i', `${out}/screen.webm`, '-i', vo, '-filter_complex', `[0:v]tpad=stop_mode=clone:stop_duration=${pad},scale=${W}:${H}[v];[1:a]apad[a]`, '-map', '[v]', '-map', '[a]', '-t', String(Math.max(len, voice) + 0.4), ...norm, seg]);
  }
  const d = dur(seg); subs.push({ start: clock, end: clock + d, text: text(scene) }); clock += d; parts.push(seg);
}

// Subtitles: one scene text split into sentences, timed by character share.
const ts = (s) => new Date(s * 1000).toISOString().slice(11, 23).replace('.', ',');
let n = 1, srt = '';
for (const { start, end, text } of subs) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]; const total = sentences.join('').length; let t = start;
  for (const sentence of sentences) { const d = (end - start) * (sentence.length / total); srt += `${n++}\n${ts(t)} --> ${ts(t + d)}\n${sentence.trim()}\n\n`; t += d; }
}
writeFileSync(`${tmp}/subs.srt`, srt);
writeFileSync(`${tmp}/concat.txt`, parts.map((p) => `file '${p.split('/').pop()}'`).join('\n'));
const final = `${out}/${slug}-${lang}.mp4`;
ff(['-f', 'concat', '-safe', '0', '-i', `${tmp}/concat.txt`, '-vf', `subtitles=${tmp}/subs.srt:force_style='FontName=Helvetica,FontSize=18,Outline=1,Shadow=0,MarginV=36'`, ...norm, final]);
console.log(`${final}  ${dur(final).toFixed(1)}s`, subs.map((s) => `${s.text.slice(0, 20)}… ${(s.end - s.start).toFixed(1)}s`));
