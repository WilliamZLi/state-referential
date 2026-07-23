import { test } from 'node:test';
import assert from 'node:assert';
import { subFieldToRow, rowToSubField } from '../../src/ui/structSchemaForm.js';

test('rowToSubField: enum splits options by newline, drops blanks', () => {
  const sf = rowToSubField({ id: 'status', label: 'Status', type: 'enum', optionsText: 'open\n fulfilled \n\nfailed', minText: '' });
  assert.deepEqual(sf, { id: 'status', label: 'Status', type: 'enum', options: ['open', 'fulfilled', 'failed'] });
});

test('rowToSubField: number parses min, defaults to 0 when blank', () => {
  assert.deepEqual(rowToSubField({ id: 'amount', label: 'Amount', type: 'number', optionsText: '', minText: '' }),
    { id: 'amount', label: 'Amount', type: 'number', min: 0 });
  assert.deepEqual(rowToSubField({ id: 'amount', label: 'Amount', type: 'number', optionsText: '', minText: '5' }),
    { id: 'amount', label: 'Amount', type: 'number', min: 5 });
});

test('rowToSubField: text omits options/min; blank id → null', () => {
  assert.deepEqual(rowToSubField({ id: 'detail', label: 'Detail', type: 'text', optionsText: 'x', minText: '3' }),
    { id: 'detail', label: 'Detail', type: 'text' });
  assert.equal(rowToSubField({ id: '', label: '', type: 'text', optionsText: '', minText: '' }), null);
});

test('subFieldToRow: inverse display values', () => {
  assert.deepEqual(subFieldToRow({ id: 'status', label: 'Status', type: 'enum', options: ['open', 'failed'] }),
    { id: 'status', label: 'Status', type: 'enum', optionsText: 'open\nfailed', minText: '' });
  assert.deepEqual(subFieldToRow({ id: 'amount', label: 'Amount', type: 'number', min: 0 }),
    { id: 'amount', label: 'Amount', type: 'number', optionsText: '', minText: '0' });
});
