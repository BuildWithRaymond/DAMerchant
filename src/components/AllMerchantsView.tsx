import { useEffect, useState } from 'react';
import { MapPin, ShoppingBag, Tag, ArrowLeftRight, Users, User } from 'lucide-react';
import { getSpriteDataUrl } from '../lib/ae-api';

interface Props {
  merchants: GlobalMerchantData[];
  proxyStatus: string;
  onViewProfile?: (name: string) => void;
}

export default function AllMerchantsView({ merchants, proxyStatus, onViewProfile }: Props) {
  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="page-hero-icon">
            <Users size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="page-hero-title">All Merchants</h1>
            <p className="page-hero-subtitle">{merchants.length} merchants online</p>
          </div>
          {merchants.length > 0 && (
            <div style={{
              padding: '5px 14px',
              borderRadius: 20,
              background: 'rgba(74,222,128,0.1)',
              border: '1px solid rgba(74,222,128,0.2)',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-success)',
            }}>
              {merchants.reduce((sum, m) => sum + m.listings.length, 0)} listings
            </div>
          )}
        </div>
      </div>

      {proxyStatus !== 'connected' && (
        <div className="empty-state section-card animate-slide-up" style={{ animationDelay: '80ms' }}>
          <div className="empty-state-icon">
            <Users size={24} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            Start the proxy to connect
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            Launch a client to join the merchant network
          </p>
        </div>
      )}

      {proxyStatus === 'connected' && merchants.length === 0 && (
        <div className="empty-state section-card animate-slide-up" style={{ animationDelay: '80ms' }}>
          <div className="empty-state-icon">
            <Users size={24} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            No other merchants online
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            Other DAMerchant users will appear here when they're online
          </p>
        </div>
      )}

      {merchants.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {merchants.map((merchant, i) => (
            <div key={merchant.name} className="animate-slide-up" style={{ animationDelay: `${80 + i * 50}ms` }}>
              <MerchantCard merchant={merchant} onViewProfile={onViewProfile} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AvatarCircle({ spriteUrl }: { spriteUrl: string | null }) {
  if (!spriteUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          background: 'linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.05))',
          border: '1px solid rgba(201,168,76,0.2)',
        }}
      >
        <User size={16} style={{ color: 'var(--color-gold-600)', opacity: 0.7 }} />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 rounded-full overflow-hidden character-portrait"
      style={{
        width: 36,
        height: 36,
        backgroundImage: `url(${spriteUrl})`,
        border: '1px solid rgba(201,168,76,0.3)',
      }}
    />
  );
}

function MerchantCard({ merchant, onViewProfile }: { merchant: GlobalMerchantData; onViewProfile?: (name: string) => void }) {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);

  useEffect(() => {
    getSpriteDataUrl(merchant.name).then(setSpriteUrl);
  }, [merchant.name]);

  const buyListings = merchant.listings.filter((l) => l.type === 'BUY');
  const sellListings = merchant.listings.filter((l) => l.type === 'SELL');
  const tradeListings = merchant.listings.filter((l) => l.type === 'TRADE');

  return (
    <div className="stat-card" style={{ padding: '18px 20px' }}>
      {/* Header: avatar + name/location + sprite */}
      <div className="flex items-start gap-3 mb-3">
        <AvatarCircle spriteUrl={spriteUrl} />

        <div className="flex-1 min-w-0">
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              background: 'linear-gradient(135deg, #dbb85e, #c9a84c)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              cursor: onViewProfile ? 'pointer' : undefined,
            }}
            onClick={() => onViewProfile?.(merchant.name)}
          >
            {merchant.name}
          </h3>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            <div className="flex items-center gap-1.5">
              <MapPin size={12} className="flex-shrink-0" />
              <span className="truncate">{merchant.mapName || 'Unknown Map'}</span>
            </div>
            <div style={{ fontSize: 10, marginLeft: 18, color: 'var(--color-text-tertiary)' }}>
              {merchant.x}, {merchant.y}
            </div>
          </div>
        </div>

        {spriteUrl && (
          <div
            className="flex-shrink-0 self-center rounded-lg character-portrait"
            style={{ width: 64, height: 64, backgroundImage: `url(${spriteUrl})`, opacity: 0.85 }}
          />
        )}
      </div>

      {/* Listings summary */}
      {merchant.listings.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>No active listings</p>
      ) : (
        <div className="space-y-1.5">
          {sellListings.length > 0 && (
            <ListingGroup icon={<Tag size={11} />} label="Selling" listings={sellListings} color="var(--color-success)" />
          )}
          {buyListings.length > 0 && (
            <ListingGroup icon={<ShoppingBag size={11} />} label="Buying" listings={buyListings} color="#60a5fa" />
          )}
          {tradeListings.length > 0 && (
            <ListingGroup icon={<ArrowLeftRight size={11} />} label="Trading" listings={tradeListings} color="var(--color-warning)" />
          )}
        </div>
      )}

      {/* View Profile */}
      {onViewProfile && (
        <button
          onClick={() => onViewProfile(merchant.name)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--color-gold-400)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            transition: 'opacity 200ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.7'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          <User size={11} />
          View Profile
        </button>
      )}
    </div>
  );
}

function ListingGroup({ icon, label, listings, color }: {
  icon: React.ReactNode;
  label: string;
  listings: GlobalMerchantListing[];
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1" style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3, color }}>
        {icon}
        {label}
      </div>
      <div className="space-y-1">
        {listings.map((l, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 px-2 py-1.5 rounded"
            style={{
              background: 'var(--color-surface-200)',
              border: '1px solid var(--color-surface-500)',
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              transition: 'border-color 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-surface-500)'; }}
          >
            <div className="flex-1 min-w-0">
              {l.type === 'TRADE' ? (
                <span>
                  {l.quantity && l.quantity > 1 ? `${l.quantity}x ` : ''}{l.itemName}
                  <span style={{ color }} className="mx-1">&#8594;</span>
                  {l.wantedItems?.[0] ? (
                    <>{l.wantedItems[0].quantity > 1 ? `${l.wantedItems[0].quantity}x ` : ''}{l.wantedItems[0].name}</>
                  ) : '???'}
                  {l.quantityRemaining !== undefined && l.quantityRemaining > 1 && (
                    <span style={{ color: 'var(--color-text-tertiary)' }}> ({l.quantityRemaining} trades left)</span>
                  )}
                </span>
              ) : (
                <span>
                  {l.itemName}
                  {l.stackSize ? (
                    <span style={{ color: 'var(--color-text-tertiary)' }}> [x{l.stackSize}]</span>
                  ) : null}
                  {l.price > 0 && (
                    <span style={{ color: 'var(--color-gold-400)', marginLeft: 4 }}>
                      {formatGold(l.price)}
                      {l.stackSize ? '/stack' : ''}
                    </span>
                  )}
                  {l.quantityRemaining !== undefined && l.quantity !== undefined && (
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                      {l.quantityRemaining}/{l.quantity}
                    </span>
                  )}
                </span>
              )}
              {l.notes && (
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }} className="truncate">
                  {l.notes}
                </div>
              )}
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
