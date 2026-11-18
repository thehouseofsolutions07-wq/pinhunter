import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Set KEY=value lines in a .env file, replacing existing keys and appending new ones. */
export function updateEnvFile(path, values) {
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  if (lines.length && lines.at(-1) === '') lines.pop();
  const todo = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && todo.has(m[1])) {
      const v = todo.get(m[1]);
      todo.delete(m[1]);
      return `${m[1]}=${v}`;
    }
    return line;
  });
  for (const [k, v] of todo) out.push(`${k}=${v}`);
  writeFileSync(path, out.join('\n') + '\n');
}
