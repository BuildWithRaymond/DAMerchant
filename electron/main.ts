import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import { mkdirSync } from 'fs';
import { ProxyServer } from '../core/proxy/proxy-server';
import { ProxyConnection } from '../core/proxy/proxy-connection';
import { MerchantEngine, type SellReservation } from '../core/engine/merchant-engine';
import { customGroupEnabled, groupAppearance, LEGACY_GROUP_TITLE, LEGACY_GROUP_DESCRIPTION } from '../core/engine/merchant-group';
import { InventoryTracker } from '../core/engine/inventory-tracker';
import { LocationTracker } from '../core/engine/location-tracker';
import { MerchantHubClient } from '../core/network/merchant-hub-client';
import type { MerchantHubCharacter } from '../core/network/merchant-hub-client';
import { BinaryWriter } from '../core/network/serialization/binary-writer';
import { ClientOpCode, ServerOpCode } from '../core/network/packets/op-codes';
import { ExchangeClientAction } from '../core/network/packets/exchange/exchange-types';
import { ConnectionPhase } from '../core/proxy/connection-state';
import { launchClient, readCharacterName, closeClientHandles, terminateClient, clickThroughLoginScreens, type LaunchedClient } from '../core/launcher/client-launcher';
import * as db from '../core/db/database';
import type { MerchantListing } from '../core/models/listing';
import { AeApiClient } from '../core/ae/ae-api-client';
import { ItemCache } from '../core/ae/item-cache';
import { ListingSync } from '../core/ae/listing-sync';
import { patchDisplayAisling } from '../core/engine/display-modifier';
import { ReconnectManager } from '../core/reconnect/reconnect-manager';

// Keep existing listings, history and credentials in their original data directory.
// Changing productName otherwise changes Electron's default userData path.
const legacyUserDataPath = path.join(app.getPath('appData'), 'merchantmode');
mkdirSync(legacyUserDataPath, { recursive: true });
app.setPath('userData', legacyUserDataPath);

let mainWindow: BrowserWindow | null = null;
let proxyServer: ProxyServer | null = null;
const merchantHub = new MerchantHubClient();
const launchedClients: Map<number, LaunchedClient> = new Map();
const PROXY_PORT = 2615; // Local proxy port — avoids 2610-2612 which bots commonly bind
import { injectLogin } from '../core/reconnect/login-injector';

// Auto-reconnect manager — re-launches DA clients after server restarts
const reconnectManager = new ReconnectManager(async (_username, _password) => {
  const clientPath = db.getSetting('client_path', 'C:\\Program Files (x86)\\KRU\\Dark Ages\\Darkages.exe');
  if (!proxyServer?.isListening()) startProxy();
  const client = launchClient(clientPath, { localPort: PROXY_PORT, skipIntro: true });
  launchedClients.set(client.processId, client);
  // Click through Notification OK and Continue via mouse (background, non-blocking)
  // Login itself is handled via packet injection when LoginControls arrives
  clickThroughLoginScreens(client.processId).catch((err) => {
    console.error('[Reconnect] Click-through error:', err);
  });
  return { success: true, processId: client.processId };
});

// AE integration modules
const aeClient = new AeApiClient();
const itemCache = new ItemCache(aeClient);
const listingSync = new ListingSync(aeClient, itemCache);

// Per-character contexts — each connected character gets its own engine + inventory
interface CharacterContext {
  characterName: string;
  connectionType: 'launched' | 'bot';
  connection: ProxyConnection;
  engine: MerchantEngine;
  inventoryTracker: InventoryTracker;
  locationTracker: LocationTracker;
}
const characterContexts: Map<string, CharacterContext> = new Map();
const groupRefreshIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

// Packet log buffer for the sniffer UI
const packetLog: { direction: string; opCode: number; dataHex: string; timestamp: number; characterName?: string }[] = [];
const MAX_PACKET_LOG = 500;

// Buffer server packets that arrive before the character context is created.
// Key = characterName, value = array of {opCode, data} to replay once the context exists.
const preContextPacketBuffer: Map<string, { opCode: number; data: Uint8Array }[]> = new Map();

function send(channel: string, ...args: unknown[]) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'DAMerchant',
    icon: path.join(__dirname, '../../build/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }


  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Per-character context creation ---

function pushHubUpdate(): void {
  const characters: MerchantHubCharacter[] = [];
  for (const ctx of characterContexts.values()) {
    const loc = ctx.locationTracker.getLocation();
    const listings = ctx.engine.getListings()
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => ({
        type: l.type,
        itemName: l.itemName,
        price: l.price,
        status: l.status,
        quantity: l.quantity,
        quantityRemaining: l.quantityRemaining,
        stackSize: l.stackSize,
        wantedItems: l.wantedItems,
        notes: l.notes,
      }));
    characters.push({ name: ctx.characterName, mapName: loc.mapName, x: loc.x, y: loc.y, listings });
  }
  merchantHub.sendUpdate(characters);
}

function createCharacterContext(characterName: string, connection: ProxyConnection): CharacterContext {
  const inventoryTracker = new InventoryTracker();
  const locationTracker = new LocationTracker();
  const engine = new MerchantEngine(inventoryTracker);

  engine.setCharacterName(characterName);

  // Load per-character listings from DB
  const listings = db.getAllListings(characterName);
  engine.setListings(listings);

  // Engine events -> renderer (all include characterName)
  engine.on('stateChanged', (state: string) => {
    send('engine:state', { characterName, state });
  });

  // Track recent auto-reply targets to prevent reply loops
  const recentAutoReplies: Map<string, number> = new Map();

  engine.on('whisperReceived', (whisper: any) => {
    send('engine:whisper', { characterName, ...whisper });
    // Auto-reply only if enabled
    const autoReplyEnabled = db.getSetting('auto_reply_enabled', 'true');
    if (autoReplyEnabled !== 'true') return;

    // Rate-limit: don't auto-reply to the same player more than once per 10 seconds
    const playerKey = whisper.playerName.toLowerCase();
    const lastReply = recentAutoReplies.get(playerKey);
    if (lastReply && Date.now() - lastReply < 10_000) return;

    if (whisper.matchedListing) {
      const qty = whisper.requestedQuantity ?? 1;
      const listing = whisper.matchedListing;
      const totalPrice = listing.stackSize
        ? listing.price * Math.ceil(qty / listing.stackSize)
        : listing.price * qty;

      let msg: string;
      if (listing.type === 'TRADE') {
        const wantedEntry = listing.wantedItems?.[0];
        const offeredDisplay = listing.quantity > 1 ? `${listing.quantity}x ${listing.itemName}` : listing.itemName;
        const wantedDisplay = wantedEntry
          ? (wantedEntry.quantity > 1 ? `${wantedEntry.quantity}x ${wantedEntry.name}` : wantedEntry.name)
          : 'your item';
        const template = db.getSetting('reply_trade', 'I will trade {item} for {wanted}. Open exchange with me.');
        msg = template
          .replace('{item}', offeredDisplay)
          .replace('{wanted}', wantedDisplay);
      } else if (listing.type === 'BUY') {
        // We're buying — tell the seller our offer price
        const template = db.getSetting('reply_buying', 'I am buying {item} for {price}. Open exchange with me to sell.');
        const itemDisplay = qty > 1 ? `${qty}x ${listing.itemName}` : listing.itemName;
        msg = template
          .replace('{item}', itemDisplay)
          .replace('{price}', formatGold(totalPrice));
      } else {
        // We're selling
        const template = db.getSetting('reply_available', 'I have {item} for {price}. Open exchange with me to buy.');
        const itemDisplay = qty > 1 ? `${qty}x ${listing.itemName}` : listing.itemName;
        msg = template
          .replace('{item}', itemDisplay)
          .replace('{price}', formatGold(totalPrice));
      }
      recentAutoReplies.set(playerKey, Date.now());
      injectWhisper(characterName, whisper.playerName, msg);
    } else if (isListKeyword(whisper.message)) {
      // Keyword trigger — send full listing summary, split across multiple whispers if needed
      const summary = formatListingSummary(engine.getListings());
      const messages = splitWhisperMessage(summary);
      recentAutoReplies.set(playerKey, Date.now());
      messages.forEach((msg, i) => {
        setTimeout(() => injectWhisper(characterName, whisper.playerName, msg), i * 400);
      });
    }
    // No match and no keyword — ignore (don't reply to general conversation)
  });

  engine.on('exchangeStarted', (name: string) => {
    send('engine:exchange-started', { characterName, targetName: name });
  });

  engine.on('exchangeUpdated', (exchange: any) => {
    send('engine:exchange-updated', { characterName, exchange });
  });

  engine.on('exchangeCancelled', () => {
    send('engine:exchange-cancelled', { characterName });
  });

  engine.on('transactionCompleted', (tx: any) => {
    db.insertTransaction(tx);
    // Update listing in DB
    const listing = engine.getListings().find((l) => l.id === tx.listingId);
    if (listing) {
      db.updateListing(listing);
      // Sync updated listing to AE
      listingSync.syncUpdate(listing).catch(err => console.error('[AE Sync] tx-update failed:', err));
    }
    engine.emit('listingsUpdated', engine.getListings());
    send('listings:changed', { characterName });
    // Also sync transaction as a price entry on AE
    const txItem = tx.itemsGiven?.[0] || tx.itemsReceived?.[0];
    if (txItem) {
      listingSync.syncTransaction({
        itemName: txItem.name,
        type: tx.type,
        price: tx.goldReceived || tx.goldGiven || 0,
        quantity: txItem.quantity || 1,
      }).catch(err => console.error('[AE Sync] tx-price failed:', err));
    }
    send('engine:transaction', { characterName, ...tx });
  });

  engine.on('validationFailed', (reason: string) => {
    send('engine:validation-failed', { characterName, reason });
  });

  // Exchange automation: engine requests -> inject packets via proxy
  engine.on('requestBeginExchange', (targetId: number) => {
    injectExchangeAction(characterName, ExchangeClientAction.BeginExchange, targetId);
  });

  engine.on('requestCancel', (targetId: number) => {
    injectExchangeAction(characterName, ExchangeClientAction.Cancel, targetId);
  });

  engine.on('requestAccept', (targetId: number) => {
    injectExchangeAction(characterName, ExchangeClientAction.Accept, targetId);
  });

  engine.on('requestFillSell', (reservation: SellReservation, targetId: number) => {
    console.log(`[MerchantMode:${characterName}] FillSell: reserved ${reservation.quantity}x "${reservation.listing.itemName}" in ${reservation.slots.length} slot(s)`);
    for (const item of reservation.slots) injectExchangeAddItem(characterName, targetId, item.slot);
  });

  engine.on('requestFillSellStack', (targetId: number, slot: number, quantity: number) => {
    injectExchangeAddStackable(characterName, targetId, slot, quantity);
  });

  engine.on('requestFillBuy', (listing: MerchantListing, targetId: number, requestedQty: number) => {
    // Place gold for buying — total = price * quantity
    const totalPrice = listing.price * requestedQty;
    console.log(`[MerchantMode:${characterName}] FillBuy: placing ${totalPrice} gold (${listing.price} x ${requestedQty})`);
    injectExchangeSetGold(characterName, targetId, totalPrice);
    setTimeout(() => engine.onFillComplete(), 500);
  });

  engine.on('requestFillTrade', (listing: MerchantListing, targetId: number, requestedQty: number) => {
    // Trade: place our offered item from inventory (same mechanic as selling)
    const slot = inventoryTracker.findSlotByName(listing.itemName);
    console.log(`[MerchantMode:${characterName}] FillTrade: looking for "${listing.itemName}" to trade for "${listing.wantedItems?.[0]?.name}", found slot=${slot}`);
    if (slot !== undefined) {
      const item = inventoryTracker.getItem(slot);
      if (item?.isStackable) {
        const qty = Math.min(requestedQty, item.quantity);
        console.log(`[MerchantMode:${characterName}] Adding stackable trade item slot=${slot}, qty=${qty}`);
        engine.once('quantityPrompt', (promptSlot: number, promptTargetId: number) => {
          console.log(`[MerchantMode:${characterName}] QuantityPrompt received for slot=${promptSlot}, responding with qty=${qty}`);
          injectExchangeAddStackable(characterName, promptTargetId, promptSlot, qty);
          setTimeout(() => engine.onFillComplete(), 500);
        });
        injectExchangeAddItem(characterName, targetId, slot);
      } else {
        console.log(`[MerchantMode:${characterName}] Adding trade item slot=${slot} name="${item?.name}" to exchange`);
        injectExchangeAddItem(characterName, targetId, slot);
        setTimeout(() => engine.onFillComplete(), 500);
      }
    } else {
      // Item not found in inventory
      injectExchangeAction(characterName, ExchangeClientAction.Cancel, targetId);
      send('engine:validation-failed', { characterName, reason: `Trade item "${listing.itemName}" not found in inventory` });
    }
  });

  // Inventory tracker events -> renderer + auto-activate/pause listings based on inventory
  function checkInventoryListingStatus() {
    const listings = db.getAllListings(characterName);
    let changed = false;
    for (const listing of listings) {
      // Only auto-manage listings that are synced from AE (have a mapping)
      const aeMap = db.getAeListingMap(listing.id);
      if (!aeMap) continue;

      if (listing.type === 'SELL' || listing.type === 'TRADE') {
        const hasItem = inventoryTracker.hasItem(listing.itemName);
        if (hasItem && listing.status === 'PAUSED') {
          listing.status = 'ACTIVE';
          db.updateListing(listing);
          changed = true;
        } else if (!hasItem && listing.status === 'ACTIVE') {
          listing.status = 'PAUSED';
          db.updateListing(listing);
          changed = true;
        }
      }
      // BUY listings: activate if character has enough gold
      if (listing.type === 'BUY') {
        const hasGold = inventoryTracker.getGold() >= listing.price;
        if (hasGold && listing.status === 'PAUSED') {
          listing.status = 'ACTIVE';
          db.updateListing(listing);
          changed = true;
        } else if (!hasGold && listing.status === 'ACTIVE') {
          listing.status = 'PAUSED';
          db.updateListing(listing);
          changed = true;
        }
      }
    }
    if (changed) {
      engine.setListings(db.getAllListings(characterName));
      pushHubUpdate();
      send('listings:changed', { characterName });
    }
  }

  inventoryTracker.on('itemAdded', () => {
    send('inventory:update', { characterName, items: Array.from(inventoryTracker.getState().items.values()) });
    checkInventoryListingStatus();
  });

  inventoryTracker.on('itemRemoved', () => {
    send('inventory:update', { characterName, items: Array.from(inventoryTracker.getState().items.values()) });
    checkInventoryListingStatus();
  });

  inventoryTracker.on('goldUpdated', (gold: number) => {
    send('inventory:gold-update', { characterName, gold });
  });

  // Location tracker events -> hub update
  locationTracker.on('locationChanged', () => {
    pushHubUpdate();
  });

  // --- Merchant Group Title ---
  // Automatically create/maintain a group with the merchant title when active listings exist.
  // The server dissolves solo groups after ~30-60s, so we re-send on a 25s interval.
  let groupActive = false;
  let currentGroupTitle = '';
  let currentGroupDesc = '';
  const GROUP_REFRESH_MS = 25_000;

  function currentGroupAppearance() {
    const savedTitle = db.getSetting(`group_title:${characterName}`, '');
    const savedDescription = db.getSetting(`group_description:${characterName}`, '');
    const customSetting = db.getSetting(`group_custom_enabled:${characterName}`, '');
    return groupAppearance(
      engine.getListings(),
      customGroupEnabled(customSetting, savedTitle || LEGACY_GROUP_TITLE, savedDescription || LEGACY_GROUP_DESCRIPTION),
      savedTitle || LEGACY_GROUP_TITLE,
      savedDescription || LEGACY_GROUP_DESCRIPTION,
    );
  }

  function updateMerchantGroup() {
    const groupEnabled = db.getSetting(`group_enabled:${characterName}`, 'true') === 'true';
    const activeListings = engine.getListings().filter(l => l.status === 'ACTIVE' && l.quantityRemaining > 0);
    const shouldHaveGroup = groupEnabled && activeListings.length > 0;

    const { title, description } = currentGroupAppearance();

    if (shouldHaveGroup) {
      injectGroupCreate(characterName, title, description);
      groupActive = true;
      currentGroupTitle = title;
      currentGroupDesc = description;

      // Start refresh interval if not already running — the server dissolves solo groups
      if (!groupRefreshIntervals.has(characterName)) {
        const interval = setInterval(() => {
          if (groupActive) {
            const appearance = currentGroupAppearance();
            injectGroupCreate(characterName, appearance.title, appearance.description);
          }
        }, GROUP_REFRESH_MS);
        groupRefreshIntervals.set(characterName, interval);
      }
    } else if (groupActive) {
      injectGroupDisband(characterName);
      groupActive = false;
      currentGroupTitle = '';
      currentGroupDesc = '';
      const interval = groupRefreshIntervals.get(characterName);
      if (interval) {
        clearInterval(interval);
        groupRefreshIntervals.delete(characterName);
      }
    }
  }

  // Update group when listings change
  engine.on('listingsUpdated', () => {
    // Small delay to let DB writes settle
    setTimeout(() => updateMerchantGroup(), 300);
  });

  // Determine connection type: check if any launched process has this character name
  let connectionType: 'launched' | 'bot' = 'bot';
  for (const [pid] of launchedClients) {
    try {
      const name = readCharacterName(pid);
      if (name && name === characterName) {
        connectionType = 'launched';
        break;
      }
    } catch { /* process may have exited */ }
  }

  const ctx: CharacterContext = { characterName, connectionType, connection, engine, inventoryTracker, locationTracker };
  console.log(`[MerchantMode] Character context created: ${characterName} (${connectionType})`);
  return ctx;
}

function startProxy() {
  if (proxyServer) proxyServer.stop();

  proxyServer = new ProxyServer({
    listenPort: PROXY_PORT,
    remoteHost: 'da0.kru.com',
    remotePort: 2610,
  });

  proxyServer.on('packet', (direction: string, opCode: number, data: Uint8Array, connection: ProxyConnection) => {
    const charName = connection.connectionState.characterName;

    // Log for sniffer
    const entry = {
      direction,
      opCode,
      dataHex: Buffer.from(data).toString('hex').substring(0, 200),
      timestamp: Date.now(),
      characterName: charName || undefined,
    };
    packetLog.push(entry);
    if (packetLog.length > MAX_PACKET_LOG) packetLog.shift();

    // Auto-reconnect: inject Login packet when LoginControls (0x66) arrives
    // on the GAME SERVER connection (after redirect, not the initial login server).
    // The Notification OK and Continue clicks are handled via mouse automation.
    const isPostRedirect = connection.connectionState.characterName !== '';
    if (direction === 'server' && opCode === ServerOpCode.LoginControls && reconnectManager.isReconnecting() && isPostRedirect) {
      if (!(connection as any)._reconnectSentLogin) {
        (connection as any)._reconnectSentLogin = true;
        const launchingChar = reconnectManager.getCurrentlyLaunching();
        if (launchingChar) {
          const creds = reconnectManager.getReconnectingCredentials(launchingChar);
          if (creds) {
            // Delay login injection until after mouse automation clicks through
            // Notification OK (~6s) and Continue (~3s) = ~10s after launch
            setTimeout(() => {
              console.log(`[Reconnect] Injecting login for ${launchingChar} (user=${creds.username})`);
              injectLogin(connection, creds.username, creds.password);
            }, 12000);
          }
        }
      }
    }

    // Only create context once the connection is fully in-game
    const isInGame = connection.connectionState.phase === ConnectionPhase.IN_GAME;
    if (charName && isInGame && !characterContexts.has(charName)) {
      const ctx = createCharacterContext(charName, connection);
      characterContexts.set(charName, ctx);

      // Clear reconnect state if this character was being reconnected
      if (reconnectManager.isReconnecting(charName)) {
        reconnectManager.onCharacterConnected(charName);
      }

      // Migrate global group settings to per-character keys on first connect
      for (const gKey of ['group_enabled', 'group_title', 'group_description']) {
        const perCharKey = `${gKey}:${charName}`;
        if (!db.getSetting(perCharKey, '')) {
          const globalVal = db.getSetting(gKey, '');
          if (globalVal) db.setSetting(perCharKey, globalVal);
        }
      }

      send('characters:connected', { name: charName, connectionType: ctx.connectionType });

      // Register display packet transformer to show merchant names above heads
      registerMerchantDisplayTransformer(connection);

      // Replay any packets that were buffered before context creation (inventory, stats, etc.)
      const buffered = preContextPacketBuffer.get(charName);
      if (buffered && buffered.length > 0) {
        console.log(`[MerchantMode] Replaying ${buffered.length} buffered packets for ${charName}`);
        for (const pkt of buffered) {
          ctx.engine.processServerPacket(pkt.opCode, pkt.data);
          ctx.locationTracker.processServerPacket(pkt.opCode, pkt.data);
        }
        preContextPacketBuffer.delete(charName);
      }

      // Push full inventory snapshot to renderer after a short delay
      // (allows any remaining packets from the current tick to be processed)
      setTimeout(() => {
        const items = Array.from(ctx.inventoryTracker.getState().items.values());
        const gold = ctx.inventoryTracker.getGold();
        console.log(`[MerchantMode] Pushing inventory snapshot for ${charName}: ${items.length} items, ${gold} gold`);
        send('inventory:update', { characterName: charName, items });
        send('inventory:gold-update', { characterName: charName, gold });

        // Auto-import AE listings for this character after inventory loads
        importAeListings(charName).then(r => {
          if (r.imported > 0) console.log(`[AE AutoSync] Imported ${r.imported} listing(s) for ${charName} on connect`);
        }).catch(() => {}).finally(() => {
          // Create merchant group title after listings are loaded/imported
          const charCtx = characterContexts.get(charName);
          if (charCtx) {
            // @ts-ignore — access the updateMerchantGroup closure from the context setup
            charCtx.engine.emit('listingsUpdated', charCtx.engine.getListings());
          }
        });
      }, 500);
    }

    // Update connection reference (may change after redirect)
    if (charName && isInGame && characterContexts.has(charName)) {
      characterContexts.get(charName)!.connection = connection;
      registerMerchantDisplayTransformer(connection);
    }

    // Forward client packets to location tracker (for walk tracking)
    if (direction === 'client' && charName) {
      const ctx = characterContexts.get(charName);
      if (ctx) {
        ctx.locationTracker.processClientPacket(opCode, data);
      }
    }

    // Forward server packets to the correct character's engine
    if (direction === 'server' && charName) {
      const ctx = characterContexts.get(charName);
      if (ctx) {
        ctx.engine.processServerPacket(opCode, data);
        ctx.locationTracker.processServerPacket(opCode, data);
      } else if (charName) {
        // Context doesn't exist yet — buffer server packets for replay once context is created
        if (!preContextPacketBuffer.has(charName)) {
          preContextPacketBuffer.set(charName, []);
        }
        preContextPacketBuffer.get(charName)!.push({ opCode, data: Uint8Array.from(data) });
      }
    }

    // Send to renderer (throttled - only important opcodes)
    const importantOps = [
      ServerOpCode.ServerMessage, ServerOpCode.ChatMessage, ServerOpCode.Exchange, ServerOpCode.AddItemToPane,
      ServerOpCode.RemoveItemFromPane, ServerOpCode.Attributes,
      ClientOpCode.Exchange, ClientOpCode.Whisper,
    ];
    if (importantOps.includes(opCode)) {
      send('proxy:packet', entry);
    }
  });

  proxyServer.on('connection', () => {
    send('proxy:status', 'connected');
  });

  proxyServer.on('disconnection', (connection?: ProxyConnection) => {
    if (connection) {
      // Look up by character name from the connection's state — more reliable than
      // reference comparison which can go stale after redirect reconnections.
      const charName = connection.connectionState.characterName;

      // Also try reference match for connections that never reached authentication
      let matchedName: string | undefined;
      if (charName && characterContexts.has(charName)) {
        const ctx = characterContexts.get(charName)!;
        // Only remove if the context still points to THIS connection.
        // If it was migrated to a newer connection (redirect), skip removal.
        if (ctx.connection === connection) {
          matchedName = charName;
        }
      }

      // Fallback: iterate all contexts to match by connection reference
      // (covers edge cases where characterName wasn't set on the connection)
      if (!matchedName) {
        for (const [name, ctx] of characterContexts) {
          if (ctx.connection === connection) {
            matchedName = name;
            break;
          }
        }
      }

      if (matchedName) {
        const ctx = characterContexts.get(matchedName)!;
        // Capture state before cleanup for potential auto-reconnect
        const wasLaunched = ctx.connectionType === 'launched';
        const savedUsername = connection.connectionState.username;
        const savedPassword = connection.connectionState.password;

        // Disband merchant group and clear refresh interval before cleanup
        try { injectGroupDisband(matchedName); } catch { /* connection may already be gone */ }
        const grpInterval = groupRefreshIntervals.get(matchedName);
        if (grpInterval) {
          clearInterval(grpInterval);
          groupRefreshIntervals.delete(matchedName);
        }
        ctx.engine.removeAllListeners();
        ctx.inventoryTracker.removeAllListeners();
        ctx.inventoryTracker.clear();
        ctx.locationTracker.removeAllListeners();
        ctx.locationTracker.clear();
        characterContexts.delete(matchedName);
        preContextPacketBuffer.delete(matchedName);
        send('characters:disconnected', matchedName);
        console.log(`[MerchantMode] Character disconnected: ${matchedName}`);
        pushHubUpdate();

        // Auto-reconnect: if the SERVER dropped us (not user closing the client),
        // and this was a launched client with captured credentials, schedule reconnect
        console.log(`[Reconnect] Disconnect analysis: reason=${connection.disconnectReason}, launched=${wasLaunched}, hasCredentials=${!!(savedUsername && savedPassword)}`);
        if (connection.disconnectReason === 'server' && wasLaunched && savedUsername && savedPassword) {
          const autoReconnectEnabled = db.getSetting('auto_reconnect_enabled', 'true') === 'true';
          if (autoReconnectEnabled && !reconnectManager.isReconnecting(matchedName)) {
            // Kill the old DA client process — it's sitting at a "Disconnected" dialog
            // and we need to launch a fresh one that will connect cleanly
            for (const [pid, client] of launchedClients) {
              try {
                const name = readCharacterName(pid);
                if (name === matchedName) {
                  console.log(`[Reconnect] Killing old DA client (PID ${pid}) for ${matchedName}`);
                  terminateClient(client);
                  launchedClients.delete(pid);
                  break;
                }
              } catch {
                // Process already gone — clean up
                closeClientHandles(client);
                launchedClients.delete(pid);
              }
            }
            console.log(`[Reconnect] Server disconnect detected for ${matchedName}, scheduling reconnect`);
            reconnectManager.scheduleReconnect(matchedName, savedUsername, savedPassword);
          } else if (reconnectManager.isReconnecting(matchedName)) {
            // Connection failed during a reconnect attempt (server still down) — retry
            reconnectManager.scheduleRetry(matchedName);
          }
        }
      }
    }
    // Clean up any launched client entries whose processes are no longer alive
    for (const [pid, client] of launchedClients) {
      try {
        readCharacterName(pid);
      } catch {
        closeClientHandles(client);
        launchedClients.delete(pid);
      }
    }
    send('proxy:status', proxyServer?.isConnected() ? 'connected' : 'disconnected');
  });

  proxyServer.start();
  console.log(`[MerchantMode] Proxy listening on localhost:${PROXY_PORT}`);

  // Connect to the global merchant hub
  merchantHub.connect();
}

// Forward merchant hub updates to the renderer
merchantHub.on('merchantsUpdated', (merchants) => {
  send('merchants:updated', merchants);
});

// --- Merchant display transformer ---

function registerMerchantDisplayTransformer(connection: ProxyConnection): void {
  connection.registerServerTransformer(ServerOpCode.DisplayAisling, (data) => {
    const names = new Set<string>();
    for (const m of merchantHub.getMerchants()) {
      names.add(m.name.toLowerCase());
    }
    return patchDisplayAisling(data, names);
  });
}

// --- Packet injection helpers ---

function getConnectionForCharacter(characterName: string): ProxyConnection | null {
  return characterContexts.get(characterName)?.connection ?? null;
}

function injectWhisper(characterName: string, target: string, message: string) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const ctx = characterContexts.get(characterName);
  ctx?.engine.recordSentWhisper(target, message);
  const writer = new BinaryWriter();
  writer.writeString8(target);
  writer.writeString8(message);
  conn.injectClientPacket(ClientOpCode.Whisper, writer.toArray());
}

function injectExchangeAction(characterName: string, action: ExchangeClientAction, targetId: number) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(action);
  writer.writeUint32(targetId);
  conn.injectClientPacket(ClientOpCode.Exchange, writer.toArray());
}

function injectExchangeAddItem(characterName: string, targetId: number, slot: number) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(ExchangeClientAction.AddItem);
  writer.writeUint32(targetId);
  writer.writeUint8(slot);
  conn.injectClientPacket(ClientOpCode.Exchange, writer.toArray());
}

function injectExchangeAddStackable(characterName: string, targetId: number, slot: number, quantity: number) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(ExchangeClientAction.AddStackableItem);
  writer.writeUint32(targetId);
  writer.writeUint8(slot);
  writer.writeUint8(quantity);
  conn.injectClientPacket(ClientOpCode.Exchange, writer.toArray());
}

function injectExchangeSetGold(characterName: string, targetId: number, amount: number) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(ExchangeClientAction.SetGold);
  writer.writeUint32(targetId);
  writer.writeUint32(amount);
  conn.injectClientPacket(ClientOpCode.Exchange, writer.toArray());
}

function injectGroupCreate(characterName: string, groupTitle: string, groupDescription: string) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(0x04); // Create group action
  writer.writeString8(characterName);
  writer.writeString8(groupTitle);
  writer.writeString8(groupDescription);
  // Trailing flags: allow invite=no, open=no, max=1, class restriction flags
  writer.writeBytes(new Uint8Array([0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01]));
  conn.injectClientPacket(ClientOpCode.GroupRequest, writer.toArray());
  console.log(`[MerchantMode:${characterName}] Group created: "${groupTitle}" - ${groupDescription}`);
}

function injectGroupDisband(characterName: string) {
  const conn = getConnectionForCharacter(characterName);
  if (!conn) return;
  const writer = new BinaryWriter();
  writer.writeUint8(0x04); // Same create/update action with empty strings to disband
  writer.writeString8(characterName);
  writer.writeString8('');
  writer.writeString8('');
  writer.writeBytes(new Uint8Array([0x00, 0x00, 0x01, 0x01, 0x01, 0x01, 0x01]));
  conn.injectClientPacket(ClientOpCode.GroupRequest, writer.toArray());
  console.log(`[MerchantMode:${characterName}] Group disbanded`);
}

function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toString();
}

// --- Smart Auto-Whisper Helpers ---

const LIST_KEYWORDS = [
  "what's for sale", "whats for sale",
  "what's for buy", "whats for buy",
  "what's for trade", "whats for trade",
  "wts", "wtb", "wtt", "list",
  "sale", "buy", "trade", "selling", "buying", "trading",
  "for sale", "shop", "merchant", "stock", "inventory",
  "price", "prices", "how much",
];

// Normalize smart/curly quotes and other unicode variants to ASCII before keyword matching
function normalizeMessage(msg: string): string {
  return msg
    .replace(/[\u2018\u2019\u201A\u0060\u00B4]/g, "'")  // curly single quotes -> '
    .replace(/[\u201C\u201D\u201E]/g, '"');               // curly double quotes -> "
}

function isListKeyword(message: string): boolean {
  const lower = normalizeMessage(message).toLowerCase().trim();
  for (const kw of LIST_KEYWORDS) {
    if (kw.length <= 4) {
      const re = new RegExp(`\\b${kw}\\b`);
      if (re.test(lower)) return true;
    } else {
      if (lower.includes(kw)) return true;
    }
  }
  return false;
}

function formatListingSummary(listings: MerchantListing[]): string {
  const active = listings.filter(l => l.status === 'ACTIVE' && l.quantityRemaining > 0);
  if (active.length === 0) return 'No items listed right now.';

  const groups: Record<string, string[]> = { SELL: [], BUY: [], TRADE: [] };
  for (const l of active) {
    if (l.type === 'TRADE') {
      const wanted = l.wantedItems?.[0]?.name ?? '?';
      groups.TRADE.push(`${l.itemName} for ${wanted}`);
    } else {
      groups[l.type].push(`${l.itemName} ${formatGold(l.price)}`);
    }
  }

  const parts: string[] = [];
  for (const type of ['SELL', 'BUY', 'TRADE']) {
    if (groups[type].length > 0) {
      parts.push(`[${type}] ${groups[type].join(' | ')}`);
    }
  }
  return parts.join(' | ');
}

const MAX_WHISPER_LEN = 255;
const MAX_REPLY_WHISPERS = 5;

function splitWhisperMessage(fullMessage: string): string[] {
  if (fullMessage.length <= MAX_WHISPER_LEN) return [fullMessage];

  const separator = ' | ';
  const segments = fullMessage.split(separator);
  const messages: string[] = [];
  let current = '';

  for (const seg of segments) {
    const candidate = current ? current + separator + seg : seg;
    if (candidate.length <= MAX_WHISPER_LEN) {
      current = candidate;
    } else {
      if (current) messages.push(current);
      current = seg.length > MAX_WHISPER_LEN
        ? seg.substring(0, MAX_WHISPER_LEN - 3) + '...'
        : seg;
    }
  }
  if (current) messages.push(current);

  return messages.slice(0, MAX_REPLY_WHISPERS);
}

// --- AE Listing Import ---

async function importAeListings(characterName: string): Promise<{ imported: number; error?: string }> {
  if (!aeClient.isLoggedIn()) return { imported: 0, error: 'Not logged in' };

  const authStatus = aeClient.getAuthStatus();
  if (!authStatus.username) return { imported: 0, error: 'No AE username' };

  const result = await aeClient.get<{ data: any[] }>(`/listings/user/${encodeURIComponent(authStatus.username)}`);
  if (!result.data?.data) return { imported: 0, error: result.error || 'Failed to fetch AE listings' };

  const aeListings = result.data.data.filter((l: any) => l.status === 'ACTIVE');
  let imported = 0;
  const localListings = db.getAllListings(characterName);

  for (const aeListing of aeListings) {
    const alreadyMapped = localListings.some(ll => {
      const map = db.getAeListingMap(ll.id);
      return map && map.aeId === aeListing.id;
    });
    if (alreadyMapped) continue;

    const existingLocal = localListings.find(ll =>
      ll.itemName.toLowerCase() === (aeListing.item_name || '').toLowerCase() &&
      ll.type === aeListing.type &&
      ll.characterName === characterName
    );
    if (existingLocal) {
      db.setAeListingMap(existingLocal.id, aeListing.id, aeListing.item_id || null);
      continue;
    }

    const localId = crypto.randomUUID();
    const newListing: MerchantListing = {
      id: localId,
      characterName,
      type: aeListing.type,
      itemName: aeListing.item_name || '',
      price: aeListing.price || 0,
      quantity: aeListing.quantity || 1,
      quantityRemaining: aeListing.quantity || 1,
      status: 'PAUSED',
      wantedItems: aeListing.wanted_items ? [{ name: aeListing.wanted_items, quantity: 1 }] : undefined,
      notes: aeListing.notes || undefined,
      syncToAe: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    db.insertListing(newListing);
    db.setAeListingMap(localId, aeListing.id, aeListing.item_id || null);
    imported++;
  }

  if (imported > 0) {
    const ctx = characterContexts.get(characterName);
    if (ctx) {
      ctx.engine.setListings(db.getAllListings(characterName));
      const allListings = db.getAllListings(characterName);
      let changed = false;
      for (const listing of allListings) {
        const aeMap = db.getAeListingMap(listing.id);
        if (!aeMap) continue;
        if ((listing.type === 'SELL' || listing.type === 'TRADE') && listing.status === 'PAUSED') {
          if (ctx.inventoryTracker.hasItem(listing.itemName)) {
            listing.status = 'ACTIVE';
            db.updateListing(listing);
            changed = true;
          }
        }
        if (listing.type === 'BUY' && listing.status === 'PAUSED') {
          if (ctx.inventoryTracker.getGold() >= listing.price) {
            listing.status = 'ACTIVE';
            db.updateListing(listing);
            changed = true;
          }
        }
      }
      if (changed) {
        ctx.engine.setListings(db.getAllListings(characterName));
        pushHubUpdate();
      }
    }
    send('listings:changed', { characterName });
  }

  return { imported };
}

async function autoSyncAeListings() {
  if (!aeClient.isLoggedIn()) return;
  for (const [charName] of characterContexts) {
    try {
      const result = await importAeListings(charName);
      if (result.imported > 0) {
        console.log(`[AE AutoSync] Imported ${result.imported} listing(s) for ${charName}`);
      }
    } catch (err) {
      console.error(`[AE AutoSync] Error for ${charName}:`, err);
    }
  }
}

// --- IPC Handlers ---

function registerIpcHandlers() {
  // Proxy
  ipcMain.handle('proxy:status', () => proxyServer?.isConnected() ? 'connected' : 'disconnected');
  ipcMain.handle('proxy:start', () => { if (!proxyServer?.isListening()) startProxy(); });
  ipcMain.handle('proxy:stop', () => { proxyServer?.stop(); });

  // Characters
  ipcMain.handle('characters:list', () =>
    Array.from(characterContexts.values()).map((ctx) => ({ name: ctx.characterName, connectionType: ctx.connectionType }))
  );

  // Engine state (character-scoped)
  ipcMain.handle('engine:state', (_e, characterName?: string) => {
    if (characterName) {
      return characterContexts.get(characterName)?.engine.getState() ?? 'IDLE';
    }
    // Fallback: return first character's state
    const first = characterContexts.values().next();
    return first.done ? 'IDLE' : first.value.engine.getState();
  });

  ipcMain.handle('engine:whispers', (_e, characterName?: string) => {
    if (characterName) {
      return characterContexts.get(characterName)?.engine.getWhisperQueue() ?? [];
    }
    return [];
  });

  // Listings CRUD (character-scoped)
  ipcMain.handle('listings:getAll', (_e, characterName?: string) => db.getAllListings(characterName));
  ipcMain.handle('listings:getActive', (_e, characterName?: string) => db.getActiveListings(characterName));

  ipcMain.handle('listings:create', (_e, listing: MerchantListing) => {
    db.insertListing(listing);
    // Refresh the appropriate engine
    const ctx = characterContexts.get(listing.characterName ?? '');
    if (ctx) ctx.engine.setListings(db.getAllListings(listing.characterName));
    pushHubUpdate();
    // Auto-sync to AE (fire-and-forget)
    listingSync.syncCreate(listing).catch(err => console.error('[AE Sync] create failed:', err));
    return db.getAllListings(listing.characterName);
  });

  ipcMain.handle('listings:update', (_e, listing: MerchantListing) => {
    db.updateListing(listing);
    const ctx = characterContexts.get(listing.characterName ?? '');
    if (ctx) ctx.engine.setListings(db.getAllListings(listing.characterName));
    pushHubUpdate();
    // Auto-sync to AE (fire-and-forget)
    listingSync.syncUpdate(listing).catch(err => console.error('[AE Sync] update failed:', err));
    return db.getAllListings(listing.characterName);
  });

  ipcMain.handle('listings:delete', (_e, id: string, characterName?: string) => {
    db.deleteListing(id);
    if (characterName) {
      const ctx = characterContexts.get(characterName);
      if (ctx) ctx.engine.setListings(db.getAllListings(characterName));
    }
    pushHubUpdate();
    // Auto-sync to AE (fire-and-forget)
    listingSync.syncDelete(id).catch(err => console.error('[AE Sync] delete failed:', err));
    return db.getAllListings(characterName);
  });

  // Transactions
  ipcMain.handle('transactions:getAll', () => db.getAllTransactions());
  ipcMain.handle('transactions:getByDate', (_e, start: string, end: string) => db.getTransactionsByDate(start, end));

  // Inventory (character-scoped)
  ipcMain.handle('inventory:get', (_e, characterName?: string) => {
    if (characterName) {
      const ctx = characterContexts.get(characterName);
      if (!ctx) return [];
      return Array.from(ctx.inventoryTracker.getState().items.values());
    }
    return [];
  });

  ipcMain.handle('inventory:gold', (_e, characterName?: string) => {
    if (characterName) {
      return characterContexts.get(characterName)?.inventoryTracker.getGold() ?? 0;
    }
    return 0;
  });

  // Global merchants
  ipcMain.handle('merchants:getAll', () => merchantHub.getMerchants());

  // AE profile data — proxy through main process for Electron compatibility
  const AE_API = 'https://api.aislingexchange.com/api';
  const spriteCache = new Map<string, { buffer: Buffer; expiresAt: number } | null>();
  const avatarCache = new Map<string, { data: any; expiresAt: number }>();

  ipcMain.handle('ae:sprite', async (_e, name: string) => {
    console.log('[AE] sprite requested for:', name);
    const key = name.toLowerCase();
    const cached = spriteCache.get(key);
    if (cached !== undefined) {
      if (cached === null || Date.now() > cached.expiresAt) {
        spriteCache.delete(key);
      } else {
        return cached.buffer.toString('base64');
      }
    }
    try {
      const url = `${AE_API}/players/${encodeURIComponent(name)}/sprite.png`;
      console.log('[AE] fetching sprite from:', url);
      const res = await fetch(url);
      console.log('[AE] sprite response:', res.status, res.statusText);
      if (!res.ok) {
        spriteCache.set(key, null);
        setTimeout(() => spriteCache.delete(key), 60_000);
        return null;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      console.log('[AE] sprite fetched for:', name, 'size:', buffer.length);
      spriteCache.set(key, { buffer, expiresAt: Date.now() + 5 * 60_000 });
      return buffer.toString('base64');
    } catch (err) {
      console.error('[AE] sprite fetch error:', err);
      return null;
    }
  });

  ipcMain.handle('ae:avatar', async (_e, name: string) => {
    console.log('[AE] avatar requested for:', name);
    const key = name.toLowerCase();
    const cached = avatarCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
    try {
      const url = `${AE_API}/players/${encodeURIComponent(name)}/avatar`;
      console.log('[AE] fetching avatar from:', url);
      const res = await fetch(url);
      console.log('[AE] avatar response:', res.status, res.statusText);
      if (!res.ok) return null;
      const data = await res.json();
      console.log('[AE] avatar data:', JSON.stringify(data));
      avatarCache.set(key, { data, expiresAt: Date.now() + 5 * 60_000 });
      return data;
    } catch (err) {
      console.error('[AE] avatar fetch error:', err);
      return null;
    }
  });

  // ── AE Auth ──────────────────────────────────────────────

  ipcMain.handle('ae:login', async (_e, username: string, password: string) => {
    const result = await aeClient.login(username, password);
    if (result.data) return { success: true, user: result.data };
    return { success: false, error: result.error };
  });

  ipcMain.handle('ae:logout', () => {
    aeClient.logout();
  });

  ipcMain.handle('ae:getAuthStatus', () => {
    return aeClient.getAuthStatus();
  });

  aeClient.on('authChanged', (status: any) => {
    send('ae:authChanged', status);
  });

  // ── AE Items ────────────────────────────────────────────

  ipcMain.handle('ae:searchItems', (_e, query: string, limit?: number) => {
    return itemCache.searchItems(query, limit);
  });

  ipcMain.handle('ae:resolveItem', (_e, name: string) => {
    return itemCache.resolveItemName(name);
  });

  // ── AE Listing Sync ────────────────────────────────────

  ipcMain.handle('ae:getSyncStatuses', (_e, ids: string[]) => {
    return listingSync.getSyncStatuses(ids);
  });

  ipcMain.handle('ae:retrySync', async (_e, localListingId?: string) => {
    await listingSync.retrySync(localListingId);
  });

  // Auto-sync on auth change (user logs in)
  aeClient.on('authChanged', (status: { loggedIn: boolean }) => {
    if (status.loggedIn) {
      setTimeout(() => autoSyncAeListings(), 2_000);
    }
  });

  // Auto-sync every 10 minutes
  setInterval(() => autoSyncAeListings(), 10 * 60_000);

  ipcMain.handle('ae:importListings', async (_e, characterName: string) => {
    return importAeListings(characterName);
  });

  // ── AE Player Profiles ─────────────────────────────────

  const playerProfileCache = new Map<string, { data: any; expiresAt: number }>();

  ipcMain.handle('ae:getPlayerProfile', async (_e, name: string) => {
    const key = name.toLowerCase();
    const cached = playerProfileCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.data;
    try {
      const res = await fetch(`${AE_API}/players/${encodeURIComponent(name)}`);
      if (!res.ok) return null;
      const data = await res.json();
      playerProfileCache.set(key, { data, expiresAt: Date.now() + 2 * 60_000 });
      return data;
    } catch {
      return null;
    }
  });

  ipcMain.handle('ae:getPlayerListings', async (_e, username: string) => {
    try {
      const res = await fetch(`${AE_API}/listings/user/${encodeURIComponent(username)}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  });

  // Packet sniffer
  ipcMain.handle('sniffer:getLog', () => packetLog.slice(-200));

  // Settings
  ipcMain.handle('settings:get', (_e, key: string, defaultValue?: string) => db.getSetting(key, defaultValue));
  ipcMain.handle('settings:set', (_e, key: string, value: string) => {
    db.setSetting(key, value);
    // If a per-character group setting changed, refresh only that character's merchant group
    if (key.startsWith('group_enabled:') || key.startsWith('group_custom_enabled:') || key.startsWith('group_title:') || key.startsWith('group_description:')) {
      const charName = key.substring(key.indexOf(':') + 1);
      const ctx = characterContexts.get(charName);
      if (ctx) {
        ctx.engine.emit('listingsUpdated', ctx.engine.getListings());
      }
    }
  });

  // Auto-reconnect
  ipcMain.handle('reconnect:getState', () => reconnectManager.getState());
  ipcMain.handle('reconnect:cancel', (_e, characterName: string) => reconnectManager.cancelReconnect(characterName));
  ipcMain.handle('reconnect:cancelAll', () => reconnectManager.cancelAll());
  reconnectManager.on('status', (data) => send('reconnect:status', data));

  // Auto-updater
  ipcMain.handle('updater:check', () => autoUpdater.checkForUpdates().catch(() => {}));
  ipcMain.handle('updater:download', () => autoUpdater.downloadUpdate().catch(() => {}));
  ipcMain.handle('updater:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('updater:version', () => app.getVersion());

  // Open external URLs in the default browser
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (url.startsWith('https://')) shell.openExternal(url);
  });

  // Debug: simulate server disconnect (dev only)
  ipcMain.handle('debug:isDev', () => !app.isPackaged);
  if (!app.isPackaged) {
    ipcMain.handle('debug:simulateServerDisconnect', () => {
      const conn = proxyServer?.getActiveConnection();
      if (conn) {
        console.log('[Debug] Simulating server disconnect — destroying server socket');
        // Access the private serverSocket to simulate server-side close
        (conn as any).serverSocket?.destroy();
        return { success: true };
      }
      return { success: false, error: 'No active connection' };
    });
  }

  // Client launcher
  ipcMain.handle('launcher:launch', async () => {
    const clientPath = db.getSetting('client_path', 'C:\\Program Files (x86)\\KRU\\Dark Ages\\Darkages.exe');
    try {
      // Ensure proxy is running before launching client
      if (!proxyServer?.isListening()) {
        startProxy();
      }
      const client = launchClient(clientPath, { localPort: PROXY_PORT, skipIntro: true });
      launchedClients.set(client.processId, client);
      return { success: true, processId: client.processId };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('launcher:browse', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select Darkages.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: db.getSetting('client_path', 'C:\\Program Files (x86)\\KRU\\Dark Ages'),
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0];
      db.setSetting('client_path', selected);
      return selected;
    }
    return null;
  });

  ipcMain.handle('launcher:getPath', () => {
    return db.getSetting('client_path', 'C:\\Program Files (x86)\\KRU\\Dark Ages\\Darkages.exe');
  });
}

// --- Auto-updater ---

function setupAutoUpdater() {
  const autoUpdateEnabled = db.getSetting('auto_update_enabled', 'true') === 'true';
  autoUpdater.autoDownload = autoUpdateEnabled;
  autoUpdater.autoInstallOnAppQuit = autoUpdateEnabled;

  autoUpdater.on('checking-for-update', () => {
    send('updater:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    send('updater:status', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    send('updater:status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('updater:status', { status: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('updater:status', { status: 'ready', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    send('updater:status', { status: 'error', message: err.message });
  });

  // When auto-update is enabled, check on launch and every 30 minutes
  if (autoUpdateEnabled) {
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => {
      autoUpdater.checkForUpdates().catch(() => {});
    }, 30 * 60 * 1000);
  }
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  createWindow();
  registerIpcHandlers();
  startProxy();
  setupAutoUpdater();

  // Initialize AE integration (non-blocking)
  try {
    await aeClient.init();
    await itemCache.init();
    listingSync.init();
    console.log(`[AE] Initialized — auth=${aeClient.isLoggedIn()}, items=${itemCache.getItemCount()}`);
  } catch (err) {
    console.error('[AE] Init error (non-fatal):', err);
  }
});

app.on('window-all-closed', () => {
  reconnectManager.cancelAll();
  merchantHub.disconnect();
  proxyServer?.stop();
  itemCache.dispose();
  listingSync.dispose();
  for (const client of launchedClients.values()) {
    closeClientHandles(client);
  }
  launchedClients.clear();
  db.closeDb();
  app.quit();
});
