import test from 'node:test';
import assert from 'node:assert/strict';
import { MerchantEngine, MerchantState, type SellReservation } from '../core/engine/merchant-engine';
import { InventoryTracker } from '../core/engine/inventory-tracker';
import { ServerOpCode } from '../core/network/packets/op-codes';
import { BinaryWriter } from '../core/network/serialization/binary-writer';
import { ExchangeParty, ExchangeServerEvent } from '../core/network/packets/exchange/exchange-types';
import type { MerchantListing } from '../core/models/listing';
import acceptedFixtures from './fixtures/exchange-event5.json';

const listing = (): MerchantListing => ({
  id: 'sale', characterName: 'Merchant', type: 'SELL', itemName: 'Blue Hair',
  price: 100, quantity: 100, quantityRemaining: 100, stackSize: 10,
  status: 'ACTIVE', createdAt: '', updatedAt: '',
});

function exchange(event: number, write?: (w: BinaryWriter) => void): Uint8Array {
  const writer = new BinaryWriter();
  writer.writeUint8(event);
  write?.(writer);
  return writer.toArray();
}

function fixture() {
  const inventory = new InventoryTracker();
  inventory.getState().gold = 1_000;
  inventory.getState().items.set(7, {
    slot: 7, sprite: 321, color: 0, name: 'Blue Hair', quantity: 50,
    isStackable: true, maxDurability: 0, durability: 0,
  });
  const engine = new MerchantEngine(inventory);
  const sale = listing();
  engine.setListings([sale]);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.Started, w => {
    w.writeUint32(99); w.writeString8('Buyer');
  }));
  return { engine, inventory, sale };
}

function gold(engine: MerchantEngine, amount = 100) {
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.GoldAdded, w => {
    w.writeUint8(ExchangeParty.Them); w.writeUint32(amount);
  }));
}

function accepted(engine: MerchantEngine, subtype: ExchangeParty) {
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.Accepted, w => w.writeUint8(subtype)));
}

function itemEcho(engine: MerchantEngine, name = 'Blue Hair', sprite = 321, index = 0) {
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
    w.writeUint8(ExchangeParty.You); w.writeUint8(index); w.writeUint16(sprite);
    w.writeUint8(0); w.writeString8(name);
  }));
}

function stickFixture() {
  const inventory = new InventoryTracker();
  inventory.getState().items.set(1, {
    slot: 1, sprite: 0x8000 | 86, color: 0, name: 'stick', quantity: 1,
    isStackable: false, maxDurability: 100, durability: 100,
  });
  const engine = new MerchantEngine(inventory);
  const sale = { ...listing(), itemName: 'stick', price: 1000, quantity: 1,
    quantityRemaining: 1, stackSize: undefined };
  engine.setListings([sale]);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.Started, w => {
    w.writeUint32(99); w.writeString8('Buyer');
  }));
  return { engine, sale, inventory };
}

function borimFixture(stackSize?: number) {
  const inventory = new InventoryTracker();
  inventory.getState().items.set(1, {
    slot: 1, sprite: 0x8000 | 1504, color: 0, name: 'Borim', quantity: 99,
    isStackable: true, maxDurability: 0, durability: 0,
  });
  const engine = new MerchantEngine(inventory);
  const sale = { ...listing(), itemName: 'Borim', price: 500_000,
    quantity: 99, quantityRemaining: 99, stackSize };
  engine.setListings([sale]);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.Started, w => {
    w.writeUint32(99); w.writeString8('Buyer');
  }));
  return { engine, inventory, sale };
}

test('per-unit Borim sales accept server stack counts and record the full multi-item sale', () => {
  for (const quantity of [2, 4]) {
    const { engine, inventory, sale } = borimFixture();
    const fills: SellReservation[] = [];
    const stack: number[][] = [];
    let cancelled = 0;
    let accepts = 0;
    engine.on('requestFillSell', r => fills.push(r));
    engine.on('requestFillSellStack', (...args: number[]) => stack.push(args));
    engine.on('requestCancel', () => cancelled++);
    engine.on('requestAccept', () => accepts++);

    gold(engine, 500_000 * quantity);
    assert.equal(fills.length, 1);
    assert.equal(fills[0].quantity, quantity);
    engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.QuantityPrompt, w => w.writeUint8(1)));
    assert.deepEqual(stack, [[99, 1, quantity]]);
    accepted(engine, ExchangeParty.Them);
    assert.equal(accepts, 0);
    itemEcho(engine, `Borim(${quantity})`, 34272, 1);
    assert.equal(cancelled, 0);
    assert.equal(accepts, 0, 'placement invalidates the early buyer acceptance');
    accepted(engine, ExchangeParty.Them);
    assert.equal(accepts, 1);
    accepted(engine, ExchangeParty.You);

    inventory.getItem(1)!.quantity = 99 - quantity;
    inventory.emit('itemAdded');
    assert.equal(engine.getTransactions().length, 0);
    inventory.getState().gold = 500_000 * quantity;
    inventory.emit('goldUpdated');
    inventory.emit('goldUpdated');
    assert.equal(engine.getTransactions().length, 1);
    assert.deepEqual(engine.getTransactions()[0].itemsGiven, [{ name: 'Borim', quantity }]);
    assert.equal(engine.getTransactions()[0].goldReceived, 500_000 * quantity);
    assert.equal(sale.quantityRemaining, 99 - quantity);
  }
});

test('sell-as-stack pricing accepts the exact reserved server stack count', () => {
  const { engine } = borimFixture(2);
  let cancelled = 0;
  let accepts = 0;
  engine.on('requestCancel', () => cancelled++);
  engine.on('requestAccept', () => accepts++);
  gold(engine, 1_000_000); // two stacks of two, priced at 500k per stack
  itemEcho(engine, 'Borim(4)', 34272, 1);
  assert.equal(cancelled, 0);
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 1);
});

test('wrong or malformed stack counts and different item names cannot confirm a sale', () => {
  for (const name of ['Borim(1)', 'Borim(4)', 'Borim(0)', 'Borim(-2)', 'Borim(2.0)',
    'Borim(02)', 'Borim(2) extra', 'Borim of Power(2)']) {
    const { engine } = borimFixture();
    let cancelled = 0;
    let accepts = 0;
    engine.on('requestCancel', () => cancelled++);
    engine.on('requestAccept', () => accepts++);
    gold(engine, 1_000_000);
    itemEcho(engine, name, 34272, 1);
    accepted(engine, ExchangeParty.Them);
    assert.equal(cancelled, 1, name);
    assert.equal(accepts, 0, name);
  }
});

test('stack count cannot disguise a wrong sprite or a nonstackable sale item', () => {
  for (const stackable of [true, false]) {
    const { engine, inventory } = borimFixture();
    if (!stackable) {
      inventory.getItem(1)!.isStackable = false;
      inventory.getItem(1)!.quantity = 1;
    }
    let cancelled = 0;
    engine.on('requestCancel', () => cancelled++);
    gold(engine, 500_000);
    itemEcho(engine, 'Borim(1)', stackable ? 1505 : 34272, 1);
    assert.equal(cancelled, 1);
  }
});

test('gold reserves and places the item before buyer Accept, only once', () => {
  const { engine } = fixture();
  const fills: SellReservation[] = [];
  let accepts = 0;
  engine.on('requestFillSell', r => fills.push(r));
  engine.on('requestAccept', () => accepts++);
  gold(engine);
  gold(engine);
  assert.equal(fills.length, 1);
  assert.deepEqual(fills[0].slots.map(s => [s.slot, s.quantity]), [[7, 10]]);
  assert.equal(accepts, 0);
});

test('matching stack prompt sends exact reserved slot and quantity; echo precedes Accept', () => {
  const { engine } = fixture();
  const stack: number[][] = [];
  let accepts = 0;
  engine.on('requestFillSellStack', (...args: number[]) => stack.push(args));
  engine.on('requestAccept', () => accepts++);
  gold(engine);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.QuantityPrompt, w => w.writeUint8(7)));
  assert.deepEqual(stack, [[99, 7, 10]]);
  accepted(engine, ExchangeParty.Them); // early acceptance is invalidated by our echo
  assert.equal(accepts, 0);
  itemEcho(engine);
  assert.equal(accepts, 0);
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 1);
});

test('item echo with different sprite flag bits still confirms the reserved item', () => {
  const { engine, inventory } = fixture();
  inventory.getState().items.get(7)!.sprite = 0x8000 | 321;
  let cancelled = 0;
  let accepts = 0;
  engine.on('requestCancel', () => cancelled++);
  engine.on('requestAccept', () => accepts++);
  gold(engine);
  itemEcho(engine, 'Blue Hair', 321);
  assert.equal(cancelled, 0);
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 1);
});

test('durability percentage in a server item echo confirms the exact reserved sale item', () => {
  const { engine, inventory, sale } = stickFixture();
  let cancelled = 0;
  let accepts = 0;
  let completed = 0;
  engine.on('requestCancel', () => cancelled++);
  engine.on('requestAccept', () => accepts++);
  engine.on('transactionCompleted', () => completed++);
  gold(engine, 1000);
  itemEcho(engine, 'Stick 100%', 0x8000 | 86, 1);
  assert.equal(cancelled, 0);
  assert.equal(accepts, 0);
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 1);
  accepted(engine, ExchangeParty.You);
  engine.processServerPacket(ServerOpCode.Exchange, Buffer.from(acceptedFixtures.exchangeCompleted, 'hex'));
  assert.equal(completed, 0);
  inventory.getState().items.delete(1);
  inventory.emit('itemRemoved');
  inventory.getState().gold = 1000;
  inventory.emit('goldUpdated');
  assert.equal(completed, 1);
  assert.equal(sale.quantityRemaining, 0);
});

test('a different item name or invalid durability suffix cannot confirm the sale', () => {
  for (const echoedName of ['Stick of Power 100%', 'Stick 101%']) {
    const { engine } = stickFixture();
    let cancelled = 0;
    engine.on('requestCancel', () => cancelled++);
    gold(engine, 1000);
    itemEcho(engine, echoedName, 0x8000 | 86, 1);
    assert.equal(cancelled, 1, echoedName);
  }
});

test('a valid durability suffix remains display metadata for the same item', () => {
  const { engine } = stickFixture();
  let cancelled = 0;
  engine.on('requestCancel', () => cancelled++);
  gold(engine, 1000);
  itemEcho(engine, 'Stick 80%', 0x8000 | 86, 1);
  assert.equal(cancelled, 0);
});

test('item echo with a different base sprite still cancels the sale', () => {
  const { engine } = fixture();
  let cancelled = 0;
  let reason = '';
  engine.on('requestCancel', () => cancelled++);
  engine.on('validationFailed', (message: string) => reason = message);
  gold(engine);
  itemEcho(engine, 'Blue Hair', 0x8000 | 322);
  assert.equal(cancelled, 1);
  assert.match(reason, /expected.*Blue Hair.*321.*received.*322/i);
});

test('a canceled exchange discards its old match so a retry uses the current listing', () => {
  const { engine, sale } = fixture();
  const fills: SellReservation[] = [];
  engine.on('requestFillSell', r => fills.push(r));
  gold(engine);
  gold(engine, 200); // changed offer cancels this exchange
  assert.equal(engine.getWhisperQueue().length, 0);
  engine.setListings([{ ...sale, price: 1000 }]);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.Started, w => {
    w.writeUint32(99); w.writeString8('Buyer');
  }));
  gold(engine, 1000);
  assert.equal(fills.length, 2);
  assert.equal(fills[1].price, 1000);
});

test('changed gold or extra buyer items cancel an approved sale', () => {
  for (const change of ['gold', 'item']) {
    const { engine } = fixture();
    let cancelled = 0;
    engine.on('requestCancel', () => cancelled++);
    gold(engine);
    if (change === 'gold') gold(engine, 200);
    else engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
      w.writeUint8(ExchangeParty.Them); w.writeUint8(0); w.writeUint16(9); w.writeUint8(0); w.writeString8('Extra');
    }));
    assert.equal(cancelled, 1, change);
    assert.equal(engine.getState(), MerchantState.IDLE);
  }
});

test('missing item echo never sends Accept', () => {
  const { engine } = fixture();
  let accepts = 0;
  engine.on('requestAccept', () => accepts++);
  gold(engine);
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 0);
});

test('missing item echo cancels when the exchange times out', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { engine } = fixture();
  let cancelled = 0;
  engine.on('requestCancel', () => cancelled++);
  gold(engine);
  t.mock.timers.tick(60_000);
  assert.equal(cancelled, 1);
  assert.equal(engine.getState(), MerchantState.IDLE);
});

test('multi-item nonstackable sale reserves each slot and waits for every echo', () => {
  const { engine, inventory, sale } = fixture();
  sale.stackSize = undefined;
  inventory.getState().items.clear();
  for (const slot of [2, 4, 6]) {
    inventory.getState().items.set(slot, {
      slot, sprite: 321, color: 0, name: 'Blue Hair', quantity: 1,
      isStackable: false, maxDurability: 0, durability: 0,
    });
  }
  let reserved: SellReservation | undefined;
  let accepts = 0;
  engine.on('requestFillSell', r => reserved = r);
  engine.on('requestAccept', () => accepts++);
  gold(engine, 300);
  assert.deepEqual(reserved?.slots.map(s => s.slot), [2, 4, 6]);
  accepted(engine, ExchangeParty.Them);
  itemEcho(engine);
  itemEcho(engine);
  assert.equal(accepts, 0);
  itemEcho(engine);
  assert.equal(accepts, 0, 'item placement resets the earlier acceptance');
  accepted(engine, ExchangeParty.Them);
  assert.equal(accepts, 1);
});

test('wrong price or stack prompt cancels the sale', () => {
  const wrongPrice = fixture();
  let priceCancels = 0;
  wrongPrice.engine.on('requestCancel', () => priceCancels++);
  gold(wrongPrice.engine, 125);
  assert.equal(priceCancels, 1);

  const wrongPrompt = fixture();
  let promptCancels = 0;
  let stackReplies = 0;
  wrongPrompt.engine.on('requestCancel', () => promptCancels++);
  wrongPrompt.engine.on('requestFillSellStack', () => stackReplies++);
  gold(wrongPrompt.engine);
  wrongPrompt.engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.QuantityPrompt, w => w.writeUint8(8)));
  assert.equal(promptCancels, 1);
  assert.equal(stackReplies, 0);
});

test('BUY and TRADE still fill when the partner item appears', () => {
  for (const kind of ['BUY', 'TRADE'] as const) {
    const { engine, sale } = fixture();
    sale.type = kind;
    if (kind === 'TRADE') sale.wantedItems = [{ name: 'Wanted Item', quantity: 1 }];
    let fills = 0;
    engine.on(kind === 'BUY' ? 'requestFillBuy' : 'requestFillTrade', () => fills++);
    engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
      w.writeUint8(ExchangeParty.Them); w.writeUint8(0); w.writeUint16(123);
      w.writeUint8(0); w.writeString8(kind === 'BUY' ? 'Blue Hair' : 'Wanted Item');
    }));
    assert.equal(fills, 1, kind);
  }
});

test('a SELL exchange cancels immediately when the partner offers an unrelated item', () => {
  const { engine } = fixture();
  let cancels = 0;
  let fills = 0;
  engine.on('requestCancel', () => cancels++);
  engine.on('requestFillSell', () => fills++);
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
    w.writeUint8(ExchangeParty.Them); w.writeUint8(0); w.writeUint16(123);
    w.writeUint8(0); w.writeString8('Unlisted Item');
  }));
  assert.equal(cancels, 1);
  assert.equal(fills, 0);
  assert.equal(engine.getState(), MerchantState.IDLE);
});

test('BUY and TRADE exchanges cancel an unrelated partner item', () => {
  for (const kind of ['BUY', 'TRADE'] as const) {
    const { engine, sale } = fixture();
    sale.type = kind;
    if (kind === 'TRADE') sale.wantedItems = [{ name: 'Wanted Item', quantity: 1 }];
    let cancels = 0;
    let fills = 0;
    engine.on('requestCancel', () => cancels++);
    engine.on(kind === 'BUY' ? 'requestFillBuy' : 'requestFillTrade', () => fills++);
    engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
      w.writeUint8(ExchangeParty.Them); w.writeUint8(0); w.writeUint16(123);
      w.writeUint8(0); w.writeString8('Unlisted Item');
    }));
    assert.equal(cancels, 1, kind);
    assert.equal(fills, 0, kind);
    assert.equal(engine.getState(), MerchantState.IDLE, kind);
  }
});

test('BUY and TRADE cancel an extra unrelated item after a matching item', () => {
  for (const kind of ['BUY', 'TRADE'] as const) {
    const { engine, sale } = fixture();
    sale.type = kind;
    if (kind === 'TRADE') sale.wantedItems = [{ name: 'Wanted Item', quantity: 1 }];
    let cancels = 0;
    let accepts = 0;
    engine.on('requestCancel', () => cancels++);
    engine.on('requestAccept', () => accepts++);
    for (const name of [kind === 'BUY' ? 'Blue Hair' : 'Wanted Item', 'Unlisted Item']) {
      engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
        w.writeUint8(ExchangeParty.Them); w.writeUint8(0); w.writeUint16(123);
        w.writeUint8(0); w.writeString8(name);
      }));
    }
    assert.equal(cancels, 1, kind);
    assert.equal(engine.getState(), MerchantState.IDLE, kind);
    engine.onFillComplete(); // a delayed fill callback must not accept the cancelled exchange
    assert.equal(accepts, 0, kind);
    assert.equal(engine.getState(), MerchantState.IDLE, kind);
  }
});

test('event-5 party subtypes are acceptance flags; subtype 2 plus inventory and gold completes once', () => {
  const { engine, inventory, sale } = fixture();
  let completed = 0;
  engine.on('transactionCompleted', () => completed++);
  gold(engine);
  itemEcho(engine);
  engine.processServerPacket(ServerOpCode.Exchange, Buffer.from(acceptedFixtures.partnerAccepted, 'hex'));
  engine.processServerPacket(ServerOpCode.Exchange, Buffer.from(acceptedFixtures.youAccepted, 'hex'));
  assert.equal(completed, 0, 'two acceptance flags are not final proof');
  engine.processServerPacket(ServerOpCode.Exchange, Buffer.from(acceptedFixtures.exchangeCompleted, 'hex'));
  assert.equal(completed, 0, 'server result still needs authoritative deltas');
  inventory.getState().items.get(7)!.quantity = 40;
  inventory.emit('itemAdded');
  inventory.getState().gold = 1_100;
  inventory.emit('goldUpdated');
  assert.equal(completed, 1);
  assert.equal(sale.quantityRemaining, 90);
  inventory.emit('goldUpdated');
  assert.equal(completed, 1);
});

test('sale decrements the current listing after inventory-driven listing reload', () => {
  const { engine, inventory, sale } = stickFixture();
  let completed = 0;
  let recordedPrice = 0;
  engine.on('transactionCompleted', (tx) => { completed++; recordedPrice = tx.goldReceived; });
  gold(engine, 1000);
  itemEcho(engine, 'Stick 100%', 0x8000 | 86, 1);
  accepted(engine, ExchangeParty.Them);
  accepted(engine, ExchangeParty.You);
  engine.processServerPacket(ServerOpCode.Exchange, Buffer.from(acceptedFixtures.exchangeCompleted, 'hex'));

  inventory.getState().items.delete(1);
  inventory.emit('itemRemoved');
  engine.setListings([{ ...sale, price: 2000, status: 'PAUSED' }]); // main process reloads on inventory removal
  inventory.getState().gold = 1000;
  inventory.emit('goldUpdated');

  assert.equal(completed, 1);
  assert.equal(recordedPrice, 1000, 'record the agreed sale price even if the listing changed');
  assert.equal(engine.getListings()[0].quantityRemaining, 0);
  assert.equal(engine.getListings()[0].status, 'SOLD_OUT');
});

test('both server acceptance echoes plus exact inventory and gold changes complete a sale without subtype 2', () => {
  const { engine, inventory, sale } = stickFixture();
  let completed = 0;
  engine.on('transactionCompleted', () => completed++);
  inventory.on('itemRemoved', () => engine.setListings([{ ...sale, status: 'PAUSED' }]));
  gold(engine, 1000);
  itemEcho(engine, 'Stick 100%', 0x8000 | 86, 1);
  accepted(engine, ExchangeParty.Them);
  accepted(engine, ExchangeParty.You);
  assert.equal(completed, 0, 'acceptance echoes alone do not prove completion');
  engine.processServerPacket(ServerOpCode.RemoveItemFromPane, Uint8Array.of(1));
  assert.equal(completed, 0, 'item leaving inventory during the exchange is not enough');
  const attributes = new BinaryWriter();
  attributes.writeUint8(0x08); // ExperienceGold field
  for (let i = 0; i < 5; i++) attributes.writeUint32(0);
  attributes.writeUint32(1000);
  engine.processServerPacket(ServerOpCode.Attributes, attributes.toArray());
  assert.equal(inventory.getItem(1), undefined);
  assert.equal(inventory.getGold(), 1000);
  assert.equal(completed, 1);
  assert.equal(engine.getListings()[0].quantityRemaining, 0);
});
