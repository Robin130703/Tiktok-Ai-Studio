import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_ROLES = ["product-owner", "tech-lead", "developer", "reviewer", "tester"];

function parseFrontmatter(text) {
  const match = text.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---(\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

/** Prüft Agent-Dateien in `dir`. Gibt Fehlermeldungen zurück, leer = gültig. */
export function validateAgents(dir, required = REQUIRED_ROLES) {
  const errors = [];
  if (!existsSync(dir)) {
    return [`Verzeichnis ${dir} existiert nicht`, ...required.map((r) => `Pflichtrolle fehlt: ${r}`)];
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
  const found = new Set();
  for (const file of files) {
    const expected = basename(file, ".md");
    const fields = parseFrontmatter(readFileSync(join(dir, file), "utf8"));
    if (!fields) {
      errors.push(`${file}: Frontmatter fehlt`);
      continue;
    }
    if (!fields.name) errors.push(`${file}: Feld name fehlt`);
    else if (fields.name !== expected) errors.push(`${file}: name "${fields.name}" passt nicht zum Dateinamen`);
    if (!fields.description) errors.push(`${file}: Feld description fehlt`);
    found.add(expected);
  }
  for (const role of required) {
    if (!found.has(role)) errors.push(`Pflichtrolle fehlt: ${role}`);
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateAgents(".claude/agents");
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  console.log(`OK: ${REQUIRED_ROLES.length} Agentenrollen gültig`);
}
