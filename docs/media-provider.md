# Bild-/Clip-Quelle pro Szene (austauschbar)

Issue: #8. Für jede Szene des Skripts (#6) wird ein Medium beschafft. Der Schnitt (#9)
sieht nur das `MediaProvider`-Interface und `media.json`, nie den Anbieter. Code: `src/media/`.

## Benutzung

```sh
npm run voice -- output/scripts/<skript>.json      # erst Stimmen (liefert voices.json)
npm run media -- output/scripts/<skript>.json
npm run media -- <skript.json> --voices pfad/voices.json --out ordner
```

Standardpfade: Dauer aus `output/voices/<skriptname>/voices.json`, Ausgabe in
`output/media/<skriptname>/` (nicht eingecheckt): `scene-NN.<ext>` (NN = `scenes[].id`,
wie `scene-NN.wav` aus #7) und `media.json`. Ohne `FAL_KEY` (Anbieter `fal`) bricht der
Aufruf mit einer klaren Meldung ohne Stacktrace ab.

## Interface

`MediaProvider` (`src/media/provider.ts`): `name`, `type` (`image` | `video`) und
`generate({ sceneId, prompt, aspectRatio: "9:16", durationSeconds, seed })`, Rückgabe
`{ data, type, extension, costUsd }`. Ein KI-Video-Anbieter wird später als weitere
Implementierung ergänzt (`type: "video"`), ohne Änderung am Schnitt.

## Anbieter und Auswahl

`MEDIA_PROVIDER` (optional, Standard `fal`):

| Wert | Verhalten |
|---|---|
| `fal` | fal.ai, Modell `fal-ai/flux/schnell` über `@fal-ai/client`, Zugang `FAL_KEY`, Bild 576x1024 (exakt 9:16; der Schnitt skaliert auf 1080x1920), Safety-Checker an |
| `dummy` | kostenlos, ohne Netzwerk: einfarbiges 9:16-PNG (Farbe aus dem Prompt); für Tests und Trockenläufe |

Unbekannte Werte führen zu einer Meldung mit den erlaubten Namen.

## Ausgabe `media.json`

Pro Szene: `sceneId`, `file`, `type`, `durationSeconds`, `costUsd`, `provider`, `prompt`,
`hash`; außerdem `provider` und `version`. Der Schnitt verbindet über dieselbe `sceneId`
`scene-NN.wav` (Audio) mit Bild und Dauer.

## Dauer aus `voices.json`

Der Aufrufer (`src/media/cli.ts`) liest `voices.json` über `loadSceneDurations` und
übergibt dem Provider die Dauer je Szene (Zuordnung `sceneId` = `scenes[].id`). Fehlen die
Datei oder eine Szene, gibt es eine Meldung mit Hinweis auf `npm run voice`; es wird nie
eine Dauer geschätzt. Bei Bildern fließt die Dauer nicht in die Erzeugung ein (nur in
`media.json`), bei künftigen Videoclips schon (auch im Cache-Hash).

## Figurenkonsistenz

Das Skript hat pro Figur nur `name`, `fruit`, `personality`; pro Szene ist nur
`speaker` verlässlich. Vorgehen (`src/media/prompt.ts`):

1. Feste Figurenbeschreibung je Figur aus diesen drei Feldern, immer im gleichen Wortlaut
   (Frucht, große runde Augen, kleine Arme und Beine, Persönlichkeit).
2. Gemeinsamer Stilblock für alle Szenen (3D-Cartoon, gleiche Beleuchtung, 9:16).
3. Prompt je Szene: Stil, Sprecher als Hauptfigur, alle übrigen Figuren als
   Referenzbeschreibung ("falls sie vorkommen"), dann `scenes[].description`.
4. Stabiler Seed je Sprecher (aus dem Namen): gleiche Figur, gleicher Startwert, dadurch
   ähnlicheres Aussehen über Szenen und Läufe.

Grenzen: FLUX schnell kennt keine Referenzbilder, die Ähnlichkeit ist nur eine
Annäherung. Die Qualität ist stichprobenartig mit echtem Anbieter zu prüfen (in diesem PR
nicht geschehen, kein Schlüssel vorhanden). Bessere Konsistenz bräuchte ein Modell mit
Referenzbild (spätere Entscheidung).

## Fehler, Moderation, Wiederverwendung, Kosten

- Dienstfehler und Moderationsablehnung (fal-Safety-Checker, `has_nsfw_concepts`) führen
  zu `MediaError` mit Szene, Ursache und Hinweis. Definiertes Verhalten: **Abbruch** ohne
  Ersatzbild (ein stilles Platzhalterbild würde im fertigen Video unbemerkt bleiben). Bei
  Moderation wird empfohlen, die Szenenbeschreibung im Skript zu entschärfen. Fertige
  Szenen und `media.json` bleiben erhalten, ein neuer Lauf setzt fort.
- Wiederverwendung: Eine Szene wird nur neu erzeugt, wenn Datei oder Eintrag fehlen oder
  sich Anbieter, Typ, Format, Seed oder Prompt (Szene, Figuren) geändert haben (Hash).
  Wiederverwendung kostet nichts.
- `usage` (`generated`, `reused`, `costUsd`) zählt die Kosten des Laufs; bei Erreichen der
  Obergrenze (0,60 USD, `maxCostUsd`) wird abgebrochen. Kosten früherer Läufe zählen wie
  in #7 nicht mit (siehe Sammel-Issue #20 d).

Annahmen (Schätzungen, nicht live verifiziert, Stand 2026-11-18): FLUX schnell ca.
0,003 USD pro Megapixel, ein Bild 576x1024 (ca. 0,59 MP) also ca. 0,002 USD; ca. 10 Bilder
ca. 0,02 USD, unter dem Zielwert (0,05) und der Obergrenze (0,60). Modell-ID, Bildgrößen-
Parameter und Preis vor Produktivbetrieb gegen die Anbieter-Seite prüfen.

## Konfiguration

| Variable | Zweck |
|---|---|
| `FAL_KEY` | Zugang zu fal.ai, nur lokale `.env`, nie im Repo |
| `MEDIA_PROVIDER` | optional, `fal` (Standard) oder `dummy` |

Tests nutzen den Dummy-Provider und einen gemockten `FalClient`, machen keine API-Aufrufe
und brauchen keinen Schlüssel.
