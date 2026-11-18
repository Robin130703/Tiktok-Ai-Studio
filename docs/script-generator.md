# Skript-Generator

Issue: #6. Ein LLM (Anthropic Claude) erzeugt aus einem Thema das Skript für ein
ca. 60 Sekunden langes Brainrot-Fruchtvideo. Das Skript ist die Eingabe für Stimmen (#7),
Bildquelle (#8) und Zusammenschnitt (#9). Code: `src/script/`.

## Benutzung

```sh
npm run script -- "Streit um den letzten Smoothie"
npm run script --          # ohne Thema: zufälliges Thema
```

Die Datei landet in `output/scripts/<zeitstempel>-<slug>.json` (nicht eingecheckt),
daneben `<...>.usage.json` mit Modell, Versuchen, Token und geschätzten Kosten.
Wiederverwendung ohne LLM-Aufruf: `loadScript(datei)` aus `src/script/store.ts`
(lädt und validiert erneut).

## Schema (Version 1)

```json
{
  "version": 1,
  "title": "Bananen-Drama",
  "topic": "Streit um den letzten Smoothie",
  "characters": [
    { "name": "Bruno", "fruit": "Banane", "personality": "dramatisch" }
  ],
  "scenes": [
    {
      "id": 1,
      "description": "Banane und Erdbeere in der Küche, Gesichter, Streit",
      "speaker": "Bruno",
      "text": "Das ist mein Smoothie!"
    }
  ]
}
```

| Feld | Regel |
|---|---|
| `characters` | 2 bis 4 Figuren, `name` eindeutig und fest (Schlüssel für die Stimmzuordnung in #7) |
| `scenes` | 6 bis 14 Szenen (Ziel ca. 10), `id` fortlaufend ab 1 |
| `scenes[].description` | Szenenbeschreibung, Eingabe der Bildquelle (#8) |
| `scenes[].speaker` | muss ein `characters[].name` sein |
| `scenes[].text` | gesprochener Dialog, nicht leer |

## Dauer-Schätzung

Geschätzte Sprechdauer = Anzahl Wörter aller `text`-Felder / 2,5 Wörter pro Sekunde
(150 Wörter ca. 60 s). **Zielbereich: 50 bis 70 s** (125 bis 175 Wörter). Außerhalb
gilt das Skript als ungültig. Die Schätzung ist grob; die echte Dauer misst #7 an der
Audiodatei.

## Validierung und Wiederholung

Jede LLM-Ausgabe wird als JSON geparst und gegen das Schema inkl. Dauer geprüft. Bei
Fehler gibt es genau eine Wiederholung (Fehlerliste wird dem LLM rückgemeldet), danach
wirft der Generator `ScriptGenerationError` mit Fehlerliste und bis dahin angefallener
Nutzung. Eine Wiederholung unterbleibt, wenn die Kosten bereits die Obergrenze
(0,10 USD) erreicht haben.

## Token und Kosten

`generateScript` liefert `usage` (`model`, `attempts`, `inputTokens`, `outputTokens`,
`costUsd`), summiert über alle Versuche; auch im Fehlerfall über
`ScriptGenerationError.usage`. Dies ist die Grundlage für den Budget-Check (#10).

Annahmen (Schätzungen, nicht live verifiziert): Standardmodell `claude-haiku-4-5`,
Preis 1 USD pro 1 Mio. Eingabe-Token und 5 USD pro 1 Mio. Ausgabe-Token. Ein Lauf mit
ca. 700 Eingabe- und 1 000 Ausgabe-Token kostet damit ca. 0,006 USD, inkl. Wiederholung
ca. 0,015 USD, also im Zielwert (0,02) und unter der Obergrenze (0,10). Modell-ID und
Preise vor Produktivbetrieb gegen die Anbieter-Preisseite prüfen.

## Konfiguration

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | API-Zugang, nur lokale `.env`, nie im Repo |
| `SCRIPT_MODEL` | optional, Claude-Modell (Standard `claude-haiku-4-5`) |

Tests nutzen einen Mock-Client (`LlmClient`), machen keine API-Aufrufe und brauchen
keinen Schlüssel.

## Stil und TikTok-Community-Richtlinien

Stil: absurd, Brainrot, kurze Szenen, schnelle Schnitte. Der Prompt verlangt
familienfreundliche Inhalte: keine Gewalt, kein Hass oder Diskriminierung, keine
Sexualisierung, keine Drogen, keine echten Personen oder Marken, kein Schimpfen. Das
ist ein Hinweis an das Modell, **keine Garantie**: Die Einhaltung der
[TikTok-Community-Richtlinien](https://www.tiktok.com/community-guidelines) liegt in
der Verantwortung des Betreibers; es gibt keine automatische Inhaltsprüfung (und laut
Issue keine menschliche Bewertung im Workflow). Vor dem späteren Upload (#11) ist zu
entscheiden, ob eine Prüfung nötig ist. Auch die Kennzeichnung KI-generierter Inhalte
ist dort zu beachten.
