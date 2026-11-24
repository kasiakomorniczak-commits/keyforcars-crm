# Handoff: KeyForCars CRM training videos

Doel: per CRM-module een video van 2–3 minuten in de stijl van de ERPNext-tutorials. Hoofdtaal NL, daarna EN uit dezelfde opname.
Avatar: **Lisa** (HeyGen-account van het team), alleen in intro (~10 s) en outro (~6 s). Alles daartussen is schermopname met voice-over en ondertitels.
Plan, curriculum en UX: `docs/video-training-plan.md`. Prioriteit: voorraad/inventaris (S1–S9), daarna de rest.

## Wat al staat

| Bestand | Doet |
|---|---|
| `video/scripts/<slug>.json` | Eén bron per video: scènes, NL/EN tekst, URL, klikstappen (Playwright-selectors). S2 is af. |
| `video/record.mjs` | Logt in, speelt de stappen af, neemt `screen.webm` op (1920×1080, gele cursor), schrijft `marks.json` (scène → seconde). |
| `video/media.mjs` | HeyGen: voice-over per scène, avatarclip voor intro/outro (`--audio`, dus de stem wordt één keer betaald). |
| `video/assemble.mjs` | ffmpeg: knipt per scène, rekt beeld op tot de voice-over, kaarten, avatar, ondertitels, concat → `out/<slug>/<slug>-<lang>.mp4`. Getest met synthetisch materiaal. |

## Eenmalig

1. `npm ci` (Playwright staat in devDependencies). macOS 12: zie `video/README.md`; op macOS 13+ gewoon `npx playwright install chromium ffmpeg` en in `record.mjs` `channel: 'chrome'` weghalen of laten staan (Chrome moet dan geïnstalleerd zijn).
2. `.env.local` → **demo-Supabase-project** (`deploy/keyforcars-demo/README.md`), niet productie. Seed uitbreiden tot realistische voorraad: ±40 artikelen × 2–3 bakken, ±60 bewegingen in de laatste 30 dagen, 3 bussen, 5 onderdeelaanvragen, 20 webshoporders. Zonder `--live` gebruikt de opname `?demo=1` (proefvoorraad; toont het label "Proefvoorraad", dus voor de definitieve opname wél `--live` op het demo-project).
3. `npx hyperframes auth login` met het HeyGen-account waar Lisa in staat.
4. Id's ophalen:
   - stemmen: `npx hyperframes media-use generate --type voice --script "test" --out /tmp/t.mp3` zonder `--voice` toont de lijst; kies één NL- en één EN-stem (vrouwelijk, rustig). Noteer als `VOICE_NL`, `VOICE_EN`.
   - Lisa: look-id uit de HeyGen-app (avatar openen, id in de URL) → `AVATAR_LOOK`. Test: `npx hyperframes media-use generate --type avatar --avatar <id> --script "Hallo" --voice <VOICE_NL> --aspect 16:9 --out /tmp/lisa.mp4`.

## Per video

```bash
npx next dev --webpack --hostname 127.0.0.1 --port 3017
VIDEO_EMAIL=… VIDEO_PASSWORD=… node video/record.mjs s2-voorraadbewegingen [--live]
VOICE_NL=… VOICE_EN=… AVATAR_LOOK=… node video/media.mjs s2-voorraadbewegingen nl en
node video/assemble.mjs s2-voorraadbewegingen nl && node video/assemble.mjs s2-voorraadbewegingen en
```

Controle vóór publicatie: lengte 120–190 s; geen stilstaand beeld > 3 s midden in een scène (dan de stap in de JSON een `wait` geven of de tekst inkorten); ondertitel leesbaar op 1.25×; het label "Voorbeeldgegevens"/"Proefvoorraad" komt niet in beeld.

## Nieuwe video schrijven

Kopieer `video/scripts/s2-voorraadbewegingen.json`. Regels:
- Scènes zonder `type` zijn schermopname; `type: "avatar"` (intro/outro) en `type: "card"` (tekstkaart) hebben geen stappen.
- Stappen: `{"click": sel}`, `{"fill": [sel, tekst]}`, `{"select": [sel, value]}`, `{"wait": ms}`. Selectors eerst checken met `npx playwright codegen http://127.0.0.1:3017`.
- Eén handeling per zin; noem het schermlabel letterlijk zoals het in de UI staat (NL), zodat de kijker het terugvindt.
- Telefoonschermen (S3 camera, S4 bulktelling, S7 mijn-bus): tweede opname met `"viewport": {"width": 430, "height": 932}` en in `record.mjs` `devices['Pixel 7']` meegeven; camera via "Telefooncamera / foto kiezen" met voorbereide etiketfoto's in `video/assets/labels/`.
- Structuur per video (zie plan §3): hook → waarom → 3–4 taken van begin tot eind → 2 veelgemaakte fouten → samenvatting + volgende video.

## Daarna (optioneel, kwaliteit)

- HyperFrames-sjabloon in plaats van de ffmpeg-concat: zoom op de klik, hoofdstukkaart per scène, Lisa als klein kader tijdens de outro. Skill `/hyperframes` staat lokaal; input is dezelfde `marks.json` + mp3's + `screen.webm`.
- Hosting: Vercel Blob of unlisted YouTube; link per module via een `?`-knop in de CRM en een "Training"-kaart op `/admin/start`.
- Rol-afspeellijsten en voortgang per medewerker: plan §5.
