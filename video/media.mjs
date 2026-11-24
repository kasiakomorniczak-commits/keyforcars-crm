// Voices for every scene, avatar clips for intro/outro. Needs `npx hyperframes auth login` once.
// Usage: VOICE_NL=<id> VOICE_EN=<id> AVATAR_LOOK=<lisa look id> node video/media.mjs s2-voorraadbewegingen nl [en]
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [slug, ...langs] = process.argv.slice(2);
const script = JSON.parse(readFileSync(`video/scripts/${slug}.json`, 'utf8'));
const run = (args) => { console.log('>', args.join(' ')); const r = spawnSync('npx', ['hyperframes', 'media-use', 'generate', ...args], { stdio: 'inherit' }); if (r.status) process.exit(r.status); };

for (const lang of langs.length ? langs : ['nl']) {
  const voice = process.env[`VOICE_${lang.toUpperCase()}`];
  if (!voice) throw new Error(`set VOICE_${lang.toUpperCase()} (run generate --type voice without --voice to list ids)`);
  const dir = `video/out/${slug}/${lang}`;
  mkdirSync(dir, { recursive: true });
  for (const scene of script.scenes) {
    const vo = `${dir}/vo-${scene.id}.mp3`;
    if (!existsSync(vo)) run(['--type', 'voice', '--script', scene[lang], '--voice', voice, '--out', vo]);
    if (scene.type === 'avatar' && !existsSync(`${dir}/avatar-${scene.id}.mp4`)) {
      if (!process.env.AVATAR_LOOK) throw new Error('set AVATAR_LOOK to the Lisa look id');
      run(['--type', 'avatar', '--avatar', process.env.AVATAR_LOOK, '--audio', vo, '--aspect', '16:9', '--out', `${dir}/avatar-${scene.id}.mp4`]);
    }
  }
}
