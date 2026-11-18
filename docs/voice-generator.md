# Stimmen-Erzeugung (TTS pro Figur)

Issue: #7. Aus jeder Szene des Skripts (#6, Format Version 1) entsteht eine
Sprachaufnahme. Zusätzlich liefert eine Metadatendatei die gemessene Dauer und
Wort-Zeitstempel für Schnitt und Untertitel (#9). Code: `src/voice/`.

## Benutzung

```sh
npm run voice -- output/scripts/<skript>.json
npm run voice -- <skript.json> --lang en --voices meine-stimmen.json --out ordner
```

Ohne `OPENAI_API_KEY` bricht der Aufruf mit einer klaren Fehlermeldung ab.
Ausgabe standardmäßig in `output/voices/<skriptname>/` (nicht eingecheckt):
`scene-NN.wav` (NN = `scenes[].id`, zweistellig) und `voices.json`.

## Metadatendatei `voices.json`

Pro Szene: `sceneId`, `speaker`, `voice`, `text`, `file`, `durationSeconds`
(gemessen), `words` (`word`, `start`, `end` in Sekunden), `costUsd`, `hash`;
außerdem `language` und `totalDurationSeconds`. Die gemessene Dauer ersetzt die
grobe Schätzung des Skripts (2,5 Wörter/s). Die Dauer wird aus dem WAV-Header der
erzeugten Datei gelesen (TTS-Format `wav`), die Wort-Zeiten kommen aus der
Transkription (`whisper-1`, Wort-Granularität) derselben Datei.

## Stimmzuordnung

Schlüssel ist `characters[].name`. Konfiguration per JSON-Datei (`--voices`):

```json
{ "Bruno": { "voice": "onyx", "instructions": "tief, theatralisch" },
  "Erna": { "voice": "nova" } }
```

Die Datei wird vor jedem API-Aufruf geprüft: ein ungültiger Stimmenname (oder eine
falsche Struktur) führt zu einer Meldung mit Figur, Wert und den erlaubten Namen
(`alloy, ash, ballad, cedar, coral, echo, fable, marin, nova, onyx, sage, shimmer, verse`).

Ohne Eintrag gilt die Standardzuordnung: Figuren erhalten der Reihe nach (Reihenfolge
in `characters`) `onyx`, `nova`, `fable`, `echo`, wobei bereits konfigurierte Stimmen
übersprungen werden; so klingen bis zu 4 Figuren verschieden und gleich bleibend.
Ohne eigene `instructions` wird eine Sprechanweisung aus Frucht, Name und
Persönlichkeit erzeugt (Cartoon-Stil).

## Sprache

Unterstützt: `de` (Standard) und `en`, per `--lang` oder `VOICE_LANGUAGE`. Der
Skript-Generator schreibt standardmäßig Deutsch, daher ist `de` der Standard; die
Sprache muss zum Skripttext passen (für englischen Text `--lang en`). Sie steuert die
Sprechanweisung und die Transkriptionssprache.

## Fehler, Fortsetzen, Kosten

- Dienstfehler führen zu `VoiceError` mit Szene, Ursache und Hinweis; fertige Szenen
  bleiben samt Metadaten erhalten (Metadaten werden nach jeder Szene gespeichert).
- Ein erneuter Lauf erzeugt nur Szenen neu, deren Datei fehlt oder deren Text, Stimme,
  Anweisung oder Sprache sich geändert hat (Hash). Wiederverwendung kostet nichts.
- Schlägt die Transkription einer Szene fehl, ist die TTS-Aufnahme bereits bezahlt. Sie
  wird deshalb vor der Transkription als `scene-NN.wav` gespeichert und in `voices.json`
  unter `pending` (Szene, Hash, Dauer, bezahlte TTS-Kosten) vermerkt. Ein erneuter Lauf
  liest diese Datei, ruft nur die Transkription auf und bezahlt TTS für diese Szene nicht
  noch einmal. Ändern sich Text, Stimme, Anweisung oder Sprache (Hash), verfällt der
  Eintrag und die Szene wird neu erzeugt. Nach erfolgreicher Transkription verschwindet
  `pending`.
- `usage` (`generated`, `reused`, `costUsd`) zählt die Kosten des Laufs. Die Obergrenze
  (0,15 USD, `maxCostUsd`) gilt für das ganze Video: vor jeder neuen Szene werden die
  Kosten dieses Laufs plus die Kosten bereits vorhandener, gültiger Szenen früherer Läufe
  (`costUsd` in `voices.json`) und bezahlter, noch nicht transkribierter Aufnahmen
  verglichen; bei Erreichen wird abgebrochen (Grundlage für #10). Eine bereits bezahlte
  Aufnahme wird auch bei erreichter Grenze noch transkribiert, weil dafür kein TTS-Preis
  mehr anfällt.

Annahmen (Schätzungen, nicht live verifiziert, Stand 2026-11-18): `gpt-4o-mini-tts`
ca. 0,60 USD pro 1 Mio. Eingabe-Token (grob 4 Zeichen je Token) plus ca. 0,015 USD pro
Minute Audio; `whisper-1` ca. 0,006 USD pro Minute. Für ca. 60 s Sprache ergibt das
ca. 0,02 USD, also im Zielwert (0,04) und unter der Obergrenze (0,15). Modell-IDs,
Stimmennamen und Preise vor Produktivbetrieb gegen die Anbieter-Seite prüfen.

## Konfiguration

| Variable | Zweck |
|---|---|
| `OPENAI_API_KEY` | API-Zugang, nur lokale `.env`, nie im Repo |
| `VOICE_LANGUAGE` | optional, `de` (Standard) oder `en` |

Tests nutzen einen Mock-`SpeechClient`, machen keine API-Aufrufe und brauchen keinen
Schlüssel.
