import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { updateEnvFile } from '../src/cli/envfile.js';

const BIN = resolve('bin/pinhunter.js');
const run = (args, cwd) => execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });

test('help lists every command', () => {
  const out = run(['help'], mkdtempSync(join(tmpdir(), 'ph-')));
  for (const c of ['init', 'auth', 'boards', 'hunt', 'publish', 'doctor', 'demo']) assert.match(out, new RegExp(`\\b${c}\\b`));
});

test('demo runs the whole loop offline with no accounts', () => {
  const out = run(['demo'], mkdtempSync(join(tmpdir(), 'ph-')));
  assert.match(out, /5 draft\(s\)/);
  assert.match(out, /NEEDS_IMAGE/);
  assert.match(out, /POSTED/);
});

test('hunt without a Sheet configured explains what to set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ph-'));
  let err;
  try {
    run(['hunt'], dir);
  } catch (e) {
    err = e;
  }
  assert.ok(err, 'exits non-zero');
  assert.match(String(err.stderr) + String(err.stdout), /GOOGLE_SHEET_ID/);
});

test('init creates .env and pinhunter.config.json without overwriting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ph-'));
  run(['init'], dir);
  assert.match(readFileSync(join(dir, '.env'), 'utf8'), /AI_PROVIDER=/);
  writeFileSync(join(dir, '.env'), 'MINE=1\n');
  run(['init'], dir);
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'MINE=1\n');
  assert.ok(JSON.parse(readFileSync(join(dir, 'pinhunter.config.json'), 'utf8')).niches.length);
});

test('updateEnvFile replaces existing keys and appends new ones', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ph-'));
  const f = join(dir, '.env');
  writeFileSync(f, 'A=1\nPINTEREST_REFRESH_TOKEN=old\n# comment\n');
  updateEnvFile(f, { PINTEREST_REFRESH_TOKEN: 'new', B: 'two' });
  assert.equal(readFileSync(f, 'utf8'), 'A=1\nPINTEREST_REFRESH_TOKEN=new\n# comment\nB=two\n');
});
