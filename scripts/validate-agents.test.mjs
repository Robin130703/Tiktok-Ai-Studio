import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAgents } from "./validate-agents.mjs";

const valid = (name) => `---\nname: ${name}\ndescription: Rolle ${name}\n---\n\nPrompt\n`;

function dirWith(files) {
  const dir = mkdtempSync(join(tmpdir(), "agents-"));
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), content);
  }
  return dir;
}

test("gültiges Verzeichnis liefert keine Fehler", () => {
  const dir = dirWith({ "a.md": valid("a"), "b.md": valid("b") });
  assert.deepEqual(validateAgents(dir, ["a", "b"]), []);
});

test("Datei ohne Frontmatter nennt den Dateinamen", () => {
  const dir = dirWith({ "a.md": "nur Text\n" });
  const errors = validateAgents(dir, ["a"]);
  assert.ok(errors.some((e) => e.includes("a.md")));
});

test("fehlende description wird gemeldet", () => {
  const dir = dirWith({ "a.md": "---\nname: a\n---\nPrompt\n" });
  const errors = validateAgents(dir, ["a"]);
  assert.ok(errors.some((e) => e.includes("description")));
});

test("name ungleich Dateiname wird gemeldet", () => {
  const dir = dirWith({ "a.md": valid("anders") });
  const errors = validateAgents(dir, ["a"]);
  assert.ok(errors.some((e) => e.includes("a.md") && e.includes("name")));
});

test("fehlende Pflichtrolle wird genannt", () => {
  const dir = dirWith({ "a.md": valid("a") });
  const errors = validateAgents(dir, ["a", "tester"]);
  assert.ok(errors.some((e) => e.includes("tester")));
});

test("leeres Verzeichnis meldet alle Pflichtrollen", () => {
  const dir = dirWith({});
  const errors = validateAgents(dir, ["a", "b"]);
  assert.ok(errors.some((e) => e.includes("a")));
  assert.ok(errors.some((e) => e.includes("b")));
});

test("nicht vorhandenes Verzeichnis liefert Fehler statt Absturz", () => {
  const errors = validateAgents(join(tmpdir(), "gibt-es-nicht-xyz"), ["a"]);
  assert.ok(errors.length > 0);
});

test("CRLF-Zeilenenden sind gültig", () => {
  const dir = dirWith({ "a.md": valid("a").replace(/\n/g, "\r\n") });
  assert.deepEqual(validateAgents(dir, ["a"]), []);
});
