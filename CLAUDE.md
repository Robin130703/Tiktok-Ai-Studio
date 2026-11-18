# CLAUDE.md

Projekt: **tiktok-ai-studio**. Ziel: automatische Erstellung von ca. 1-minütigen
Brainrot-KI-Videos, später automatischer TikTok-Upload. Aktueller Stand: Aufbau des
Agentensystems, danach die Video-Pipeline.

## Regeln für alle Agenten

- **Nie direkt auf `main` pushen.** Jede Änderung läuft über Branch und PR.
- Branches: `feat|fix|chore|docs/<issue-nr>-<slug>`. Commits: Conventional Commits.
  Merge: Squash, nur durch den tech-lead, wenn Reviewer und Tester `APPROVED` und die CI grün sind (vom Menschen freigegeben am 2026-11-18). Developer, Reviewer und Tester mergen nie.
- Jede Arbeit hängt an einem Issue (`Closes #<nr>` im PR).
- Keine Secrets, keine `.env`, keine API-Keys im Repo.
- Eine Rolle pro Aufgabe, keine Überschneidung (siehe unten).
- Unklar oder blockiert: am Issue/PR kommentieren und `status:blocked` setzen, nicht raten.

## Rollen (`.claude/agents/`)

| Rolle | Schreibt Code | Aufgabe |
|---|---|---|
| product-owner | nein | Issues, Akzeptanzkriterien, Backlog |
| tech-lead | nein | Steuert den Zyklus, merged bei grüner CI und doppeltem APPROVED |
| developer | ja | Implementiert, öffnet PR, arbeitet Kommentare ab |
| reviewer | nein | Prüft Diff, Kommentar `APPROVED` / `CHANGES REQUESTED` |
| tester | nur Tests | Führt Tests aus, prüft Akzeptanzkriterien |

Review- und Testergebnisse stehen als PR-Kommentar, erste Zeile `APPROVED` oder
`CHANGES REQUESTED`. Alle Agenten posten unter demselben GitHub-Account, formale
PR-Approvals sind deshalb nicht möglich. Maximal 3 Review-Runden, danach Eskalation.

## Befehle

`/work-issue <nr>`, `/review-pr <nr>`, `/test-pr <nr>`, `/address-review <nr>`

## Kosten

Der Workflow `.github/workflows/claude.yml` ist deaktiviert und läuft nur mit der
Repository-Variable `CLAUDE_ENABLED=true` und dem Secret `ANTHROPIC_API_KEY`.
Er verursacht API-Kosten.
