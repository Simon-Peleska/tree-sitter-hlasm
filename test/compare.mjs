// Parses every file a reference parser judged with this grammar and compares the accept/reject
// verdicts of both parsers against a baseline.
//
//   node test/compare.mjs <reference-verdicts.tsv> <baseline.tsv> [--update]
//
// The verdicts file has one "path<TAB>ok|error<TAB>first error" line per file.
//
// Exits non-zero when any verdict differs from the baseline; --update rewrites the baseline instead.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [verdictsPath, baselinePath, ...flags] = process.argv.slice(2);
const update = flags.includes("--update");

const records = readFileSync(verdictsPath, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [path, reference, referenceError] = line.split("\t");
    return { path, id: basename(path), reference, referenceError };
  });
const pathsFile = join(dirname(verdictsPath), "compare-paths.txt");
writeFileSync(pathsFile, records.map((r) => r.path).join("\n") + "\n");

// tree-sitter exits 1 when any file has a parse error; that's an expected outcome here.
let output;
try {
  output = execFileSync("tree-sitter", ["parse", "--quiet", "--json-summary", "--paths", pathsFile], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (error) {
  if (typeof error.stdout !== "string" || !error.stdout.includes("parse_summaries")) {
    console.error("compare: [MC001] tree-sitter parse failed to run", error);
    process.exit(2);
  }
  output = error.stdout;
}
// --quiet still prints one line per file with errors before the JSON summary.
const summary = JSON.parse(output.slice(output.search(/^\{$/m)));
const treeSitterOk = new Map(summary.parse_summaries.map((s) => [s.file, s.successful]));

for (const record of records) {
  if (!treeSitterOk.has(record.path)) {
    console.error(`compare: [MC002] tree-sitter reported nothing for ${record.path}`);
    process.exit(2);
  }
  record.treeSitter = treeSitterOk.get(record.path) ? "ok" : "error";
}

const counts = {};
for (const r of records) {
  const key = r.reference === r.treeSitter ? `both ${r.reference}` : `only ${r.reference === "error" ? "reference" : "tree-sitter"} rejects`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log("compare:", JSON.stringify(counts));

const header = "reference\ttree-sitter\tid";
const lines = records.map((r) => `${r.reference}\t${r.treeSitter}\t${r.id}`).sort();

if (update) {
  writeFileSync(baselinePath, [header, ...lines].join("\n") + "\n");
  console.log(`compare: wrote ${lines.length} verdicts to ${baselinePath}`);
  process.exit(0);
}

let baseline = [];
try {
  baseline = readFileSync(baselinePath, "utf8").split("\n").filter(Boolean).slice(1);
} catch {
  console.error(`compare: [MC003] no baseline at ${baselinePath}; run with --update to create it`);
  process.exit(1);
}

const baselineById = new Map(baseline.map((line) => [line.split("\t")[2], line]));
const currentById = new Map(lines.map((line) => [line.split("\t")[2], line]));
const changes = [];
for (const [id, line] of currentById) {
  const before = baselineById.get(id);
  if (before !== line) changes.push({ id, before, after: line });
}
for (const [id, line] of baselineById) {
  if (!currentById.has(id)) changes.push({ id, before: line, after: undefined });
}

if (changes.length === 0) {
  console.log("compare: all verdicts match the baseline");
  process.exit(0);
}

const byId = new Map(records.map((r) => [r.id, r]));
console.error(`compare: [MC004] ${changes.length} verdict(s) differ from the baseline (reference / tree-sitter):`);
for (const { id, before, after } of changes) {
  const show = (line) => (line ? line.split("\t").slice(0, 2).join(" / ") : "absent");
  const record = byId.get(id);
  console.error(`  ${show(before)} -> ${show(after)}  ${id}${record ? `\n      ${record.path}  ${record.referenceError}` : ""}`);
}
console.error("compare: inspect the files above, then rerun with --update to accept the new verdicts");
process.exit(1);
