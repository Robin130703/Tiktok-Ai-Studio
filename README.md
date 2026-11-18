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
