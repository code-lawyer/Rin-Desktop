import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, readCatalog, validateCatalog, generatedDocuments } from './catalog.mjs';
const data = readCatalog(), problems = validateCatalog(data);
if (problems.length) throw new Error(problems.join('\n'));
for (const [name, content] of generatedDocuments(data)) writeFileSync(join(root, name), content);
console.log(`Generated progress and reconciliation: ${data.ledger.tasks.length} tasks, ${data.legacy.records.length} legacy items.`);
