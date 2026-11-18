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
 -> Mensch merged (Squash)
```

## Regeln

- Nie direkt auf `main` pushen, immer Branch und PR.
- Branches: `feat|fix|chore|docs/<issue-nr>-<slug>`, z. B. `feat/12-script-generator`.
- Commits: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`).
- Jeder PR referenziert ein Issue (`Closes #<nr>`) und nutzt das PR-Template.
- Keine Secrets im Repo.
- Merge: Squash, nur durch den Menschen.

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

`main` ist geschützt: PR erforderlich, Status-Checks `agents`, `workflows` und
`markdown-yaml` müssen grün sein, keine Force-Pushes. Falls GitHub den Schutz für
dieses Repo nicht erlaubt (privates Repo im Free-Plan), gilt dieselbe Regel als Konvention.
