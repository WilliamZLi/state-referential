import { test } from 'node:test';
import assert from 'node:assert';
import { readConsentPrompts } from '../../src/nemo/consent.js';

test('reads enabled consent prompts live, in ID order, keeping roles', () => {
  const db = { 'v11-254-consent-consent-user': { role: 'user', content: 'U {{user}}' },
               'v11-248-utility-extreme-content': { role: 'user', content: '  ' },
               'v11-255-consent-consent-acknowledged': { role: 'assistant', content: 'ACK' } };
  const out = readConsentPrompts({ getPromptById: id => db[id], isDisabled: () => false, substitute: s => s.replace('{{user}}', 'Ivar') });
  assert.deepStrictEqual(out, [{ role: 'user', content: 'U Ivar' }, { role: 'assistant', content: 'ACK' }]);
});
test('skips disabled and missing prompts', () => {
  const out = readConsentPrompts({ getPromptById: id => id.endsWith('user') ? { role: 'user', content: 'U' } : undefined,
    isDisabled: () => true, substitute: s => s });
  assert.deepStrictEqual(out, []);
});
