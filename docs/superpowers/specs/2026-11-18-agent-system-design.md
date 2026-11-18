# Design: Agentensystem und Projektlandschaft für tiktok-ai-studio

Stand: 2026-11-18 · Status: Entwurf, wartet auf Freigabe

## Intent und Warum

Das Repo soll am Ende automatisch ca. 1-minütige KI-Videos (Brainrot-Stil, z. B.
sprechende Früchte) erzeugen und später automatisch auf TikTok hochladen.
**Bevor** irgendein Produktcode entsteht, wird eine Projektlandschaft gebaut, in
der ein Team aus KI-Agenten geordnet am Repo arbeitet: Issues anlegen und
abarbeiten, PRs erstellen, per Kommentar nachbessern, PR-Feedback abarbeiten.
Alles auf Branches, nach üblichen Projektstandards.

## Ziele

- Fünf Rollen als Agenten: Product Owner, Orchestrator/Tech Lead, Developer,
  Reviewer, Tester.
- Vollständiger Workflow über GitHub: Issue → Branch → PR → Review/Test-Kommentare
  → Nachbesserung → Merge bei grüner CI.
- Die Rollen liegen im Repo (`.claude/agents/`) und sind die einzige Quelle der Wahrheit.
- Jetzt lokal nutzbar (Claude Code + `gh`), ohne Kosten und ohne Secrets.
- Später ohne Umbau um GitHub-Actions-Autonomie erweiterbar (`@claude`-Erwähnungen,
  PR-Review), sobald ein `ANTHROPIC_API_KEY` hinterlegt ist.
- Projektstandards: geschützter `main`, Branch-Konvention, Conventional Commits,
  Templates, Labels, CI, `CLAUDE.md`, `CONTRIBUTING.md`, `CODEOWNERS`.
- Das System wird an einem echten Mini-Issue getestet ("läuft").

## Nicht-Ziele

- Keine Videoerstellung, kein TikTok-Upload in diesem Schritt. Der Product Owner
  legt dafür nur Backlog-Issues an.
- Keine Entscheidung über Programmiersprache und Bibliotheken der Video-Pipeline.
- Kein aktiver Actions-Workflow, der Geld kostet (nur vorbereitet, deaktiviert).

## Anti-Ziele (das wäre ein Fehlschlag, auch wenn es technisch läuft)

- Agenten pushen direkt auf `main`.
- Endlosschleifen von Agenten, die unbemerkt API-Kosten erzeugen.
- Rollen, die sich überschneiden (z. B. Developer reviewt eigenen Code).
- Ein Workflow, der nur beim Autor funktioniert und nicht dokumentiert ist.

## Constraints

- Alle Agenten posten unter dem GitHub-Account Robin130703. Ein Reviewer kann
  einen PR daher nicht formal "approven". Review und Test laufen als Kommentare
  mit klarem Ergebnis ("APPROVED" / "CHANGES REQUESTED"), die Merge-Bedingung ist
  die grüne CI. Der Merge liegt beim Tech Lead (Freigabe durch Robin am 2026-11-18), nur bei grüner CI und doppeltem APPROVED.
- Der Rechner hat Node 24, aber kein Python. Die CI läuft auf GitHub-Runnern.
- Das Repo ist leer, `main` braucht einen Initial-Commit, bevor Branches möglich sind.
- Branch-Schutz auf privaten Repos kann auf dem Free-Plan eingeschränkt sein. Das
  wird bei der Einrichtung geprüft (siehe offene Punkte).

## Approaches

1. **Lokal in Claude Code:** Subagenten plus `gh`-CLI. Kostenlos und kontrolliert,
   läuft aber nur in einer Sitzung.
2. **Komplett in GitHub Actions** (`claude-code-action`): voll autonom, aber API-Key,
   laufende Kosten, und Kommentare des Standard-Tokens lösen keine Folge-Workflows
   aus (PAT/GitHub App nötig).
3. **Hybrid (gewählt von Robin):** Rollen im Repo, lokal sofort nutzbar,
   Actions-Workflow vorbereitet und per Variable abschaltbar. Gewählt, weil man ohne
   Kosten startet und Autonomie später ohne Umbau zuschalten kann.

## Design

### Rollen

| Rolle | Aufgabe | Darf | Darf nicht |
|---|---|---|---|
| Product Owner | Anforderungen in Issues mit Akzeptanzkriterien, Backlog priorisieren | Issues anlegen/labeln/schließen | Code ändern |
| Orchestrator / Tech Lead | Issue wählen, Aufgabe schneiden, Rollen der Reihe nach starten, Fortschritt und Abschluss überwachen | Branches/PRs koordinieren, Labels setzen | Code schreiben |
| Developer | Implementiert ein Issue auf einem Branch, öffnet PR, arbeitet Review-Kommentare ab | Code, Commits, Push auf Feature-Branch, PR | Push auf `main`, eigenen PR freigeben |
| Reviewer | Liest den PR-Diff, prüft Korrektheit und Standards, kommentiert | PR-Kommentare, Label `review:changes`/`review:ok` | Code ändern |
| Tester | Führt Tests aus, ergänzt fehlende, prüft Akzeptanzkriterien | PR-Kommentare, Testdateien auf dem PR-Branch | Produktcode ändern |

### Ablauf

```text
PO legt Issue an (label: status:ready)
 → Orchestrator wählt Issue, setzt status:in-progress
 → Developer: Branch feat/<nr>-<slug>, Commits, PR ("Closes #nr")
 → Reviewer + Tester kommentieren am PR (parallel)
 → bei Änderungswünschen: Developer arbeitet Kommentare ab, pusht auf denselben Branch
 → Schleife, max. 3 Runden, danach Eskalation an den Menschen
 → CI grün + Reviewer OK + Tester OK → Orchestrator setzt "merge-ready"
 → Orchestrator merged (Squash); bei Eskalation entscheidet der Mensch
```

### Repo-Inhalt

- `.claude/agents/{product-owner,tech-lead,developer,reviewer,tester}.md`
- `.claude/commands/` Kurzbefehle, z. B. `/work-issue <nr>`, `/review-pr <nr>`, `/address-review <nr>`
- `CLAUDE.md` mit Workflow-Regeln, die alle Agenten lesen
- `.github/ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, `CODEOWNERS`, `labels.yml`
- `.github/workflows/ci.yml` (sprachneutral: Markdown, YAML, Actions-Lint, Validierung der Agent-Dateien)
- `.github/workflows/claude.yml` (vorbereitet, läuft nur bei gesetzter Variable `CLAUDE_ENABLED=true`)
- `CONTRIBUTING.md`, `README.md`, `docs/`
- Konventionen: Branches `feat|fix|chore|docs/<issue>-<slug>`, Conventional Commits,
  Squash-Merge, `main` geschützt (PR + grüne CI).

### Bootstrap

1. Initial-Commit auf `main` (README, `.gitignore`, Lizenz-Platzhalter).
2. Alles Weitere über Branch `chore/1-agent-system` und PR.
3. Labels und Branch-Schutz per `gh` setzen.
4. Abnahmetest: PO legt ein Test-Issue an, Developer/Reviewer/Tester arbeiten es
   über den kompletten Zyklus ab, bis zum PR mit Kommentaren und Nachbesserung.
5. Danach legt der PO das Backlog für die Videoerstellung an (Brainrot-Fruchtvideos).

## Offene Punkte / Entscheidungen des Builders

- Sichtbarkeit des Repos (public/private) und damit Umfang des Branch-Schutzes: wird beim
  Einrichten geprüft; falls nicht möglich, Fallback auf Konvention plus CI-Check.
- Lizenz: Platzhalter, Robin entscheidet später.
- Sprache der Video-Pipeline: bewusst offen, erstes Backlog-Issue.
  (Hinweis: Python lokal nicht installiert.)
