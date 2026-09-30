import { useState, useEffect } from 'react';
import { Monitor, Tag, ShoppingBag, ArrowLeftRight, MapPin, List, Download, Globe } from 'lucide-react';
import ListingManager from '../components/ListingManager';
import type { PrefillItem } from '../components/ListingManager';
import { getSpriteDataUrl } from '../lib/ae-api';
import { User } from 'lucide-react';

interface Props {
  characterName: string | null;
  prefillItem?: PrefillItem | null;
  onPrefillConsumed?: () => void;
  allMerchantsMode?: boolean;
  allMerchants?: GlobalMerchantData[];
}

export default function Listings({ characterName, prefillItem, onPrefillConsumed, allMerchantsMode, allMerchants }: Props) {
  const [listings, setListings] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [aeLoggedIn, setAeLoggedIn] = useState(false);

  useEffect(() => {
    const api = window.merchantMode;
    if (!api || !characterName) {
      setListings([]);
      setInventory([]);
      return;
    }

    loadListings();
    api.inventory.get(characterName).then(setInventory);
    api.ae.getAuthStatus().then(s => setAeLoggedIn(s.loggedIn)).catch(() => {});

    const handleTransaction = (tx: any) => {
      if (!tx.characterName || tx.characterName === characterName) {
        loadListings();
      }
    };

    const handleInventoryUpdate = (data: any) => {
      if (data.characterName === characterName) {
        setInventory(data.items);
      }
    };

    const handleListingsChanged = (data: any) => {
      if (data.characterName === characterName) {
        loadListings();
      }
    };

    api.engine.onTransaction(handleTransaction);
    api.inventory.onUpdate(handleInventoryUpdate);
    api.listings.onChanged(handleListingsChanged);
    api.ae.onAuthChanged(s => setAeLoggedIn(s.loggedIn));

    // Don't call removeAllListeners — it kills App-level listeners
  }, [characterName]);

  async function loadListings() {
    const api = window.merchantMode;
    if (!api || !characterName) return;
    const all = await api.listings.getAll(characterName);
    setListings(all);
  }

  async function handleImportFromAE() {
    if (!characterName || importing) return;
    setImporting(true);
    setImportResult(null);
    const result = await window.merchantMode?.ae.importListings(characterName);
    if (result?.error) {
      setImportResult(result.error);
    } else if (result?.imported === 0) {
      setImportResult('All AE listings are already imported');
    } else {
      setImportResult(`Imported ${result?.imported} listing${result?.imported === 1 ? '' : 's'} from AE`);
      loadListings();
    }
    setImporting(false);
    setTimeout(() => setImportResult(null), 4000);
  }

  if (allMerchantsMode && allMerchants) {
    return <AllMerchantsListings merchants={allMerchants} />;
  }

  if (!characterName) {
    return (
      <div className="empty-state animate-fade-in" style={{ height: '100%' }}>
        <div className="empty-state-icon">
          <Monitor size={24} style={{ color: 'var(--color-gold-400)' }} />
        </div>
        <div className="text-center">
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            No character selected
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            Launch a client to get started.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="page-hero-icon">
            <List size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="page-hero-title">Listings</h1>
            <p className="page-hero-subtitle">{characterName}</p>
          </div>
          {aeLoggedIn && (
            <button
              onClick={handleImportFromAE}
              disabled={importing}
              className="btn-secondary px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
              style={{ opacity: importing ? 0.6 : 1 }}
              title="Refresh listings from AislingExchange"
            >
              <Globe size={13} />
              {importing ? 'Syncing...' : 'Sync AE'}
            </button>
          )}
        </div>
        {importResult && (
          <p style={{
            margin: '8px 0 0',
            fontSize: 11,
            color: importResult.includes('Error') || importResult.includes('error')
              ? 'var(--color-danger)'
              : 'var(--color-success)',
          }}>
            {importResult}
          </p>
        )}
      </div>

      <div className="animate-slide-up" style={{ animationDelay: '80ms' }}>
        <ListingManager
          listings={listings}
          onRefresh={loadListings}
          characterName={characterName}
          prefillItem={prefillItem}
          onPrefillConsumed={onPrefillConsumed}
          inventory={inventory}
        />
      </div>
    </div>
  );
}

// --- All Merchants Listings View ---

function MerchantAvatar({ name }: { name: string }) {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);

  useEffect(() => {
    getSpriteDataUrl(name).then(setSpriteUrl);
  }, [name]);

  if (!spriteUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full flex items-center justify-center"
        style={{
          width: 28,
          height: 28,
          background: 'linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.04))',
          border: '1px solid rgba(201,168,76,0.15)',
        }}
      >
        <User size={14} style={{ color: 'var(--color-gold-600)', opacity: 0.7 }} />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 rounded-full overflow-hidden character-portrait"
      style={{
        width: 28,
        height: 28,
        backgroundImage: `url(${spriteUrl})`,
        border: '1px solid rgba(201,168,76,0.3)',
      }}
    />
  );
}

const TYPE_STYLES: Record<string, { bg: string; color: string; icon: typeof Tag }> = {
  SELL: { bg: '#22c55e20', color: 'var(--color-success)', icon: Tag },
  BUY: { bg: '#3b82f620', color: '#60a5fa', icon: ShoppingBag },
  TRADE: { bg: '#f59e0b20', color: 'var(--color-warning)', icon: ArrowLeftRight },
};

function AllMerchantsListings({ merchants }: { merchants: GlobalMerchantData[] }) {
  const allListings = merchants.flatMap((m) =>
    m.listings.map((l) => ({
      ...l,
      merchantName: m.name,
      mapName: m.mapName,
      x: m.x,
      y: m.y,
    }))
  );

  const sellListings = allListings.filter((l) => l.type === 'SELL');
  const buyListings = allListings.filter((l) => l.type === 'BUY');
  const tradeListings = allListings.filter((l) => l.type === 'TRADE');

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="page-hero-icon">
            <List size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="page-hero-title">All Merchant Listings</h1>
            <p className="page-hero-subtitle">
              {allListings.length} listings from {merchants.length} merchants
            </p>
          </div>
        </div>
      </div>

      {allListings.length === 0 ? (
        <div className="empty-state section-card animate-slide-up" style={{ animationDelay: '80ms' }}>
          <div className="empty-state-icon">
            <List size={24} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-tertiary)' }}>
            No listings from any merchants right now.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sellListings.length > 0 && (
            <div className="animate-slide-up" style={{ animationDelay: '80ms' }}>
              <ListingSection label="Selling" type="SELL" listings={sellListings} />
            </div>
          )}
          {buyListings.length > 0 && (
            <div className="animate-slide-up" style={{ animationDelay: '140ms' }}>
              <ListingSection label="Buying" type="BUY" listings={buyListings} />
            </div>
          )}
          {tradeListings.length > 0 && (
            <div className="animate-slide-up" style={{ animationDelay: '200ms' }}>
              <ListingSection label="Trading" type="TRADE" listings={tradeListings} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MerchantListing extends GlobalMerchantListing {
  merchantName: string;
  mapName: string;
  x: number;
  y: number;
}

function ListingSection({ label, type, listings }: { label: string; type: string; listings: MerchantListing[] }) {
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.SELL;
  const Icon = style.icon;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} style={{ color: style.color }} />
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: style.color }}>
          {label}
        </span>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          ({listings.length})
        </span>
      </div>
      <div className="space-y-1.5">
        {listings.map((l, i) => (
          <div key={`${l.merchantName}-${l.itemName}-${i}`} className="card-inset listing-row flex items-center gap-3 p-3">
            <span
              className="badge flex-shrink-0"
              style={{ background: style.bg, color: style.color }}
            >
              {type}
            </span>
            <MerchantAvatar name={l.merchantName} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
                {l.type === 'TRADE' ? (
                  <>
                    {l.quantity && l.quantity > 1 ? `${l.quantity}x ` : ''}{l.itemName}
                    <span style={{ color: style.color }} className="mx-1">&#8594;</span>
                    {l.wantedItems?.[0] ? (
                      <>{l.wantedItems[0].quantity > 1 ? `${l.wantedItems[0].quantity}x ` : ''}{l.wantedItems[0].name}</>
                    ) : '???'}
                    {l.quantityRemaining !== undefined && l.quantityRemaining > 1 && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        ({l.quantityRemaining} trades left)
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {l.itemName}
                    {l.stackSize ? (
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}> [x{l.stackSize}]</span>
                    ) : null}
                    {l.price > 0 && (
                      <span className="ml-2" style={{ color: 'var(--color-gold-400)' }}>
                        {formatGold(l.price)}{l.stackSize ? '/stack' : ''}
                      </span>
                    )}
                    {l.quantityRemaining !== undefined && l.quantity !== undefined && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {l.quantityRemaining}/{l.quantity} remaining
                      </span>
                    )}
                  </>
                )}
              </p>
              {l.notes && (
                <p className="text-xs truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                  {l.notes}
                </p>
              )}
              <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                <span className="gold-text font-medium">{l.merchantName}</span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>·</span>
                <MapPin size={10} style={{ flexShrink: 0 }} />
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {l.mapName || 'Unknown'} ({l.x}, {l.y})
                </span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}
