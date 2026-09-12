import {
  V2_REQUIRED_COLLECTIONS,
  buildCreateIndexesCommands,
} from '../dist/data/schema-contract.js';

function parseArgs(argv) {
  let envId = '<env-id>';
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--env') {
      const value = argv[index + 1];
      if (!value) throw new Error('--env requires an environment id');
      envId = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (envId !== '<env-id>' && !/^[A-Za-z0-9_-]+$/.test(envId)) {
    throw new Error('Environment id may contain only letters, digits, _ and -');
  }
  return { envId, json };
}

function buildPlan(envId) {
  const indexCommands = buildCreateIndexesCommands();
  return {
    envId,
    requiredCollections: [...V2_REQUIRED_COLLECTIONS],
    optionalCollections: ['rate_references'],
    indexCommands,
    cliCommands: indexCommands.map((command) =>
      `tcb db nosql execute -e ${envId} --command '${JSON.stringify(command)}'`,
    ),
  };
}

function printHuman(plan) {
  console.log('FamilyLedger v2 CloudBase schema plan');
  console.log('');
  console.log('Required collections (create missing collections first):');
  for (const collection of plan.requiredCollections) {
    console.log(`  - ${collection}`);
  }
  console.log('');
  console.log('Optional/future collection:');
  for (const collection of plan.optionalCollections) {
    console.log(`  - ${collection}`);
  }
  console.log('');
  console.log('Required index commands (CloudBase CLI v3+):');
  for (const command of plan.cliCommands) {
    console.log(command);
  }
  console.log('');
  console.log('Notes:');
  console.log('  - Run `tcb login` before executing the commands.');
  console.log('  - Collection creation is intentionally separate; use the CloudBase console or manager-node createCollectionIfNotExists.');
  console.log('  - Re-verify the exact index names, field order/direction and uniqueness after provisioning.');
  console.log('  - Do not create rate_references unless the optional reference-rate feature is enabled.');
}

try {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildPlan(args.envId);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    printHuman(plan);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
