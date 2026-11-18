# Contributing

Dieses Repo wird von einem Team aus KI-Agenten und einem Menschen gepflegt.
Die Regeln gelten für beide.

## Workflow

```text
PO legt Issue an (status:ready)
 -> Tech Lead wählt es, setzt status:in-progress
 -> Developer: Branch, Commits, PR ("Closes #nr")
 -> Reviewer + Tester kommentieren am PR (APPROVED / CHANGES REQUESTED)
 -> bei Änderungswünschen: Developer pusht auf denselben Branch
 -> max. 3 Runden, danach Eskalation an den Menschen
 -> CI grün + Reviewer OK + Tester OK -> status:merge-ready
 -> Tech Lead merged (Squash), bei Eskalation entscheidet der Mensch
```

## Regeln

- Nie direkt auf `main` pushen, immer Branch und PR.
- Branches: `feat|fix|chore|docs/<issue-nr>-<slug>`, z. B. `feat/12-script-generator`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`).
- Jeder PR referenziert ein Issue (`Closes #<nr>`) und nutzt das PR-Template.
- Keine Secrets im Repo.
- Merge: Squash, nur durch den Tech Lead und nur bei grüner CI plus APPROVED von Reviewer und Tester. Bei Eskalation (3 Runden) entscheidet der Mensch.

## Agenten lokal starten

In Claude Code im Repo-Ordner:

- `/work-issue <nr>`: Issue komplett bis merge-ready umsetzen lassen
- `/review-pr <nr>`, `/test-pr <nr>`: einzelne Rolle auf einen PR ansetzen
- `/address-review <nr>`: Kommentare eines PRs abarbeiten lassen

Die Rollen stehen in `.claude/agents/`, die gemeinsamen Regeln in `CLAUDE.md`.
Die CI validiert die Agent-Dateien (`scripts/validate-agents.mjs`).

## Autonomie über GitHub Actions (optional, kostet Geld)

1. Secret `ANTHROPIC_API_KEY` anlegen (Settings, Secrets and variables, Actions).
2. Repository-Variable `CLAUDE_ENABLED` auf `true` setzen.
3. Im Issue oder PR `@claude` kommentieren. Nur Kommentare des Repo-Besitzers lösen aus.

Ohne PAT oder GitHub App starten Kommentare von Agenten keine Folge-Workflows.

## Branch-Schutz

**Der Branch-Schutz für `main` ist auf GitHub derzeit nicht aktiv.** Das Repo ist
privat, und GitHub bietet Branch-Schutz nur mit GitHub Pro oder bei einem
öffentlichen Repo an. Die API antwortet sonst mit 403.

Die folgenden Regeln gelten deshalb als verbindliche Konvention und werden
technisch nicht erzwungen:

- PR erforderlich, kein direkter Push auf `main`.
- Status-Checks `agents`, `workflows` und `markdown-yaml` müssen grün sein.
- Keine Force-Pushes.

Verlasse dich nicht darauf, dass GitHub Verstöße blockiert. Alle Beteiligten
halten die Regeln selbst ein.

### Schutz aktivieren

Sobald das Repo öffentlich wird oder GitHub Pro vorhanden ist: Settings,
Branches, Branch protection rule für `main` anlegen (oder ein Ruleset) und
diese Einstellungen aktivieren:

1. Require a pull request before merging.
2. Require status checks to pass before merging, mit den Checks `agents`,
   `workflows` und `markdown-yaml`.
3. Force-Pushes nicht erlauben (Allow force pushes bleibt aus).

Danach diesen Abschnitt wieder auf den aktiven Schutz umstellen.
