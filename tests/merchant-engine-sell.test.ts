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

function itemEcho(engine: MerchantEngine, name = 'Blue Hair', sprite = 321) {
  engine.processServerPacket(ServerOpCode.Exchange, exchange(ExchangeServerEvent.ItemAdded, w => {
    w.writeUint8(ExchangeParty.You); w.writeUint8(0); w.writeUint16(sprite);
    w.writeUint8(0); w.writeString8(name);
  }));
}

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
