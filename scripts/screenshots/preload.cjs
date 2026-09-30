// Fictional, offline data for documentation captures. Never loads the real IPC bridge.
// Item sprite IDs are from the public AislingExchange catalog; no network access at capture time.
const { contextBridge } = require('electron');
const noop = () => {};
const timestamp = '2026-01-15T14:30:00.000Z';
const inventory = [
  ['Gold Bar', 4529, 12], ['Ancient Hy-Brasyl Azoth', 3256, 1],
  ['Hy-Brasyl Helm', 1755, 1], ['Abundance Hy-Brasyl Gauntlet', 229, 1],
  ['Abundance Hy-Brasyl Greaves', 240, 1], ['Abundance Hy-Brasyl Bracer', 226, 1],
  ['Curative Potion', 2289, 60], ['Bless Potion', 2285, 40],
  ['Chaos Ruby', 901, 8], ['Emerald Ring', 213, 1], ['Feathered Sapphire Earring', 1428, 1],
  ['Deoch Potion', 2113, 20], ['Blessed Ruby Ring', 210, 1], ['Emerald Pearl Necklace', 1580, 1],
  ['Abundance Hy-Brasyl Shield', 94, 1], ['Ancient Hy-Brasyl Tonfa', 3255, 1], ['Emerald Sword', 177, 1],
  ['Dark Hy-Brasyl Belt', 237, 1],
].map(([name, sprite, quantity], i) => ({
  slot: i + 1, name, sprite, quantity, color: 0,
  isStackable: quantity > 1, maxDurability: 100, durability: 100,
}));
const listings = [
  { type: 'SELL', itemName: 'Ancient Hy-Brasyl Azoth', price: 12500000, quantity: 1, notes: 'Ready for your next adventure.' },
  { type: 'SELL', itemName: 'Gold Bar', price: 50000000, quantity: 12, notes: 'Single bars available.' },
  { type: 'SELL', itemName: 'Curative Potion', price: 150000, quantity: 60, stackSize: 10, notes: 'Supplies for the long road.' },
  { type: 'BUY', itemName: 'Chaos Ruby', price: 850000, quantity: 20, notes: 'Buying up to 20. Whisper to trade.' },
  { type: 'TRADE', itemName: 'Hy-Brasyl Helm', price: 0, quantity: 1, wantedItems: [{ name: 'Abundance Hy-Brasyl Bracer', quantity: 1 }], notes: 'One-for-one equipment swap.' },
].map((item, i) => ({ id: `sample-${i}`, characterName: 'Aurelia', status: 'ACTIVE',
  quantityRemaining: item.quantity, syncToAe: true, createdAt: timestamp, updatedAt: timestamp, ...item }));
const whispers = [
  { playerName: 'Rowan', message: 'Hi! Buying 10 Curative Potion, please.', matchedListing: listings[2] },
  { playerName: 'Elowen', message: 'Is your Ancient Hy-Brasyl Azoth still available?', matchedListing: listings[0] },
].map((item, i) => ({ ...item, characterName: 'Aurelia', timestamp: Date.parse(timestamp) - i * 180000 }));
const transactions = [
  { counterpartyName: 'Rowan', type: 'SELL', itemsGiven: [{ name: 'Curative Potion', quantity: 10 }], itemsReceived: [], goldGiven: 0, goldReceived: 150000 },
  { counterpartyName: 'Elowen', type: 'SELL', itemsGiven: [{ name: 'Gold Bar', quantity: 2 }], itemsReceived: [], goldGiven: 0, goldReceived: 100000000 },
  { counterpartyName: 'Thorne', type: 'BUY', itemsGiven: [], itemsReceived: [{ name: 'Chaos Ruby', quantity: 5 }], goldGiven: 4250000, goldReceived: 0 },
  { counterpartyName: 'Briar', type: 'TRADE', itemsGiven: [{ name: 'Hy-Brasyl Helm', quantity: 1 }], itemsReceived: [{ name: 'Abundance Hy-Brasyl Bracer', quantity: 1 }], goldGiven: 0, goldReceived: 0 },
].map((item, i) => ({ ...item, id: `trade-${i}`, listingId: `sample-${i}`, characterName: 'Aurelia', status: 'COMPLETED', timestamp: new Date(Date.parse(timestamp) - i * 900000).toISOString() }));
contextBridge.exposeInMainWorld('merchantMode', {
  debug: { isDev: async () => false },
  proxy: { getStatus: async () => 'connected', onStatus: noop, onPacket: noop },
  characters: { list: async () => [{ name: 'Aurelia', connectionType: 'launched' }, { name: 'Caelum', connectionType: 'launched' }], onConnected: noop, onDisconnected: noop },
  engine: { getState: async () => 'IDLE', getWhispers: async () => whispers, onState: noop, onWhisper: noop, onTransaction: noop, onExchangeStarted: noop, onValidationFailed: noop },
  listings: { getAll: async () => listings, getActive: async () => listings, onChanged: noop },
  inventory: { get: async () => inventory, getGold: async () => 187500000, onUpdate: noop, onGoldUpdate: noop },
  transactions: { getAll: async () => transactions, getByDate: async () => transactions },
  merchants: { getAll: async () => [], onUpdated: noop },
  ae: { getSprite: async () => null, getAvatar: async () => null,
    getAuthStatus: async () => ({ loggedIn: true, username: 'Aurelia', verified: true }), onAuthChanged: noop,
    getSyncStatuses: async (ids) => Object.fromEntries(ids.map(id => [id, 'synced'])) },
  settings: { get: async (_key, fallback = '') => fallback, set: async () => {} },
  sniffer: { getLog: async () => [] },
  reconnect: { getState: async () => [], onStatus: noop },
  updater: { onStatus: noop },
  removeAllListeners: noop,
});
