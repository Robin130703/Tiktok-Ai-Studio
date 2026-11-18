# Entscheidung Tech-Stack der Video-Pipeline (Phase 1)

Status: entschieden im Auftrag des Tech Leads, Stand 2026-11-18. Issue: #5.

**Hinweis zu Preisen:** Alle Preisangaben sind **Schätzungen, Stand 2026-11-18**. Sie
konnten bei der Erstellung nicht live verifiziert werden und sind vor der Umsetzung
von #6 bis #10 gegen die Preisseiten der Anbieter zu prüfen. Alle Beträge in USD.

## Rahmenbedingungen

Entwicklungsrechner: Windows 11, Node 24 vorhanden, **kein Python**. Daher gilt:
alles in TypeScript auf Node 24, keine Python-Werkzeuge (kein Whisper-CLI, kein
moviepy o. Ä.). Externe Fähigkeiten kommen über HTTP-APIs oder als Binary (FFmpeg).

## Entscheidungen

| Baustein | Wahl | Begründung | Verworfen |
|---|---|---|---|
| Sprache/Laufzeit | TypeScript auf Node 24 (ESM), Tests mit Vitest | Passt zum Rechner, eine Sprache für alles, offizielle SDKs | Python (nicht installiert) |
| Skript (LLM) | Anthropic Claude über `@anthropic-ai/sdk`, kleines/günstiges Modell, strukturierte JSON-Ausgabe (Szenen, Sprechertext, Bildprompts) | Gute Qualität bei kurzen Texten, sehr geringe Kosten pro Skript, SDK für Node vorhanden | Größeres Modell (unnötig teuer für 150 Wörter) |
| Sprachausgabe (TTS) | OpenAI TTS (`gpt-4o-mini-tts`) über `openai`-SDK | Günstig, deutsch/englisch brauchbar, Stimmen per Anweisung steuerbar | ElevenLabs (bessere Stimmen, aber deutlich teurer pro Zeichen und Abo-basiert); lokale TTS (braucht Python) |
| Wort-Zeitstempel für Untertitel | OpenAI Transkription (`whisper-1`, `timestamp_granularities=word`) auf der erzeugten Audiodatei | Liefert wortgenaue Zeiten per API, kein lokales Whisper nötig | Lokales Whisper (Python/Build-Aufwand), Zeiten schätzen (ungenau) |
| Bildquelle | fal.ai mit FLUX schnell (`@fal-ai/client`), 9:16-Bilder | Sehr billig pro Bild, schnell, Node-Client | OpenAI-Bildmodelle (teurer pro Bild), Midjourney (keine offizielle API) |
| Videoschnitt | FFmpeg als Kommandozeilenprogramm, aufgerufen per `node:child_process`; Ken-Burns-Zoom aus Standbildern, Untertitel als ASS-Datei (Burn-in), Musik per `amix` mit Ducking | Branchenstandard, deckt Schnitt, Untertitel und Musik ab, keine Node-Wrapper-Abhängigkeit nötig | Remotion (schwerer, Chromium-Abhängigkeit), Cloud-Editoren (Kosten, Lock-in) |
| Musik | Lizenzfreie Tracks lokal im Ordner `assets/music/` (Lizenzen dokumentieren) | Keine laufenden Kosten, keine Rechteprobleme bei TikTok | KI-Musikdienste (Kosten, unklare Rechte) |

## Zusatzwerkzeug FFmpeg (Windows)

Installation: `winget install --id Gyan.FFmpeg -e`, danach neues Terminal öffnen und
mit `ffmpeg -version` prüfen. Alternative: Download von ffmpeg.org und Ordner in den
`PATH` aufnehmen. Der Pfad ist über `FFMPEG_PATH` überschreibbar (optional, Standard:
`ffmpeg` aus dem `PATH`). Weitere Systemwerkzeuge sind nicht nötig.

## Kostenrahmen pro fertigem ~60-s-Video (Schätzung, Stand 2026-11-18)

Annahme: ca. 150 gesprochene Wörter, ca. 10 Bilder (je ca. 6 s), 1 Skriptdurchlauf
plus 1 Wiederholung.

| Posten | Zielwert | Obergrenze |
|---|---|---|
| LLM (Skript, inkl. Retry) | 0,02 | 0,10 |
| Sprache (TTS + Wort-Transkription) | 0,04 | 0,15 |
| Bild/Clip (ca. 10 Bilder, inkl. Regeneration) | 0,05 | 0,60 |
| Puffer/Sonstiges | 0,00 | 0,15 |
| **Summe** | **ca. 0,11** | **1,00** |

Regel: Überschreitet ein Lauf die Obergrenze, bricht die Pipeline ab (Budget-Check
anhand mitgezählter Nutzung pro Lauf, Umsetzung in den Folge-Issues). Bei späterem
KI-Video (Clips statt Bilder) ist der Bildposten neu zu bewerten und die Obergrenze
per eigener Entscheidung anzupassen.

## Austauschbare Bild-/Clip-Quelle

Die Pipeline spricht die Bildquelle nur über ein schmales Interface an (Idee, nicht
Detail): ein `MediaProvider` bekommt Szenenbeschreibung, Format (9:16) und Dauer und
liefert eine Mediendatei samt Typ (`image` oder `video`) und Kostenangabe zurück.
Der Schnitt behandelt beide Typen: Bilder werden animiert (Zoom), Clips nur
zugeschnitten. Heute gibt es eine Implementierung (fal.ai FLUX, Bild); ein
KI-Video-Anbieter kommt später als weitere Implementierung hinzu. Der Anbieter wird
per Konfiguration (z. B. `MEDIA_PROVIDER`) gewählt, ohne Änderung am Schnitt.

## Benötigte Umgebungsvariablen (nur Namen, keine Werte)

| Name | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | LLM-Skripterzeugung |
| `OPENAI_API_KEY` | Sprachausgabe und Wort-Transkription |
| `FAL_KEY` | Bilderzeugung über fal.ai |
| `SCRIPT_MODEL` | optional, Claude-Modell für das Skript (Standard `claude-haiku-4-5`) |
| `MEDIA_PROVIDER` | optional, Wahl der Bild-/Clip-Quelle |
| `FFMPEG_PATH` | optional, Pfad zu FFmpeg |
| `MAX_COST_PER_VIDEO_USD` | optional, Obergrenze pro Video (Standard 1.00) |

Werte stehen ausschließlich in einer lokalen, nicht eingecheckten `.env`; im Repo
liegt höchstens eine `.env.example` mit leeren Werten.

## Nicht Teil dieser Entscheidung

Keine Implementierung, kein TikTok-Upload (#11), keine Prompt-Inhalte oder
Videostil.
