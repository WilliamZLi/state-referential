import { test } from 'node:test';
import assert from 'node:assert';
import { makeLog } from '../../src/util/log.js';

test('makeLog returns scoped methods that prefix scope', () => {
  const calls = [];
  const fakeConsole = {
    log: (...a) => calls.push(['log', ...a]),
    warn: (...a) => calls.push(['warn', ...a]),
    error: (...a) => calls.push(['error', ...a]),
  };
  const log = makeLog('tracker:engine', fakeConsole);
  log.info('hello', 1);
  log.warn('oops');
  log.error('bad');
  assert.deepStrictEqual(calls, [
    ['log', '[tracker:engine]', 'hello', 1],
    ['warn', '[tracker:engine]', 'oops'],
    ['error', '[tracker:engine]', 'bad'],
  ]);
});

test('log.debug is silent unless DEBUG flag set on returned object', () => {
  const calls = [];
  const log = makeLog('x', { log: (...a) => calls.push(a) });
  log.debug('nope');
  assert.strictEqual(calls.length, 0);
  log.DEBUG = true;
  log.debug('yes');
  assert.deepStrictEqual(calls, [['[x]', 'yes']]);
});
