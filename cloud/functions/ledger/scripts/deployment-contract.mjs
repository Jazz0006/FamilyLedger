import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const functionRoot = resolve(here, '..');
const repoRoot = resolve(here, '../../../..');

function fail(message) {
  throw new Error(`Deployment contract violation: ${message}`);
}

const configPath = resolve(repoRoot, 'cloudbaserc.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));

if (config.version !== '2.1') fail('cloudbaserc.json must use version 2.1');
if (config.envId !== '{{env.CLOUDBASE_ENV_ID}}') {
  fail('envId must come from CLOUDBASE_ENV_ID, never a committed environment id');
}
if (!Array.isArray(config.functions)) fail('functions must be an array');

const ledger = config.functions.find((fn) => fn && fn.name === 'ledger');
if (!ledger) fail('ledger function config is missing');
if (ledger.dir !== './cloud/functions/ledger/dist-bundle') {
  fail('ledger.dir must point to the generated dist-bundle directory');
}
if (ledger.handler !== 'index.main') fail('ledger handler must be index.main');
if (ledger.runtime !== 'Nodejs20.19') fail('ledger runtime must be Nodejs20.19');
if (ledger.installDependency !== true) {
  fail('ledger deployment must install the external CloudBase SDK dependency');
}

const bundleIndex = resolve(functionRoot, 'dist-bundle/index.js');
const bundlePackage = resolve(functionRoot, 'dist-bundle/package.json');
await access(bundleIndex);
await access(bundlePackage);

const packageJson = JSON.parse(await readFile(bundlePackage, 'utf8'));
if (packageJson.main !== 'index.js') fail('bundle package main must be index.js');
if (!packageJson.dependencies?.['@cloudbase/node-sdk']) {
  fail('bundle package must declare @cloudbase/node-sdk');
}

console.log('CloudBase deployment contract OK');
