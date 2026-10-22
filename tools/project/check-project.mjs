import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { root, readCatalog, validateCatalog, generatedDocuments } from './catalog.mjs';
import { publicPathIssue } from './public-path.mjs';
const data = readCatalog(), problems = validateCatalog(data);
function checkPath(name, from) {
  const issue = publicPathIssue(root, name);
  if (issue) problems.push(`${from}: ${issue}`);
}
for (const task of data.ledger.tasks) for (const name of [...task.paths, ...task.evidence.map(item => item.ref)]) checkPath(name, task.id);
for (const [name, content] of generatedDocuments(data)) if (!existsSync(resolve(root, name)) || readFileSync(resolve(root, name), 'utf8') !== content) problems.push(`${name}: stale; run npm run project:docs`);
const docs = ['README.md','CONTRIBUTING.md','AGENTS.md','PROJECT_PLAN.md','docs/README.md','docs/build.md','docs/privacy.md','docs/project-status.md','tools/qa/README.md','tools/qa/gui/README.md','tools/probes/README.md','tools/probes/cli-agents/README.md','prototypes/live2d-codex/PORTABLE-README.md','prototypes/live2d-codex/CLI-AGENTS.md'];
function markdownFiles(directory) { for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) { const name = directory + '/' + entry.name; if (entry.isDirectory()) markdownFiles(name); else if (name.endsWith('.md')) docs.push(name); } }
markdownFiles('docs/development');
let links = 0;
for (const file of docs) {
  if (!existsSync(resolve(root, file))) { problems.push(`Missing documentation ${file}`); continue; }
  const content = readFileSync(resolve(root, file), 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]; if (/^(https?:|mailto:|#)/i.test(target)) continue;
    links++; checkPath(relative(root, resolve(root, dirname(file), decodeURI(target.split('#')[0]))), file);
  }
}
const layout = JSON.parse(readFileSync(resolve(root, 'docs/development/repository-layout.json'), 'utf8'));
for (const name of layout.requiredPublicPaths) checkPath(name, 'repository layout');
const unknown = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !layout.topLevelDirectories.includes(entry.name)).map(entry => entry.name);
for (const name of unknown) problems.push(`Unclassified top-level directory ${name}`);
console.log(JSON.stringify({ tasks: data.ledger.tasks.length, legacyItems: data.legacy.records.length, documents: docs.length, links, problems }, null, 2));
if (problems.length) process.exitCode = 1;
