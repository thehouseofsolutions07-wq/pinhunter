#!/usr/bin/env node
import { commands, HELP } from '../src/cli/commands.js';
import { buildContext, SetupError } from '../src/cli/context.js';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`PinHunter needs Node.js 22 or newer (you have ${process.versions.node}). Download it from https://nodejs.org`);
  process.exit(1);
}

const args = process.argv.slice(2);
const name = (args.find((a) => !a.startsWith('-')) || 'help').toLowerCase();
const flags = { dryRun: args.includes('--dry-run') };
if (args.includes('--help') || args.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

const command = commands[name];
if (!command) {
  console.error(`Unknown command "${name}".\n\n${HELP}`);
  process.exit(1);
}

try {
  const ctx = name === 'demo' || name === 'help' ? { log: console.log, cwd: process.cwd() } : buildContext();
  await command(ctx, flags);
} catch (e) {
  console.error(e instanceof SetupError ? `Setup needed: ${e.message}` : `Error: ${e.message}`);
  process.exit(1);
}
