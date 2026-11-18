# Zusammenschnitt zu 9:16-Video (Untertitel, Musik)

Issue: #9. Aus `voices.json` (#7, Audio je Szene) und `media.json` (#8, Bild oder Clip je
Szene) entsteht eine MP4-Datei mit 1080x1920, eingebrannten Untertiteln und Hintergrundmusik.
Code: `src/video/`. Kein Upload, keine Erzeugung von Skript, Stimmen oder Bildern.

## FFmpeg installieren (Windows)

```sh
winget install --id Gyan.FFmpeg -e
```

Danach ein **neues Terminal** öffnen und prüfen:

```sh
ffmpeg -version
ffprobe -version
```

Anforderungen: FFmpeg mit `libx264`, `libass` (Filter `ass`) und `sidechaincompress` (alle im
Gyan-Build enthalten); die Kommandozeile ist gegen die FFmpeg-Filterdoku geschrieben, aber noch nicht mit
echtem FFmpeg ausgeführt (siehe manuelle Prüfung unten); bewusst ohne `amix=normalize` (erst ab 7.1).

Umgebungsvariablen (optional, in `.env`):

| Name | Zweck |
|---|---|
| `FFMPEG_PATH` | Pfad zu `ffmpeg(.exe)`, Standard `ffmpeg` aus dem `PATH` |
| `FFPROBE_PATH` | Pfad zu `ffprobe`; Standard: Nachbar von `FFMPEG_PATH`, sonst `ffprobe` aus dem `PATH` |

Ist FFmpeg nicht auffindbar, gibt der Aufruf eine einzeilige Meldung mit diesem Installationshinweis
aus (ohne Stacktrace, Exitcode 1). Weitere Systemwerkzeuge sind nicht nötig.

## Benutzung

```sh
npm run voice -- output/scripts/<skript>.json
npm run media -- output/scripts/<skript>.json
npm run video -- output/scripts/<skript>.json
npm run video -- <skript.json> --voices pfad/voices.json --media pfad/media.json --music datei.mp3 --out ziel.mp4
npm run video -- <skript.json> --no-music
npm run video:verify -- output/video/<skript>/video.mp4 --seconds 60
```

Standardpfade (nicht eingecheckt): `output/voices/<name>/voices.json`,
`output/media/<name>/media.json`, Ausgabe `output/video/<name>/video.mp4` plus
`subtitles.ass` im selben Ordner. `<name>` ist der Dateiname des Skripts ohne `.json`.

## Eingaben und Fehlerfälle

Sprache und Material werden **ausschließlich über `sceneId`** verbunden (Reihenfolge der Dateien
spielt keine Rolle). Der Schnitt bricht mit verständlicher Meldung ab, ohne zu raten, wenn:

- `voices.json` oder `media.json` fehlt oder kein gültiges JSON ist,
- zu einer `sceneId` Sprache oder Bild/Clip fehlt (IDs/Anzahl passen nicht zusammen) oder eine
  `sceneId` doppelt vorkommt,
- eine Audiodatei oder Bild/Clip-Datei nicht existiert, die Dauer fehlt oder `type` unbekannt ist,
- eine mit `--music` ausdrücklich angegebene Datei nicht existiert.

Ohne Musikdatei in `assets/music/` läuft der Schnitt weiter und weist darauf hin.

## Länge

Die Dauer je Szene ist die gemessene Sprachdauer aus `voices.json`. Die Videolänge ist die Summe
der Sprachdauern; Szenengrenzen werden aus der kumulierten Dauer auf 30-fps-Bilder gerundet,
dadurch entsteht kein Drift (Abweichung höchstens ein halbes Bild, ca. 17 ms). Szenenwechsel
fallen auf die Sprechwechsel, da jede Szene genau eine Sprecherzeile hat. **Zielbereich 50 bis
70 s** (ca. 60 s, wie beim Skriptgenerator, `src/script/schema.ts`); außerhalb gibt es eine
Warnung, der Schnitt läuft trotzdem.

## Technische Umsetzung und Begründung der FFmpeg-Kommandozeile

Ein einziger FFmpeg-Aufruf mit `-filter_complex` (`src/video/ffmpeg.ts`, Funktion
`buildFfmpegArgs`; reine Funktion, per Test geprüft). Aufruf über den injizierbaren `Runner`
(`src/video/runner.ts`, `node:child_process` ohne Shell).

### Video je Szene

- Bild: `scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840` füllt das Format
  ohne Verzerrung und ohne Ränder (auch bei nicht-9:16-Quellen), dann
  `zoompan=z=...:x=...:y=...:d=<Bilder>:s=1080x1920:fps=30` (Ken Burns). `d` erzeugt aus dem einen
  Eingangsbild genau so viele Ausgabebilder wie die Szene lang ist; `z` hängt an `on` (Nummer des
  Ausgabebilds), der Zoom (1.0 bis 1.25) ist linear und unabhängig vom Eingangstakt. Die
  Vorskalierung auf das Doppelte der Zielgröße verhindert das bekannte Ruckeln von `zoompan`
  durch Rundung auf ganze Pixel. Bewegung wechselt je Szene (Zoom-in mittig, Zoom-out mittig,
  Zoom-in mit Schwenk), damit kein Standbild-Eindruck entsteht.
- Clip: nur `scale`+`crop` auf 1080x1920, `fps=30`, `trim=end_frame` auf die Szenenlänge. Zu kurze
  Clips laufen per `-stream_loop -1` in Schleife (`-t` vor dem Eingang begrenzt das Lesen), zu
  lange werden gekürzt. Der Clip-Ton wird nicht verwendet.
- Jede Szene endet in `setsar=1,format=yuv420p` mit 30 fps; das verlangt `concat`. Danach
  `concat=n=<k>:v=1:a=0`.

### Untertitel (ASS)

`src/video/ass.ts` erzeugt `subtitles.ass` (PlayRes 1080x1920, damit Größen in Pixeln gelten).
Zeiten: Wort-Zeitstempel aus `voices.json`, verschoben um den Szenenbeginn, je 3 Wörter eine
Einblendung (Brainrot-Stil), kleine Lücken überbrückt, nie über die Szene hinaus. Ohne
Zeitstempel: ganzer Text über die Szenendauer. Stil: Arial 88 px fett, weiß, 6 px schwarze Kontur
plus Schatten, unten mittig mit 520 px Abstand zum unteren Rand und 100 px seitlich (außerhalb
der TikTok-Oberfläche unten, ca. 27 %). Eingebrannt mit `ass=filename=<Pfad>`.

*Windows-Pfad-Escaping:* FFmpeg entschärft Filterwerte in zwei Stufen (Filteroption, dann
Filtergraph; Doku "Quoting and escaping" in ffmpeg-utils). `escapeFilterPath` wandelt `\` in `/`
und maskiert zuerst `\ ' :`, dann `\ ' [ ] , ;`. `C:\Users\a b\out\subtitles.ass` wird zu
`C\\:/Users/a b/out/subtitles.ass` (der Laufwerks-Doppelpunkt wäre sonst ein Optionstrenner).
Da kein Shell-Aufruf stattfindet, ist keine weitere Shell-Maskierung nötig.

### Ton

- Sprache je Szene: `aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=<s>`
  (exakt auf die Szenenlänge, damit Audio und Video deckungsgleich bleiben), dann `concat` (a=1).
- Musik (falls vorhanden): Endlosschleife (`-stream_loop -1`), per `atrim` auf Videolänge, Lautstärke
  0.3, 1 s Einblendung und 1.5 s Ausblendung. `sidechaincompress` (Sidechain = Sprache,
  `threshold=0.02:ratio=10:attack=15:release=350`) senkt die Musik, solange gesprochen wird
  (Ducking); `amix=inputs=2:duration=first:dropout_transition=0` mischt. `amix` teilt standardmäßig
  durch die Eingangszahl, `volume=2` gleicht das aus (funktioniert in allen Versionen, anders als
  `normalize=0` erst ab FFmpeg 7.1); `alimiter=limit=0.95` verhindert Übersteuern. Die Konstanten
  stehen oben in `ffmpeg.ts` und lassen sich nach Hörprobe anpassen.
- Ausgabe: `libx264` (crf 20, profile high, yuv420p), AAC 192 kbit/s, 48 kHz, `-movflags +faststart`,
  30 fps, `-t` = Summe der Sprachdauern; das ist TikTok-konform (MP4, H.264/AAC, 9:16).

## Musiklizenz

Musik liegt in `assets/music/`, die Dokumentation von Quelle und Lizenz je Track steht in
`assets/music/README.md`. Es sind nur Tracks erlaubt, deren Lizenz kommerzielle Nutzung und
Veröffentlichung auf TikTok erlaubt (CC0/Public Domain oder ausdrücklich freie Lizenz). Aktuell
ist **keine Musikdatei eingecheckt**; der Schnitt läuft ohne Musik. Einen Track bitte erst nach
Eintrag in der Tabelle einchecken.

## Tests

- `npm test` läuft ohne FFmpeg: Der Runner wird durch eine Attrappe ersetzt. Geprüft werden Argumente
  (Eingänge, Zoompan, Filtergraph, Ducking, Ausgabeparameter, Windows-Escaping), die ASS-Datei
  (Zeiten, Stil, Fallback), Plan/Dauer-Summe sowie die Fehlerfälle (fehlende oder inkonsistente
  `sceneId`, fehlende Dateien, fehlende Musik) und die Ausgabeprüfung per FFprobe-Attrappe
  (`src/video/verify.ts`: Auflösung, 9:16, Codecs, Dauer).
- `src/video/video.integration.test.ts` rendert mit Dummy-Material (einfarbige PNGs, stille WAVs)
  ein echtes Video und prüft es per FFprobe. Der Test wird **übersprungen**, wenn FFmpeg/FFprobe
  fehlen, und läuft nach der Installation automatisch mit.
- Vitest unter Windows nur mit großgeschriebenem Laufwerksbuchstaben starten (Issue #17), z. B. aus
  `C:/Users/<name>/tiktok-ai-studio`.

## Manuelle Prüfung mit echtem FFmpeg (nachzuholen nach Installation)

Der Entwicklungsrechner hatte bei der Umsetzung kein FFmpeg; diese Schritte sind noch offen.

1. `ffmpeg -version` zeigt eine Version; `ffprobe -version` ebenso.
2. Eingaben erzeugen, ohne Kosten: `MEDIA_PROVIDER=dummy`, Skript, Stimmen (`OPENAI_API_KEY`
   nötig) und Medien wie in `docs/voice-generator.md` / `docs/media-provider.md`. Alternativ den
   Integrationstest laufen lassen (Schritt 7).
3. `npm run video -- output/scripts/<skript>.json`. Erwartet: Ausgabe "Video: ...", Exitcode 0,
   Datei `output/video/<name>/video.mp4` und `subtitles.ass`; kein FFmpeg-Fehler (der Filtergraph
   wird beim Start vollständig geparst, Tippfehler in Filtern würden sofort sichtbar).
4. `npm run video:verify -- output/video/<name>/video.mp4 --seconds <totalDurationSeconds aus voices.json>`.
   Erwartet: `1080x1920`, Dauer innerhalb 0,25 s der Summe, Video h264, Audio aac, "OK: 1080x1920 (9:16)".
5. Video am Smartphone/Player abspielen. Erwartet: Vollbild-Hochformat, Bild-Szenen zoomen bzw.
   schwenken sichtbar, Schnitte beim Sprecherwechsel, Untertitel (3 Wörter, weiß mit schwarzer
   Kontur) erscheinen im Takt der Sprache, liegen oberhalb des unteren Bedienbereichs und werden
   nicht seitlich abgeschnitten; Schriftart wird gefunden (kein Kästchen-Text).
6. Musik: Track in `assets/music/` legen (Lizenz eintragen), Schritt 3 wiederholen. Erwartet: Musik
   hörbar, sinkt hörbar ab, sobald jemand spricht, Sprache bleibt gut verständlich, Musik blendet am
   Ende aus; ohne Track gleicher Lauf ohne Musik und mit Hinweis. Optional Pegel prüfen:
   `ffmpeg -i video.mp4 -af volumedetect -f null NUL` (Spitzenpegel `max_volume` unter 0 dB).
7. `npm test`: der Integrationstest `echter FFmpeg-Lauf mit Dummy-Material` ist jetzt nicht mehr
   übersprungen und grün.
8. Gemischte Szenen: in `media.json` eine Szene auf `type: "video"` mit einem kurzen MP4 setzen.
   Erwartet: Clip füllt 9:16, wird bei Bedarf wiederholt/gekürzt, Gesamtlänge unverändert.
9. Fehlerfall: `--voices` auf eine Datei mit fehlender `sceneId` zeigen lassen. Erwartet: Abbruch mit
   Meldung zur fehlenden Szene, ohne Stacktrace.

Gefundene Abweichungen am Filtergraph (Syntax, Schrift, Pegel) sind in `src/video/ffmpeg.ts` bzw.
`ass.ts` zu korrigieren; die Konstanten dort sind dafür gedacht.
