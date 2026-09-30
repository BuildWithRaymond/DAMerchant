import { useState, useEffect } from 'react';
import { Monitor, Activity, TrendingUp, Coins, Package, MessageCircle, Users } from 'lucide-react';
import WhisperQueue from '../components/WhisperQueue';
import InventoryView from '../components/InventoryView';
import CreateListingModal from '../components/CreateListingModal';
import type { PrefillItem } from '../components/CreateListingModal';
import { automaticGroupTitle, customGroupEnabled, DEFAULT_GROUP_DESCRIPTION, LEGACY_GROUP_TITLE, LEGACY_GROUP_DESCRIPTION } from '../../core/engine/merchant-group';

interface Props {
  proxyStatus: string;
  engineState: string;
  characterName: string | null;
}

export default function Dashboard({ proxyStatus, engineState, characterName }: Props) {
  const [listings, setListings] = useState<any[]>([]);
  const [whispers, setWhispers] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [gold, setGold] = useState(0);
  const [todayTrades, setTodayTrades] = useState(0);
  const [modalItem, setModalItem] = useState<PrefillItem | null>(null);
  const [groupEnabled, setGroupEnabled] = useState(true);
  const [groupCustomEnabled, setGroupCustomEnabled] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupDescription, setGroupDescription] = useState(DEFAULT_GROUP_DESCRIPTION);

  useEffect(() => {
    const api = window.merchantMode;
    if (!api || !characterName) {
      setListings([]);
      setWhispers([]);
      setInventory([]);
      setGold(0);
      setTodayTrades(0);
      setGroupEnabled(true);
      setGroupCustomEnabled(false);
      setGroupTitle('');
      setGroupDescription(DEFAULT_GROUP_DESCRIPTION);
      return;
    }

    loadListings();
    api.engine.getWhispers(characterName).then(setWhispers);
    api.inventory.get(characterName).then(setInventory);
    api.inventory.getGold(characterName).then(setGold);

    api.settings.get(`group_enabled:${characterName}`, 'true').then((v) => setGroupEnabled(v === 'true'));
    Promise.all([
      api.settings.get(`group_custom_enabled:${characterName}`, ''),
      api.settings.get(`group_title:${characterName}`, ''),
      api.settings.get(`group_description:${characterName}`, ''),
    ]).then(([mode, title, description]) => {
      const custom = customGroupEnabled(mode, title || LEGACY_GROUP_TITLE, description || LEGACY_GROUP_DESCRIPTION);
      setGroupCustomEnabled(custom);
      setGroupTitle(custom || title !== LEGACY_GROUP_TITLE ? title : '');
      setGroupDescription(custom && description ? description : DEFAULT_GROUP_DESCRIPTION);
    });

    const today = new Date().toISOString().split('T')[0];
    api.transactions.getByDate(today, today).then((txs) => setTodayTrades(txs.length));

    const handleWhisper = (w: any) => {
      if (w.characterName === characterName) {
        setWhispers((prev) => [...prev, w]);
      }
    };
    const handleInventoryUpdate = (data: any) => {
      if (data.characterName === characterName) {
        setInventory(data.items);
      }
    };
    const handleTransaction = (tx: any) => {
      if (!tx.characterName || tx.characterName === characterName) {
        setTodayTrades((prev) => prev + 1);
        loadListings();
      }
    };

    const handleGoldUpdate = (data: any) => {
      if (data.characterName === characterName) {
        setGold(data.gold);
      }
    };

    api.engine.onWhisper(handleWhisper);
    api.inventory.onUpdate(handleInventoryUpdate);
    api.inventory.onGoldUpdate(handleGoldUpdate);
    api.engine.onTransaction(handleTransaction);

    // NOTE: We intentionally do NOT call api.removeAllListeners() here.
    // That would kill App-level listeners (characters:connected, etc.).
    // These listeners filter by characterName, so stale ones are harmless.
  }, [characterName]);

  async function loadListings() {
    const api = window.merchantMode;
    if (!api || !characterName) return;
    const all = await api.listings.getAll(characterName);
    setListings(all);
  }

  function saveGroupSetting(key: string, value: string) {
    if (!characterName) return;
    window.merchantMode?.settings.set(`${key}:${characterName}`, value);
  }

  function handleInventoryItemClick(item: any) {
    setModalItem({ name: item.name, quantity: item.quantity, isStackable: item.isStackable });
  }

  const activeListings = listings.filter((l: any) => l.status === 'ACTIVE').length;
  const autoGroupTitle = automaticGroupTitle(listings);
  const connected = proxyStatus === 'connected';

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

  const stats = [
    {
      icon: Activity,
      label: 'Status',
      value: connected ? (engineState === 'IDLE' ? 'Ready' : engineState.replace(/_/g, ' ')) : 'Offline',
      color: connected ? (engineState === 'IDLE' ? 'var(--color-success)' : 'var(--color-warning)') : 'var(--color-text-tertiary)',
    },
    {
      icon: Package,
      label: 'Active Listings',
      value: activeListings.toString(),
      color: 'var(--color-gold-400)',
    },
    {
      icon: TrendingUp,
      label: 'Trades Today',
      value: todayTrades.toString(),
      color: 'var(--color-gold-400)',
    },
    {
      icon: Coins,
      label: 'Gold',
      value: formatGold(gold),
      color: 'var(--color-warning)',
    },
  ];

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="page-hero-icon">
            <Activity size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div>
            <h1 className="page-hero-title">Dashboard</h1>
            <p className="page-hero-subtitle">{characterName}</p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <div
            key={s.label}
            className="stat-card animate-slide-up"
            style={{ animationDelay: `${60 + i * 50}ms` }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <s.icon size={14} style={{ color: s.color }} />
              <p className="stat-label" style={{ margin: 0 }}>{s.label}</p>
            </div>
            <p style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
            }}>
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Merchant Group Title */}
      <div className="section-card animate-slide-up" style={{ animationDelay: '260ms' }}>
        <div className="section-header">
          <Users size={16} className="section-icon" />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">Merchant Group Title</h3>
        </div>
        <div
          className="flex items-center justify-between cursor-pointer"
          onClick={() => {
            const next = !groupEnabled;
            setGroupEnabled(next);
            saveGroupSetting('group_enabled', next.toString());
          }}
          style={{
            padding: '12px 14px',
            borderRadius: 8,
            background: 'var(--color-surface-200)',
            border: '1px solid var(--color-surface-500)',
            transition: 'border-color 200ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(201,168,76,0.3)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-surface-500)'; }}
        >
          <div>
            <span style={{ fontSize: 13, color: 'var(--color-text-primary)', fontWeight: 500 }}>Display group title</span>
            <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              Show a title above this character's name while DAMerchant is active
            </p>
          </div>
          <div
            className="toggle-track"
            style={{
              background: groupEnabled
                ? 'linear-gradient(135deg, #dbb85e, #b8973e)'
                : 'var(--color-surface-500)',
              marginLeft: 16,
            }}
          >
            <div className="toggle-thumb" style={{ left: groupEnabled ? 22 : 2 }} />
          </div>
        </div>
        {groupEnabled && (
          <div className="space-y-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--color-surface-500)' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {([['Automatic', false], ['Custom', true]] as const).map(([label, custom]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setGroupCustomEnabled(custom);
                    if (custom) {
                      const title = groupTitle || autoGroupTitle;
                      setGroupTitle(title);
                      saveGroupSetting('group_title', title);
                      saveGroupSetting('group_description', groupDescription);
                    }
                    saveGroupSetting('group_custom_enabled', custom.toString());
                  }}
                  style={{
                    padding: '7px 12px', borderRadius: 7, fontSize: 12, cursor: 'pointer',
                    color: groupCustomEnabled === custom ? 'var(--color-gold-400)' : 'var(--color-text-secondary)',
                    background: groupCustomEnabled === custom ? 'rgba(201,168,76,0.12)' : 'var(--color-surface-200)',
                    border: `1px solid ${groupCustomEnabled === custom ? 'rgba(201,168,76,0.45)' : 'var(--color-surface-500)'}`,
                  }}
                >{label}</button>
              ))}
            </div>
            {!groupCustomEnabled ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                <strong>{autoGroupTitle}</strong> · {DEFAULT_GROUP_DESCRIPTION}
              </p>
            ) : (
              <>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Group title</span>
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                onBlur={() => {
                  const title = groupTitle.trim() || autoGroupTitle;
                  setGroupTitle(title);
                  saveGroupSetting('group_title', title);
                }}
                className="settings-input"
                style={{ width: '100%', fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Group description</span>
              <input
                type="text"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                onBlur={() => {
                  const description = groupDescription.trim() || DEFAULT_GROUP_DESCRIPTION;
                  setGroupDescription(description);
                  saveGroupSetting('group_description', description);
                }}
                className="settings-input"
                style={{ width: '100%', fontSize: 13 }}
              />
            </label>
              </>
            )}
            <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
              The title appears above your character's name in-game. The group is created automatically when you have active listings and disbanded when you disconnect.
            </p>
          </div>
        )}
      </div>

      {/* Inventory */}
      <div
        className="section-card animate-slide-up"
        style={{ animationDelay: '320ms' }}
      >
        <InventoryView items={inventory} gold={gold} onItemClick={handleInventoryItemClick} />
      </div>

      {/* Whisper Queue */}
      <div
        className="section-card animate-slide-up"
        style={{ animationDelay: '380ms' }}
      >
        <div className="section-header">
          <MessageCircle size={16} className="section-icon" />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">Whisper Queue</h3>
        </div>
        <WhisperQueue whispers={whispers} />
      </div>

      {modalItem && characterName && (
        <CreateListingModal
          characterName={characterName}
          prefillItem={modalItem}
          onClose={() => setModalItem(null)}
          onCreated={loadListings}
        />
      )}
    </div>
  );
}

function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}
