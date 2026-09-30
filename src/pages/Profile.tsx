import { useState, useEffect } from 'react';
import { ArrowLeft, ExternalLink, User, ShoppingBag, Wifi, WifiOff, Shield, Monitor } from 'lucide-react';
import { getSpriteDataUrl } from '../lib/ae-api';

interface Props {
  playerName: string;
  onBack: () => void;
}

interface PlayerProfile {
  name: string;
  className?: string;
  classId?: number;
  title?: string;
  isMaster?: boolean;
  isOnline?: boolean;
  socialStatus?: number;
}

interface AeListing {
  id: string;
  type: string;
  item_name: string;
  item_slug: string;
  price: number | null;
  quantity: number;
  status: string;
  notes: string | null;
  wanted_items: string | null;
  created_at: string;
}

export default function Profile({ playerName, onBack }: Props) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);
  const [listings, setListings] = useState<AeListing[]>([]);
  const [merchantListings, setMerchantListings] = useState<GlobalMerchantListing[]>([]);
  const [merchantLocation, setMerchantLocation] = useState<{ mapName: string; x: number; y: number } | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const [profileResult, spriteResult, listingsResult] = await Promise.all([
        window.merchantMode?.ae.getPlayerProfile(playerName).catch(() => null),
        getSpriteDataUrl(playerName).catch(() => null),
        window.merchantMode?.ae.getPlayerListings(playerName).catch(() => null),
      ]);

      if (cancelled) return;

      setProfile(profileResult || { name: playerName });
      setSpriteUrl(spriteResult || null);

      if (listingsResult) {
        setListings(listingsResult.data || []);
        setUserData(listingsResult.user || null);
      }

      // Check merchant hub for this player's live bot listings
      try {
        const merchants = await window.merchantMode?.merchants.getAll() || [];
        const match = merchants.find((m: GlobalMerchantData) => m.name.toLowerCase() === playerName.toLowerCase());
        if (match) {
          setMerchantListings(match.listings || []);
          setMerchantLocation({ mapName: match.mapName, x: match.x, y: match.y });
        }
      } catch { /* ignore */ }

      setLoading(false);
    }

    load();
    return () => { cancelled = true; };
  }, [playerName]);

  const activeListings = listings.filter(l => l.status === 'ACTIVE');
  const sellListings = activeListings.filter(l => l.type === 'SELL');
  const buyListings = activeListings.filter(l => l.type === 'BUY');
  const tradeListings = activeListings.filter(l => l.type === 'TRADE');

  const mmSellListings = merchantListings.filter(l => l.type === 'SELL');
  const mmBuyListings = merchantListings.filter(l => l.type === 'BUY');
  const mmTradeListings = merchantListings.filter(l => l.type === 'TRADE');

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={onBack}
            className="btn-secondary"
            style={{ padding: '6px 10px', borderRadius: 8 }}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="page-hero-icon">
            <User size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="page-hero-title">{playerName}</h1>
            <p className="page-hero-subtitle">Player Profile</p>
          </div>
          <button
            onClick={() => window.merchantMode?.shell.openExternal(`https://aislingexchange.com/aislings/${encodeURIComponent(playerName)}`)}
            className="btn-secondary px-4 py-2 rounded-lg text-xs flex items-center gap-1.5"
          >
            <ExternalLink size={13} /> View on AE
          </button>
        </div>
      </div>

      {loading ? (
        <div className="section-card animate-slide-up" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--color-text-tertiary)', fontSize: 13 }}>Loading profile...</p>
        </div>
      ) : (
        <>
          {/* Profile Card */}
          <div className="section-card animate-slide-up" style={{ animationDelay: '80ms' }}>
            <div className="flex items-start gap-5">
              {/* Sprite */}
              {spriteUrl ? (
                <div className="character-portrait" style={{
                  width: 80, height: 80, borderRadius: 12,
                  backgroundImage: `url(${spriteUrl})`,
                  border: '1px solid rgba(201,168,76,0.3)',
                  flexShrink: 0, overflow: 'hidden',
                }} />
              ) : (
                <div style={{
                  width: 80, height: 80, borderRadius: 12,
                  background: 'var(--color-surface-200)',
                  border: '1px solid var(--color-surface-500)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <User size={32} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 space-y-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                      {profile?.name || playerName}
                    </h2>
                    {profile?.isMaster && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        padding: '2px 8px', borderRadius: 4,
                        background: 'rgba(201,168,76,0.15)', color: 'var(--color-gold-400)',
                      }}>
                        Master
                      </span>
                    )}
                  </div>
                  {profile?.className && (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--color-text-secondary)' }}>
                      {profile.className}
                      {profile.title ? ` \u2014 ${profile.title}` : ''}
                    </p>
                  )}
                </div>

                <div className="flex gap-4">
                  {profile && 'isOnline' in profile && (
                    <div className="flex items-center gap-1.5" style={{
                      fontSize: 12,
                      color: profile.isOnline ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                    }}>
                      {profile.isOnline ? <Wifi size={13} /> : <WifiOff size={13} />}
                      {profile.isOnline ? 'Online' : 'Offline'}
                    </div>
                  )}
                  {userData?.verified && (
                    <div className="flex items-center gap-1.5" style={{ fontSize: 12, color: 'var(--color-success)' }}>
                      <Shield size={13} /> Verified
                    </div>
                  )}
                  {userData?.discord_username && (
                    <div style={{ fontSize: 12, color: '#5865F2' }}>
                      Discord: {userData.discord_username}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* DAMerchant listings (live bot) */}
          {merchantListings.length > 0 && (
            <div className="section-card animate-slide-up" style={{ animationDelay: '140ms' }}>
              <div className="section-header">
                <Monitor size={16} className="section-icon" />
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">
                  DAMerchant
                </h3>
                <span style={{ fontSize: 11, color: 'var(--color-success)', fontWeight: 500 }}>
                  Online
                </span>
                {merchantLocation && (
                  <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
                    {merchantLocation.mapName} ({merchantLocation.x}, {merchantLocation.y})
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <StatCard label="Selling" count={mmSellListings.length} color="var(--color-success)" />
                <StatCard label="Buying" count={mmBuyListings.length} color="#60a5fa" />
                <StatCard label="Trading" count={mmTradeListings.length} color="var(--color-warning)" />
              </div>

              <div className="space-y-2">
                {merchantListings.map((listing, i) => (
                  <div key={`mm-${i}`} className="card-inset flex items-center gap-3 p-3">
                    <span
                      className="badge"
                      style={{
                        background: listing.type === 'SELL' ? '#22c55e20' : listing.type === 'BUY' ? '#3b82f620' : '#f59e0b20',
                        color: listing.type === 'SELL' ? 'var(--color-success)' : listing.type === 'BUY' ? '#60a5fa' : 'var(--color-warning)',
                      }}
                    >
                      {listing.type}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }} className="truncate">
                        {listing.type === 'TRADE' ? (
                          <>
                            {listing.quantity && listing.quantity > 1 ? `${listing.quantity}x ` : ''}{listing.itemName}
                            {listing.wantedItems?.[0] && (
                              <span style={{ color: 'var(--color-warning)' }}> &#8594; </span>
                            )}
                            {listing.wantedItems?.[0] && (
                              <>{listing.wantedItems[0].quantity > 1 ? `${listing.wantedItems[0].quantity}x ` : ''}{listing.wantedItems[0].name}</>
                            )}
                          </>
                        ) : (
                          <>
                            {listing.itemName}
                            {listing.stackSize ? <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}> [x{listing.stackSize}]</span> : null}
                          </>
                        )}
                      </p>
                      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {listing.type !== 'TRADE' && listing.price > 0 && (
                          <span style={{ color: 'var(--color-gold-400)' }}>{formatGold(listing.price)}{listing.stackSize ? '/stack' : ''}</span>
                        )}
                        {listing.quantityRemaining !== undefined && listing.quantity !== undefined && listing.type !== 'TRADE' && (
                          <span> {listing.quantityRemaining}/{listing.quantity} remaining</span>
                        )}
                        {listing.type === 'TRADE' && listing.quantityRemaining !== undefined && listing.quantityRemaining > 1 && (
                          <span>{listing.quantityRemaining} trades left</span>
                        )}
                        {listing.notes ? <span> — {listing.notes}</span> : null}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AE Website Listings */}
          <div className="section-card animate-slide-up" style={{ animationDelay: merchantListings.length > 0 ? '200ms' : '140ms' }}>
            <div className="section-header">
              <ShoppingBag size={16} className="section-icon" />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">
                AislingExchange Listings
              </h3>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                ({activeListings.length})
              </span>
            </div>

            {activeListings.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                No active listings on AislingExchange
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3 mb-3">
                  <StatCard label="Selling" count={sellListings.length} color="var(--color-success)" />
                  <StatCard label="Buying" count={buyListings.length} color="#60a5fa" />
                  <StatCard label="Trading" count={tradeListings.length} color="var(--color-warning)" />
                </div>
                <div className="space-y-2">
                  {activeListings.map((listing) => (
                    <div
                      key={listing.id}
                      className="card-inset flex items-center gap-3 p-3"
                    >
                      <span
                        className="badge"
                        style={{
                          background: listing.type === 'SELL' ? '#22c55e20' : listing.type === 'BUY' ? '#3b82f620' : '#f59e0b20',
                          color: listing.type === 'SELL' ? 'var(--color-success)' : listing.type === 'BUY' ? '#60a5fa' : 'var(--color-warning)',
                        }}
                      >
                        {listing.type}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }} className="truncate">
                          {listing.item_name}
                        </p>
                        <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                          {listing.price ? formatGold(listing.price) : 'Offer'}
                          {listing.quantity > 1 ? ` \u00d7 ${listing.quantity}` : ''}
                          {listing.notes ? ` \u2014 ${listing.notes}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="section-card" style={{ textAlign: 'center', padding: '14px 12px' }}>
      <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color }}>{count}</p>
      <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</p>
    </div>
  );
}

function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toString();
}
