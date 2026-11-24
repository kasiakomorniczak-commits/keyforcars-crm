# Training videos

Plan: `docs/video-training-plan.md`. One JSON per video in `scripts/`, outputs in `out/<slug>/` (git-ignored).

```bash
npx next dev --webpack --hostname 127.0.0.1 --port 3017          # CRM
VIDEO_EMAIL=… VIDEO_PASSWORD=… node video/record.mjs s2-voorraadbewegingen   # screen.webm + marks.json (demo stock)
npx hyperframes auth login                                       # once, HeyGen account with the Lisa avatar
VOICE_NL=… VOICE_EN=… AVATAR_LOOK=… node video/media.mjs s2-voorraadbewegingen nl en
```

`--live` on record.mjs books real stock movements: only with `.env.local` pointing at the demo Supabase project.
Assembly (HyperFrames template: avatar intro, screen + captions, chapter cards, avatar outro) comes after the first recording exists.

## macOS 12 note
Playwright 1.65 ships no Chromium/ffmpeg for macOS 12. The recorder uses the installed Google Chrome (`channel: 'chrome'`) and the system ffmpeg is symlinked once as
`~/Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac -> ~/.local/bin/ffmpeg` (plus an empty `INSTALLATION_COMPLETE` file). Already done on this machine.
