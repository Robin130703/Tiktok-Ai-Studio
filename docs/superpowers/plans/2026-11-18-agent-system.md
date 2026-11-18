# Agentensystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Projektlandschaft, in der fünf Agentenrollen (PO, Tech Lead, Developer, Reviewer, Tester) über GitHub-Issues, Branches und PRs zusammenarbeiten.

**Architecture:** Rollen als Claude-Code-Subagenten in `.claude/agents/`, Workflow-Regeln in `CLAUDE.md`, Kurzbefehle in `.claude/commands/`. GitHub liefert den Zustand (Issues, Labels, PRs, CI). Ein sprachneutraler CI-Job validiert Agent-Dateien und Workflows. Ein Actions-Workflow für `@claude` ist vorbereitet, aber per Variable deaktiviert.

**Tech Stack:** Markdown, YAML, GitHub Actions, `gh` CLI, Node 24 (nur für das Validierungsskript, Tests mit `node:test`).

**Spec:** `docs/superpowers/specs/2026-11-18-agent-system-design.md`

## Global Constraints

- Repo: `Robin130703/Tiktok-Ai-Studio`, Hauptbranch `main`, nie direkt pushen (außer dem einmaligen Initial-Commit).
- Branch-Namen: `feat|fix|chore|docs/<issue-nr>-<slug>`. Commits: Conventional Commits. Merge: Squash.
- Rollen und ihre Verbote exakt laut Spec-Tabelle (PO schreibt keinen Code, Tech Lead schreibt keinen Code, Reviewer ändert keinen Code, Tester ändert keinen Produktcode, Developer pusht nie auf `main` und gibt den eigenen PR nicht frei).
- Review/Test-Ergebnis als PR-Kommentar mit genau `APPROVED` oder `CHANGES REQUESTED`; max. 3 Review-Runden, danach Eskalation an den Menschen.
- Der Mensch merged. Agenten melden nur "merge-ready".
- `claude.yml` läuft nur bei `vars.CLAUDE_ENABLED == 'true'`.
- Keine Videoerstellung, kein TikTok-Code, keine Sprachentscheidung für die Pipeline.
- Keine Secrets im Repo.

## Review Focus

- Agent-Datei ohne Frontmatter oder ohne `name`/`description`: CI muss rot werden.
- Agent-Datei, deren `name` nicht zum Dateinamen passt: CI rot.
- Leeres Verzeichnis `.claude/agents/` oder fehlende Pflichtrolle: CI rot.
- Branch-Schutz nicht verfügbar (privates Free-Repo): Fallback dokumentieren, nicht stillschweigend überspringen.
- Windows-Zeilenenden (CRLF) in Agent-Dateien dürfen die Validierung nicht brechen.

## File Structure

- `README.md`, `.gitignore`, `CLAUDE.md`, `CONTRIBUTING.md`: Einstieg und Regeln.
- `.claude/agents/{product-owner,tech-lead,developer,reviewer,tester}.md`: je eine Rolle.
- `.claude/commands/{work-issue,review-pr,test-pr,address-review}.md`: Kurzbefehle.
- `.github/labels.yml`, `.github/ISSUE_TEMPLATE/{feature,bug}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`.
- `.github/workflows/ci.yml`, `.github/workflows/claude.yml`.
- `scripts/validate-agents.mjs` + `scripts/validate-agents.test.mjs`: Validierung der Agent-Dateien.
- `docs/superpowers/{specs,plans}/`: Design und Plan (liegen bereits vor).

---

### Task 1: Bootstrap main und Arbeitsbranch

**Files:**
- Create: `README.md`, `.gitignore`

**Interfaces:**
- Produces: `main` mit Initial-Commit auf GitHub; Issue #1 "Agentensystem einrichten"; Branch `chore/1-agent-system` mit Spec und Plan.

- [ ] **Step 1:** `README.md` (Projektziel in 3 Sätzen, Status "Agentensystem im Aufbau") und `.gitignore` (Node, Python, `output/`, `.env`, `.claude/settings.local.json`) anlegen. Spec und Plan bleiben vorerst untracked.
- [ ] **Step 2:** Commit `chore: initial commit` auf `main`, `git push -u origin main`. Erwartet: Push erfolgreich (einziger direkter Push auf `main`).
- [ ] **Step 3:** `gh issue create --title "Agentensystem und Projektlandschaft einrichten" --body <Verweis auf Spec>`; erwartet: Issue #1.
- [ ] **Step 4:** `git switch -c chore/1-agent-system`, Spec und Plan committen (`docs: add agent system spec and plan`).

### Task 2: Labels, Templates, CODEOWNERS

**Files:**
- Create: `.github/labels.yml`, `.github/ISSUE_TEMPLATE/feature.yml`, `.github/ISSUE_TEMPLATE/bug.yml`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS`

**Interfaces:**
- Produces: Labels `role:po|tech-lead|dev|review|test`, `status:ready|in-progress|in-review|blocked|merge-ready`, `review:ok|changes`, `type:feature|bug|chore|docs`. Die Agent-Dateien (Task 3) referenzieren genau diese Namen.

- [ ] **Step 1:** `labels.yml` mit allen oben genannten Labels (Name, Farbe, Beschreibung) schreiben.
- [ ] **Step 2:** Labels per `gh label create --force` aus der Datei auf GitHub anlegen. Verifikation: `gh label list` zeigt alle 16 Labels.
- [ ] **Step 3:** Issue-Templates (Feature: Ziel, Akzeptanzkriterien als Checkliste, Nicht-Ziele; Bug: Schritte, erwartet, tatsächlich) und PR-Template (Zusammenfassung, `Closes #`, Testnachweis, Checkliste) schreiben. `CODEOWNERS`: `* @Robin130703`.
- [ ] **Step 4:** Commit `chore: add labels, templates and codeowners`.

### Task 3: Agentenrollen, Kurzbefehle, CLAUDE.md

**Files:**
- Create: `.claude/agents/{product-owner,tech-lead,developer,reviewer,tester}.md`, `.claude/commands/{work-issue,review-pr,test-pr,address-review}.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: Label-Namen aus Task 2.
- Produces: Agent-`name`-Werte `product-owner`, `tech-lead`, `developer`, `reviewer`, `tester` (identisch zum Dateinamen; Task 4 validiert das).

- [ ] **Step 1:** Jede Agent-Datei: YAML-Frontmatter (`name`, `description`, `tools` minimal: PO/Reviewer/Tester ohne `Edit` auf Produktcode, Tech Lead ohne `Edit`/`Write`, Developer mit `Edit`/`Write`/`Bash`), dann Rollenprompt auf Deutsch mit Aufgabe, Erlaubt/Verboten laut Spec-Tabelle, genauem Ablauf mit `gh`-Befehlen und Label-Wechseln, und dem Kommentarformat `APPROVED` / `CHANGES REQUESTED` (Reviewer, Tester).
- [ ] **Step 2:** Tech-Lead-Prompt enthält den Ablauf aus der Spec (Issue wählen → Developer → Reviewer+Tester → Schleife max. 3 Runden → merge-ready melden → Mensch merged) und die Eskalationsregel.
- [ ] **Step 3:** Kurzbefehle als dünne Wrapper, die den passenden Agenten mit der Issue-/PR-Nummer (`$ARGUMENTS`) starten.
- [ ] **Step 4:** `CLAUDE.md`: Projektziel, Branch-/Commit-/Merge-Konventionen, Rollenübersicht, Verbot direkter Pushes auf `main`, Kostenhinweis zu Actions.
- [ ] **Step 5:** Commit `feat: add agent roles, commands and CLAUDE.md`.

### Task 4: Validierungsskript und CI (TDD)

**Files:**
- Create: `scripts/validate-agents.mjs`, `scripts/validate-agents.test.mjs`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `validateAgents(dir: string, required: string[]) => string[]` (Liste von Fehlermeldungen, leer = gültig) als Named Export; CLI: `node scripts/validate-agents.mjs` prüft `.claude/agents` auf die fünf Pflichtrollen, Exit-Code 1 bei Fehlern.

- [ ] **Step 1: Failing tests** in `validate-agents.test.mjs` (`node:test`, temporäre Verzeichnisse): gültiges Verzeichnis → `[]`; Datei ohne Frontmatter → Fehler enthält Dateiname; fehlendes `description` → Fehler; `name` ≠ Dateiname → Fehler; fehlende Pflichtrolle → Fehler nennt die Rolle; leeres Verzeichnis → Fehler für alle Pflichtrollen; CRLF-Datei mit gültigem Frontmatter → `[]`.
- [ ] **Step 2:** `node --test scripts/` ausführen. Erwartet: FAIL (Modul fehlt).
- [ ] **Step 3:** `validateAgents` implementieren (Frontmatter mit einfachem Parser lesen, Zeilenenden normalisieren, keine Abhängigkeiten) und CLI-Einstieg ergänzen.
- [ ] **Step 4:** `node --test scripts/` und `node scripts/validate-agents.mjs`. Erwartet: PASS, Exit 0 für die echten Agent-Dateien.
- [ ] **Step 5:** `ci.yml` (Trigger: `pull_request`, `push` auf `main`): Jobs `agents` (setup-node 24, Tests + Validierung), `workflows` (`actionlint`), `markdown-yaml` (markdownlint-cli2 mit `.markdownlint-cli2.yaml` für `**/*.md`, yamllint). Pinne Action-Versionen.
- [ ] **Step 6:** Commit `ci: add agent validation and lint workflows`.

### Task 5: Vorbereiteter Claude-Workflow und Doku

**Files:**
- Create: `.github/workflows/claude.yml`, `CONTRIBUTING.md`
- Modify: `README.md`

- [ ] **Step 1:** `claude.yml`: Trigger `issue_comment`, `pull_request_review_comment`, `issues` (labeled); Job-Bedingung `vars.CLAUDE_ENABLED == 'true'` und Kommentar enthält `@claude`; nutzt `anthropics/claude-code-action` (gepinnte Version) mit `secrets.ANTHROPIC_API_KEY`; `permissions` minimal (`contents`, `pull-requests`, `issues` write); `concurrency` pro Issue/PR, `timeout-minutes: 15`. Kommentar im Kopf: Kosten, PAT-Hinweis für Folge-Workflows.
- [ ] **Step 2:** `CONTRIBUTING.md`: Workflow-Schaubild aus der Spec, Branch-/Commit-Regeln, wie man Agenten lokal startet (`/work-issue 1`), wie man Actions aktiviert (Variable + Secret).
- [ ] **Step 3:** README um Status, Agenten-Überblick und Link auf CONTRIBUTING erweitern.
- [ ] **Step 4:** Commit `docs: add contributing guide and optional claude workflow`.

### Task 6: PR, CI, Merge, Branch-Schutz

- [ ] **Step 1:** `git push -u origin chore/1-agent-system`, PR mit Template und `Closes #1` anlegen. Erwartet: CI startet.
- [ ] **Step 2:** CI-Ergebnisse prüfen (`gh pr checks`), Fehler beheben, bis alles grün ist.
- [ ] **Step 3:** Auf Freigabe des Menschen warten und mit Squash mergen (`gh pr merge --squash --delete-branch`) erst nach dessen Ok.
- [ ] **Step 4:** Branch-Schutz für `main` setzen (PR erforderlich, Status-Checks `agents`/`workflows`/`markdown-yaml` erforderlich, keine Force-Pushes, keine erforderlichen Approvals). Verifikation: `gh api repos/Robin130703/Tiktok-Ai-Studio/branches/main/protection`. Falls nicht verfügbar (Plan-Einschränkung): Fehlermeldung festhalten, in CONTRIBUTING als Konvention dokumentieren und dem Menschen melden.

### Task 7: Abnahmetest des Zyklus

- [ ] **Step 1:** Product-Owner-Agent legt ein Test-Issue an (z. B. "docs: Glossar ergänzen") mit Akzeptanzkriterien und `status:ready`.
- [ ] **Step 2:** Tech Lead nimmt es, Developer erstellt Branch und PR; Reviewer und Tester kommentieren; mindestens ein Kommentar verlangt eine Änderung (bewusst kleines Provozieren, z. B. fehlendes Kriterium), Developer arbeitet ihn ab; danach `merge-ready`.
- [ ] **Step 3:** Verifikation: Der PR zeigt Kommentare aller Rollen, einen Nachbesserungs-Commit und grüne CI. Ergebnis dem Menschen berichten, Merge nach seinem Ok.

### Task 8: Backlog für die Videoerstellung

- [ ] **Step 1:** Product Owner legt Issues für Phase 1 an (je mit Akzeptanzkriterien, `status:ready` nur beim ersten): Entscheidung Sprache/Stack der Pipeline (inkl. Hinweis: Python lokal nicht installiert), Skript-Generator für Brainrot-Fruchtvideos, Stimme, Bild-/Clip-Quelle, Zusammenschnitt 9:16 mit Untertiteln, CLI-Einstieg; TikTok-Upload als Phase 2 (`status:blocked` bis Phase 1 steht, inkl. Developer-App und Audit).
- [ ] **Step 2:** Verifikation: `gh issue list` zeigt das Backlog. Fertig meldet der Tech Lead dem Menschen.
