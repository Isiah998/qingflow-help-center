import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {loadLocalEnvironment} from './lib/load-env.mjs';
import {
  activateTypesenseAlias,
  getTypesenseAlias,
  restoreTypesenseAlias,
  syncTypesense,
  validateTypesenseCollection,
} from './lib/typesense-sync.mjs';

loadLocalEnvironment();

const cwd = process.cwd();
const command = process.argv[2] ?? 'sync';
const recordsPath = path.join(cwd, '.tmp', 'search-records.json');
const statePath = path.join(cwd, '.tmp', 'typesense-release.json');

async function readRecords() {
  return JSON.parse(await readFile(recordsPath, 'utf8'));
}

async function readSynonymGroups() {
  return JSON.parse(
    await readFile(path.join(cwd, 'data', 'search-synonyms.json'), 'utf8'),
  );
}

function environment() {
  return {
    host: process.env.TYPESENSE_HOST,
    adminApiKey:
      process.env.TYPESENSE_ADMIN_API_KEY?.trim() ||
      process.env.TYPESENSE_API_KEY?.trim(),
    searchApiKey: process.env.TYPESENSE_SEARCH_API_KEY?.trim(),
    collection: process.env.TYPESENSE_COLLECTION ?? 'qingflow_help_docs',
    targetCollection: process.env.TYPESENSE_TARGET_COLLECTION?.trim(),
  };
}

async function writeReleaseState(state) {
  await mkdir(path.dirname(statePath), {recursive: true});
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, {mode: 0o600});
}

async function readReleaseState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    typeof state?.alias !== 'string' ||
    typeof state?.targetCollection !== 'string' ||
    !Number.isSafeInteger(state?.expectedRecords) ||
    state.expectedRecords < 1
  ) {
    throw new Error('Typesense release state is invalid. Run the stage command again.');
  }
  return state;
}

async function syncCurrentCollection() {
  const records = await readRecords();
  const synonymGroups = await readSynonymGroups();
  const {host, adminApiKey, collection} = environment();
  await syncTypesense({
    host,
    apiKey: adminApiKey,
    collection,
    records,
    synonymGroups,
  });
}

async function stageVersionedCollection() {
  const records = await readRecords();
  const synonymGroups = await readSynonymGroups();
  const {host, adminApiKey, collection: alias, targetCollection} = environment();
  if (!targetCollection) throw new Error('TYPESENSE_TARGET_COLLECTION is required for staging.');
  if (targetCollection === alias) {
    throw new Error('Typesense target collection must differ from the stable alias.');
  }

  const previousCollection = await getTypesenseAlias({
    host,
    apiKey: adminApiKey,
    alias,
  });
  await syncTypesense({
    host,
    apiKey: adminApiKey,
    collection: targetCollection,
    records,
    synonymGroups,
  });
  await validateTypesenseCollection({
    host,
    apiKey: adminApiKey,
    collection: targetCollection,
    expectedRecords: records.length,
  });
  await writeReleaseState({
    alias,
    targetCollection,
    previousCollection: previousCollection ?? null,
    expectedRecords: records.length,
  });
  console.log(`Staged and validated ${records.length} records in ${targetCollection}.`);
}

async function activateVersionedCollection() {
  const state = await readReleaseState();
  const {host, adminApiKey, searchApiKey} = environment();
  if (!searchApiKey) throw new Error('TYPESENSE_SEARCH_API_KEY is required for activation.');
  await activateTypesenseAlias({
    host,
    adminApiKey,
    searchApiKey,
    alias: state.alias,
    collection: state.targetCollection,
    previousCollection: state.previousCollection,
    expectedRecords: state.expectedRecords,
  });
  console.log(`Activated Typesense alias ${state.alias} -> ${state.targetCollection}.`);
}

async function restorePreviousCollection() {
  const state = await readReleaseState();
  const {host, adminApiKey} = environment();
  await restoreTypesenseAlias({
    host,
    apiKey: adminApiKey,
    alias: state.alias,
    previousCollection: state.previousCollection,
  });
  console.log(
    state.previousCollection
      ? `Restored Typesense alias ${state.alias} -> ${state.previousCollection}.`
      : `Removed newly-created Typesense alias ${state.alias}.`,
  );
}

async function main() {
  if (command === 'sync') return syncCurrentCollection();
  if (command === 'stage') return stageVersionedCollection();
  if (command === 'activate') return activateVersionedCollection();
  if (command === 'restore') return restorePreviousCollection();
  throw new Error(`Unknown Typesense push command: ${command}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
