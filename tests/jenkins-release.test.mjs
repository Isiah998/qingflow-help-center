import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const releaseScript = new URL('../scripts/jenkins-release.sh', import.meta.url);
const jenkinsfile = new URL('../Jenkinsfile', import.meta.url);

test('Jenkins release stages one search snapshot, deploys it, and then activates it', async () => {
  const source = await readFile(releaseScript, 'utf8');
  const buildIndex = source.indexOf('npm run build:jenkins');
  const stageIndex = source.indexOf('npm run search:push -- stage');
  const activateIndex = source.indexOf('npm run search:push -- activate');
  const deployIndex = source.indexOf('kubectl --namespace "${kube_namespace}" set image');

  assert.ok(buildIndex !== -1);
  assert.ok(stageIndex > buildIndex);
  assert.ok(activateIndex > stageIndex);
  assert.ok(deployIndex > stageIndex);
  assert.ok(activateIndex > deployIndex);
  assert.equal(source.match(/npm run build:jenkins/g)?.length, 1);
  assert.match(source, /TYPESENSE_TARGET_COLLECTION=.*content_revision/);
});

test('Jenkins release restores the search alias and Kubernetes revision on failure', async () => {
  const source = await readFile(releaseScript, 'utf8');
  const rollbackStart = source.indexOf('rollback_release()');
  const rollbackBody = source.slice(rollbackStart, source.indexOf('trap rollback_release EXIT'));

  assert.ok(rollbackStart !== -1);
  assert.match(rollbackBody, /npm run search:push -- restore/);
  assert.match(rollbackBody, /kubectl[\s\S]*rollout undo/);
  assert.match(rollbackBody, /kubectl[\s\S]*rollout status/);
});

test('Jenkins pipeline is serialized, bounded, scheduled, and restricted to main', async () => {
  const source = await readFile(jenkinsfile, 'utf8');

  assert.match(source, /disableConcurrentBuilds\(\)/);
  assert.match(source, /timeout\(time: 60, unit: 'MINUTES'\)/);
  assert.match(source, /cron\('H H\/6 \* \* \*'\)/);
  assert.match(source, /branch == 'main'/);
  assert.match(source, /bash scripts\/jenkins-release\.sh/);
});
