// Writes docs/AI-PROMPTS.md from the built-in prompt library, so the document and the software never disagree.
//   npx tsx apps/api/scripts/export-prompts.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILTIN_PROMPTS } from '../src/ai/prompts';

const out = resolve(__dirname, '../../../docs/AI-PROMPTS.md');
const head = readFileSync(out, 'utf8').split('<!-- prompts:start -->')[0];
const body = BUILTIN_PROMPTS.map(
  (p) => `### \`${p.key}\` — ${p.name}

${p.description}

- App: **${p.app}** · Result: **${p.output}** · Temperature: ${p.temperature}${p.partOf ? ` · Step of \`${p.partOf}\`` : ''}
- Variables: ${p.variables.map((v) => `\`{{${v.name}}}\``).join(', ') || '—'}${p.variables.find((v) => v.example)?.example ? `\n- Example request: “${p.variables.find((v) => v.example)!.example}”` : ''}

System prompt:

\`\`\`text
${p.system}
\`\`\`

Message template:

\`\`\`text
${p.template}
\`\`\`
`,
).join('\n');
writeFileSync(out, `${head}<!-- prompts:start -->\n\n${body}`);
console.log(`wrote ${BUILTIN_PROMPTS.length} prompts to ${out}`);
