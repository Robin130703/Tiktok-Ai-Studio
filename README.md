# Tiktok-Ai-Studio

Automatische Erstellung von ca. 1-minütigen KI-Videos (Brainrot-Stil) und
späterer automatischer Upload auf TikTok.

## Status

Das Agentensystem ist eingerichtet. Die Videoerstellung folgt als Nächstes und wird
vom Product Owner als Backlog in den Issues geführt.

## Entwicklung

Voraussetzung: Node 24 (siehe `.nvmrc`). Tech-Stack: [docs/tech-stack.md](docs/tech-stack.md).

```sh
npm ci            # Abhängigkeiten installieren
npm run typecheck # Typprüfung (tsc --noEmit)
npm test          # Tests (Vitest)
```

Ordnerstruktur: Quellcode und Tests (`*.test.ts`) liegen in `src/`, Ausgaben in
`output/` (nicht eingecheckt). Für API-Keys `.env.example` nach `.env` kopieren und
Werte lokal eintragen.

## Video erzeugen (ein Befehl)

```sh
cp .env.example .env                    # Werte lokal eintragen (nicht einchecken)
npm run make-video                      # Thema wählt das LLM selbst
npm run make-video -- "Streit um den Smoothie" --name smoothie
npm run make-video -- --dummy           # Probelauf ohne Keys, Netzwerk und Kosten
```

Der Befehl führt Skript, Stimmen, Bilder und Schnitt nacheinander aus, meldet jeden Schritt
und nennt am Ende den Pfad zu `video.mp4`. Optionen: `[Thema]`, `--name <ausgabename>`
(Standard: Zeitstempel und Titel des Skripts), `--dummy`, `--no-music`, `--music <datei>`.
Fehlen Variablen, bricht er sofort mit einer Meldung ab, die die Namen nennt (keine Werte).
FFmpeg muss installiert sein (auch im Dummy-Modus), siehe
[docs/video-assembly.md](docs/video-assembly.md): `winget install --id Gyan.FFmpeg -e`.

Ausgaben je Lauf (`<name>` = Ausgabename):

```text
output/scripts/<name>.json (+ .usage.json)
output/voices/<name>/   scene-NN.wav, voices.json
output/media/<name>/    scene-NN.<ext>, media.json
output/video/<name>/    video.mp4, subtitles.ass
```

Ein Lauf mit gleichem `--name` setzt fort: vorhandenes Skript, Stimmen und Bilder werden
wiederverwendet, bezahlte Schritte also nicht wiederholt. Ist die Summe der Kosten
(Skript + Stimmen + Bilder) am Limit `MAX_COST_PER_VIDEO_USD`, bricht der Lauf vor dem
nächsten kostenpflichtigen Schritt ab.

| Variable | Pflicht | Zweck |
|---|---|---|
| `ANTHROPIC_API_KEY` | ja (nicht bei `--dummy`) | Skript (Claude) |
| `OPENAI_API_KEY` | ja (nicht bei `--dummy`) | Stimmen und Wort-Zeitstempel |
| `FAL_KEY` | nur bei `MEDIA_PROVIDER=fal` (nicht bei `--dummy`) | Bilder über fal.ai |
| `MEDIA_PROVIDER` | nein | `fal` (Standard) oder `dummy` |
| `VOICE_LANGUAGE` | nein | `de` (Standard) oder `en` |
| `SCRIPT_MODEL` | nein | Claude-Modell, Standard `claude-haiku-4-5` |
| `FFMPEG_PATH` | nein | Pfad zu FFmpeg, Standard `ffmpeg` aus dem `PATH` |
| `FFPROBE_PATH` | nein | Pfad zu FFprobe, Standard: Nachbar von `FFMPEG_PATH` |
| `MAX_COST_PER_VIDEO_USD` | nein | Kostenobergrenze pro Video, Standard `1.00` |
| `PIPELINE_DUMMY` | nein | `true`/`1` wie `--dummy` |

Einzelschritte bleiben über `npm run script|voice|media|video` verfügbar.

## Agententeam

| Rolle | Aufgabe |
|---|---|
| Product Owner | Issues und Akzeptanzkriterien |
| Tech Lead | steuert den Zyklus, merged bei grüner CI und doppeltem APPROVED |
| Developer | implementiert, öffnet PRs, arbeitet Kommentare ab |
| Reviewer | prüft den Diff |
| Tester | prüft Akzeptanzkriterien, ergänzt Tests |

Definitionen in [.claude/agents/](.claude/agents/), Regeln in [CLAUDE.md](CLAUDE.md),
Ablauf in [CONTRIBUTING.md](CONTRIBUTING.md).

## Dokumentation

- Design: [docs/superpowers/specs/](docs/superpowers/specs/)
- Skript-Generator: [docs/script-generator.md](docs/script-generator.md)
- Videoschnitt (Untertitel, Musik, FFmpeg): [docs/video-assembly.md](docs/video-assembly.md)
- Pläne: [docs/superpowers/plans/](docs/superpowers/plans/)
