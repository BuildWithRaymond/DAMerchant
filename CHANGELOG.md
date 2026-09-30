# Changelog

## v1.1.9

### New name and group titles
- Merchant Mode is now **DAMerchant** throughout the app, installer, documentation and repository screenshots. Existing local listings, settings and History keep their original data location.
- The in-game group title now reflects active listing types (`S> ITEMS`, `B/S> ITEMS`, `T> ITEMS` and other combinations). The default description asks players to whisper `list`; the Dashboard can switch to a custom title and description.
- Character portraits now frame the head and upper body consistently across tabs, listings, profiles, merchant cards and History.

### Trading fixes
- SELL exchanges accept durability suffixes and sprite flag bits in server item echoes while checking the item identity. Seller acceptance still waits for the item to appear and the buyer to accept that visible offer.
- Completed SELL exchanges now record History and decrement the current listing after matching inventory removal and the exact gold increase, including when an inventory update reloads listings or the server omits a completion subtype.
- Exchanges containing items unrelated to the matched listing cancel promptly. A delayed BUY or TRADE fill callback cannot accept a canceled exchange.
- Added simulated packet tests for these cases. No live account or trade was used in testing.

## v1.1.8

### Bug Fixes
- Fixed client launch for the newer Dark Ages 7.41 executable layout that reported `0xC4` at `0x57A7D0`.
- Verified both server host paths, the fallback address, and each port branch before patching. The newer layout already bypasses the single-instance check; its changed intro code is left intact.
- Kept the previous 7.41 patch profile for existing installations and added simulated memory tests for both layouts and unsupported clients.

## v1.1.7

### Bug Fixes
- SELL exchanges now place the reserved item as soon as the server reports the buyer's exact gold offer. Stack prompts use the reserved slot and quantity, and seller acceptance waits for the server's item echo and the buyer's acceptance of the visible offer.
- Changed gold, extra buyer items, mismatched item echoes, missing inventory, and stalled exchanges cancel the sale. Repeated gold packets cannot place the item twice.
- A SELL transaction is recorded only after the server's completion event and matching inventory and gold updates; acceptance events alone do not record a sale.

### Validation
- Added simulated exchange packet tests for placement order, stack quantities, early acceptance, duplicate offers, cancellation, and exactly-once completion. No live accounts or trades are used.

### Maintenance
- Removed unreachable legacy packet wrappers, unused UI and helper modules, unused dependencies, and personal agent settings.
- Reworked the README with real renderer screenshots, setup instructions, and focused contributor, architecture, and release documentation.
- Added the ISC license, third-party notices, issue and pull request templates, and a Windows CI template.
- Added an offline screenshot capture workflow with fictional sample data.
- Updated the build to compile both Electron and the renderer; local installer builds explicitly disable publishing.
- Synchronized the lockfile version with the existing 1.1.6 package version.
- Updated repository links and the release target to `BuildWithRaymond/DAMerchant`.

## v1.1.5

### New Features
- **Drop-to-trade (no whisper required)** — when you have exactly 1 active listing, players can drop gold or items directly on your character to start a trade without needing to whisper first; the engine auto-matches the only listing and handles the exchange automatically
- **Merchant group title** — your character now automatically creates and maintains an in-game group with a customizable title and description while you have active listings; the group auto-refreshes every 25s (since the server dissolves solo groups) and disbands on disconnect; title and description configurable in Settings
- **Smart whisper keywords** — players can whisper keywords like "whats for sale", "list", "wts", "wtb", or "wtt" to get a formatted summary of all your active listings; long responses are automatically split across multiple whispers; unrecognized whispers are now silently ignored instead of sending a "not found" reply
- **Merchant name display** — other merchants from the global network now appear with `[M]` prefixed to their name, displayed persistently above their head (guild-member style) via a new server packet transformer system
- **Manual update control** — auto-update can now be toggled off in Settings; when disabled, you can still check for and download updates manually from the About page; new "Download Update" button appears when auto-update is off

### Improvements
- **Profile navigation** — "View Profile" on merchant cards now opens the in-app profile page instead of an external link and correctly returns you to the page you came from
- **AE API cache expiry** — avatar and sprite caches now expire after 10 minutes instead of lasting forever, so profile changes on AislingExchange are reflected sooner; added `refreshPlayerCache()` for manual invalidation

### Changes from v1.1.2
- `core/engine/display-modifier.ts` — **new file**: patches DisplayAisling (0x33) packets in-flight to prefix merchant names with `[M]` and set persistent display style
- `core/engine/merchant-engine.ts` — auto-match single active listing when exchange opens without a prior whisper (drop-to-trade)
- `core/proxy/proxy-connection.ts` — added `serverPacketTransformers` map and `registerServerTransformer()` method; server→client packets now run through transformer pipeline before re-encryption
- `electron/main.ts` — merchant group create/disband/refresh logic with `injectGroupCreate`/`injectGroupDisband`; `registerMerchantDisplayTransformer` for `[M]` name display; smart whisper keyword detection with `isListKeyword`, `formatListingSummary`, `splitWhisperMessage`; group settings reactivity on settings change; auto-updater respects `auto_update_enabled` setting; new `updater:download` IPC handler; group refresh intervals cleaned up on disconnect
- `electron/preload.ts` — added `updater.download` IPC bridge
- `src/App.tsx` — profile navigation tracks return page via `profileReturnPage` state
- `src/components/AllMerchantsView.tsx` — "View Profile" opens in-app profile via `onViewProfile` callback instead of external link
- `src/components/UpdateBanner.tsx` — respects `auto_update_enabled` setting; shows "Download" button when auto-update is disabled
- `src/lib/ae-api.ts` — cache entries now have timestamps with 10-minute TTL; added `refreshPlayerCache()` export
- `src/pages/About.tsx` — respects `auto_update_enabled` setting; shows "Download Update" button when auto-update is disabled
- `src/pages/Settings.tsx` — new "Merchant Group Title" section with enable toggle, title, and description fields; new "Updates" section with auto-update toggle
- `src/vite-env.d.ts` — added `download` to updater type declaration

## v1.1.2

### New Features
- **AislingExchange Account Integration** — log in to your AE account directly from Settings; auth tokens persist across sessions and auto-validate on startup; AE connection status shown in the top bar with a globe icon indicator
- **Bidirectional Listing Sync with AislingExchange** — listings created, updated, or deleted in MerchantMode automatically sync to the AE marketplace; per-listing "Sync to AislingExchange" toggle controls which listings get pushed; sync status indicators (synced/pending/failed) on each listing with manual retry on failure
- **AE Listing Import** — on character connect, active AE listings not already present locally are auto-imported in PAUSED status and auto-activate when inventory/gold allows; manual "Sync AE" button for on-demand import; auto-sync runs every 10 minutes and on AE login
- **Inventory-Aware Auto-Pause/Resume** — SELL/TRADE listings auto-pause when the item leaves inventory and auto-resume when it returns; BUY listings auto-pause when gold drops below listing price and auto-resume when funds are sufficient; "WAITING FOR INVENTORY" status label replaces generic "PAUSED"
- **Item Autocomplete** — autocomplete dropdown when typing item names in listing forms, powered by the AE item database; category color-coding (Weapon, Armor, Consumable, etc.) and keyboard navigation; item cache fetches from AE API on startup with local SQLite fallback
- **Player Profile Page** — click any player name (All Merchants, Whispers, Transaction Log) to view their in-app profile showing character sprite, class, title, master status, online/offline indicator, Discord username, verification badge, live bot listings with map location, and AE marketplace listings
- **Completed Trade Price Reporting** — transaction data (item, type, price, quantity) auto-posted to AE as a price entry on trade completion
- **Transactions Track Character Name** — each transaction now records which character completed it; History tab has character tabs to filter by character
- **Richer Merchant Hub Data** — hub now broadcasts quantity, quantityRemaining, stackSize, wantedItems, and notes per listing; other MerchantMode users see full detail in All Merchants view

### Improvements
- **Trade Listing Support** — Create Listing modal now has a proper TRADE mode with "You give" / "You receive" sections, wanted item autocomplete, quantity fields, and configurable repeat count
- **All Merchants View** — merchant cards show full listing details: stack sizes, per-stack prices, quantity remaining, trade arrows with wanted items, and notes
- **Transaction Log Redesign** — two-sided trade flow layout with character avatars, "Gave"/"Got" breakdowns, and type badges (SELL/BUY/TRADE); counterparty names are clickable
- **Listings Real-Time Refresh** — Listings page listens for `listings:changed` events and refreshes automatically

### Bug Fixes
- Fixed Create Listing modal not resetting price, notes, and trade fields when selecting a new item from inventory

### UI/UX
- **Complete visual overhaul** — consistent page hero headers with gradient backgrounds, icons, titles, and subtitles across all pages
- **Sidebar redesign** — new icon badge branding, "Transactions" renamed to "History", "About" moved to top bar
- **New top bar** — persistent bar showing proxy connection status (pulsing dot), AE auth status, and engine state
- **Dashboard** — stat cards with colored icons and hover lift effects
- **Whispers** — hero header with message count pill, improved row styling, clickable player names
- **Settings** — restructured into distinct section cards (AE Account, Client & Proxy, Bot Clients, Auto-Reply, Trade Settings)
- **About page** — complete redesign with floating item sprites, feature cards, and animated hero section
- **Update banner** — download icon, progress bar during download, improved button styling
- **General polish** — larger border radii, hover effects on buttons, gold-tint secondary buttons, gradient avatar backgrounds, staggered slide-up animations for list items

## v1.1.0

### New Features
- **Global Merchant Network** — MerchantMode now connects to the AislingExchange merchant hub (`wss://api.aislingexchange.com/ws/merchants`). Your active listings, character name, and map location are shared in real time with other MerchantMode users
- **All Merchants page** — new "All Merchants" tab on the Dashboard shows every online MerchantMode user in a card grid with their listings, location, and character sprite/avatar pulled from AislingExchange profiles
- **All Merchants listings view** — the "All Merchants" tab on the Listings page shows a unified, type-grouped list of every listing from every online merchant, with avatar, player name, and map location per row
- **Character sprites & avatars** — merchant cards and listing rows display each character's AislingExchange avatar circle (with custom crop offsets) and full sprite image, fetched via the AE API and proxied through Electron
- **Character face in tabs** — character tabs now show a cropped face sprite to the left of the character name for quick visual identification
- **Trade listing auto-matching** — whispers now match against TRADE listings by the wanted item name (what the whisperer has), not the offered item name
- **Trade auto-fill** — the exchange engine now automatically places your offered item from inventory when a trade listing is matched, supporting both stackable and non-stackable items
- **Trade auto-reply** — customizable whisper reply template for trade listings with `{item}` and `{wanted}` placeholders
- **Location tracking** — new `LocationTracker` module tracks each character's current map name and coordinates, broadcast to the merchant hub on every map change
- **Whisper rate limiting** — auto-replies are now rate-limited to one per player per 10 seconds to prevent reply loops

### Bug Fixes
- **Exchange accept reset** — adding items or gold on your side now correctly resets the other party's accept state, preventing premature confirmation
- **Disconnect cleanup** — character context cleanup on disconnect is now more robust, matching by connection reference as a fallback and properly cleaning up location tracker listeners
- **Stack quantity rounding** — whisper-matched quantities are now rounded to the nearest stack size multiple when selling stacked items

### UI Improvements
- "All Merchants" tab moved to appear after all player character tabs instead of before
- Settings page now includes a "Trade reply" template field
- Placeholder help text updated to include `{wanted}` for trade templates

### Changes from v1.0.4
- `core/engine/location-tracker.ts` — **new file**: tracks character map name and x/y from server packets, emits `locationChanged`
- `core/network/merchant-hub-client.ts` — **new file**: WebSocket client for the AislingExchange merchant hub with auto-reconnect and heartbeat
- `src/components/AllMerchantsView.tsx` — **new file**: merchant card grid with avatar circles, full sprites, and listing summaries
- `src/lib/ae-api.ts` — **new file**: AE API utility for fetching sprites (as base64 data URLs) and avatar offset data via IPC
- `electron/main.ts` — added `MerchantHubClient`, `LocationTracker`, `pushHubUpdate()`, trade fill/reply logic, AE sprite/avatar IPC handlers, whisper rate limiting, improved disconnect cleanup
- `electron/preload.ts` — added `merchants` and `ae` IPC bridges
- `src/vite-env.d.ts` — added `merchants`, `ae`, `GlobalMerchantData`, `GlobalMerchantListing` type declarations
- `src/App.tsx` — added `allMerchantsMode` state, merchant hub subscription, All Merchants tab routing, wired `allMerchants` to Listings page
- `src/components/CharacterTabs.tsx` — added `CharacterFace` component with sprite cropping, reordered tabs (players first, All Merchants last)
- `src/pages/Listings.tsx` — added `AllMerchantsListings` view with type-grouped listing rows, merchant avatars, and location info
- `src/pages/Settings.tsx` — added trade reply template field, updated placeholder help text
- `core/engine/merchant-engine.ts` — trade whisper matching by wanted item, exchange accept reset on our-side changes, logging improvements

## v1.0.4

### New Features
- **Bot client compatibility** — MerchantMode can now run alongside bot clients without port conflicts; proxy moved to port 2615 to avoid colliding with bot proxies on 2610–2612
- **Multiple launched clients** — "Launch Client" can now be clicked multiple times to run several DA clients simultaneously, each tracked independently
- **Connection type detection** — characters are automatically tagged as "launched" or "bot" based on whether they were spawned by MerchantMode; bot clients show a "BOT" badge in the character tabs

### UI Improvements
- Character tabs display a "BOT" badge next to bot-connected characters
- Empty state message updated: "Launch a client or connect a bot to get started"
- New "Bot Clients" section in Settings showing the proxy address (`localhost:2615`) with a copy button

### Changes from v1.0.3
- `electron/main.ts` — `launchedClient` single var replaced with `launchedClients` Map; added `connectionType` field to `CharacterContext`; proxy listens on port 2615; `characters:connected` event and `characters:list` IPC include connection type; dead launched clients cleaned up on disconnect
- `electron/preload.ts` — `characters.list` and `characters.onConnected` types updated to include `connectionType`
- `src/vite-env.d.ts` — `MerchantModeAPI` type declarations updated to match preload changes
- `src/App.tsx` — added `characterTypes` state; populated from list and connected events; cleaned up on disconnect; passed to `CharacterTabs`
- `src/components/CharacterTabs.tsx` — accepts `characterTypes` prop; renders "BOT" badge; updated empty state text
- `src/pages/Settings.tsx` — added "Bot Clients" section with proxy address and copy button; local proxy port updated to 2615

## v1.0.3

### Bug Fixes
- Fixed whisper reply showing unit price instead of total when buying multiple items (e.g. "2 item" now replies with "I have 2x Item for 10K" instead of showing the single-item price)
- Added `stackSize` awareness to pricing — when "sell as stack" is enabled, the price now correctly applies to the whole stack rather than per-unit
- Added insufficient gold logging to help debug failed exchange validations

### UI Improvements
- Transactions page now fills the entire content area instead of being capped at a fixed height
- About page content displayed in a 3-column layout
- Connection status moved above the sidebar divider and centered
- Gold bar sprite added as the app icon (window, taskbar, and installer)
- Gold bar sprite displayed next to "Merchant Mode" in the sidebar title

### Changes from v1.0.2
- `core/engine/merchant-engine.ts` — stackSize-aware pricing in `tryAutoFill`, `onTradeComplete`, and `matchListing`; quantity rounding for stack-size listings
- `electron/main.ts` — whisper reply includes quantity and total price; stackSize-aware pricing in reply; app window icon set to gold bar
- `src/App.tsx` — sidebar title includes gold bar sprite; connection status repositioned and centered
- `src/components/TransactionLog.tsx` — transaction list fills available height
- `src/pages/About.tsx` — 3-column card layout
- `build/icon.ico` — gold bar app icon
- `package.json` — app icon configured for electron-builder
