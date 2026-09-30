import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticGroupTitle, groupAppearance, customGroupEnabled, DEFAULT_GROUP_DESCRIPTION, LEGACY_GROUP_TITLE, LEGACY_GROUP_DESCRIPTION } from '../core/engine/merchant-group';
import type { MerchantListing } from '../core/models/listing';

const listing = (type: MerchantListing['type'], status: MerchantListing['status'] = 'ACTIVE', remaining = 1) =>
  ({ type, status, quantityRemaining: remaining });

test('automatic group title reflects active listing types', () => {
  assert.equal(automaticGroupTitle([listing('SELL')]), 'S> ITEMS');
  assert.equal(automaticGroupTitle([listing('BUY')]), 'B> ITEMS');
  assert.equal(automaticGroupTitle([listing('TRADE')]), 'T> ITEMS');
  assert.equal(automaticGroupTitle([listing('BUY'), listing('SELL')]), 'B/S> ITEMS');
  assert.equal(automaticGroupTitle([listing('SELL'), listing('TRADE')]), 'S/T> ITEMS');
  assert.equal(automaticGroupTitle([listing('BUY'), listing('TRADE')]), 'B/T> ITEMS');
  assert.equal(automaticGroupTitle([listing('BUY'), listing('SELL'), listing('TRADE')]), 'B/S/T> ITEMS');
  assert.equal(automaticGroupTitle([listing('BUY'), listing('SELL', 'PAUSED'), listing('TRADE', 'ACTIVE', 0)]), 'B> ITEMS');
});

test('group appearance defaults to auto but allows a custom title and description', () => {
  const listings = [listing('BUY'), listing('SELL')];
  assert.deepEqual(groupAppearance(listings, false, 'My shop', 'Custom message'), {
    title: 'B/S> ITEMS', description: DEFAULT_GROUP_DESCRIPTION,
  });
  assert.deepEqual(groupAppearance(listings, true, 'My shop', 'Custom message'), {
    title: 'My shop', description: 'Custom message',
  });
});

test('explicit group mode wins and legacy custom messages remain custom', () => {
  assert.equal(customGroupEnabled('true', LEGACY_GROUP_TITLE, LEGACY_GROUP_DESCRIPTION), true);
  assert.equal(customGroupEnabled('false', 'My shop', 'Custom'), false);
  assert.equal(customGroupEnabled('', LEGACY_GROUP_TITLE, LEGACY_GROUP_DESCRIPTION), false);
  assert.equal(customGroupEnabled('', 'My shop', LEGACY_GROUP_DESCRIPTION), true);
  assert.equal(customGroupEnabled('', LEGACY_GROUP_TITLE, 'My message'), true);
});
