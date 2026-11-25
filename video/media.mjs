// Voices for every scene, avatar clips for intro/outro. Needs `npx hyperframes auth login` once.
// Usage: VOICE_NL=<id> VOICE_EN=<id> AVATAR_LOOK=<lisa look id> node video/media.mjs s2-voorraadbewegingen nl [en]
// Voice backend (explicit, never switched silently):  VOICE_BACKEND=heygen (default) | chatterbox
//   chatterbox = free local TTS in Lisa's cloned voice (voice_engine/, Dutch only, see voice_engine/README.md);
//   it writes vo-<scene>.wav + vo-<scene>.mp3, the file video/assemble.mjs reads. Avatar clips still use HeyGen.
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [slug, ...langs] = process.argv.slice(2);
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const run = (args) => { console.log('>', args.join(' ')); const r = spawnSync('npx', ['hyperframes', 'media-use', 'generate', ...args], { stdio: 'inherit' }); if (r.status) process.exit(r.status); };

const backend = process.env.VOICE_BACKEND ?? 'heygen';
if (!['heygen', 'chatterbox'].includes(backend)) throw new Error(`VOICE_BACKEND must be heygen or chatterbox, got "${backend}"`);

for (const lang of langs.length ? langs : ['nl']) {
  const dir = `video/out/${slug}/${lang}`;
  mkdirSync(dir, { recursive: true });
  if (backend === 'chatterbox') {
    if (lang !== 'nl') throw new Error('The local Chatterbox backend is set up for Dutch (nl) only.');
    const py = process.env.VOICE_PYTHON ?? (process.platform === 'win32' ? 'voice_engine/.venv/Scripts/python.exe' : 'voice_engine/.venv/bin/python');
    const r = spawnSync(py, ['voice_engine/generate_voice.py', '--script', `video/scripts/${slug}.json`, '--lang', lang, '--out-dir', dir], { stdio: 'inherit' });
    if (r.status) process.exit(r.status);
  }
  const voice = process.env[`VOICE_${lang.toUpperCase()}`];
  if (backend === 'heygen' && !voice) throw new Error(`set VOICE_${lang.toUpperCase()} (run generate --type voice without --voice to list ids)`);
  for (const scene of script.scenes) {
    const vo = `${dir}/vo-${scene.id}.mp3`;
    if (backend === 'heygen' && !existsSync(vo)) run(['--type', 'voice', '--script', scene[lang], '--voice', voice, '--out', vo]);
    if (scene.type === 'avatar' && !existsSync(`${dir}/avatar-${scene.id}.mp4`)) {
      if (!process.env.AVATAR_LOOK) throw new Error('set AVATAR_LOOK to the Lisa look id');
      run(['--type', 'avatar', '--avatar', process.env.AVATAR_LOOK, '--audio', vo, '--aspect', '16:9', '--out', `${dir}/avatar-${scene.id}.mp4`]);
    }
  }
}
