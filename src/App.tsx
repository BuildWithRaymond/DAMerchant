import { useState, useEffect } from 'react';
import { LayoutDashboard, Clock, Settings as SettingsIcon, Play, Loader2, List, Info, MessageCircle } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Listings from './pages/Listings';
import Whispers from './pages/Whispers';
import Settings from './pages/Settings';
import About from './pages/About';
import Profile from './pages/Profile';
import TransactionLog from './components/TransactionLog';
import PacketSniffer from './components/PacketSniffer';
import ConnectionStatus from './components/ConnectionStatus';
import CharacterTabs from './components/CharacterTabs';
import AllMerchantsView from './components/AllMerchantsView';
import UpdateBanner from './components/UpdateBanner';
import ReconnectBanner from './components/ReconnectBanner';

type Page = 'dashboard' | 'listings' | 'whispers' | 'transactions' | 'sniffer' | 'settings' | 'about' | 'profile';

const NAV_ITEMS: { page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'listings', label: 'Listings', icon: List },
  { page: 'whispers', label: 'Whispers', icon: MessageCircle },
  { page: 'transactions', label: 'History', icon: Clock },
  { page: 'settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [proxyStatus, setProxyStatus] = useState('disconnected');
  const [characters, setCharacters] = useState<string[]>([]);
  const [activeCharacter, setActiveCharacter] = useState<string | null>(null);
  const [characterStates, setCharacterStates] = useState<Record<string, string>>({});
  const [characterTypes, setCharacterTypes] = useState<Record<string, 'launched' | 'bot'>>({});
  const [transactions, setTransactions] = useState<any[]>([]);
  const [snifferLog, setSnifferLog] = useState<any[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [exchangeErrors, setExchangeErrors] = useState<Record<string, string>>({});
  const [allMerchantsMode, setAllMerchantsMode] = useState(false);
  const [allMerchants, setAllMerchants] = useState<GlobalMerchantData[]>([]);
  const [profileTarget, setProfileTarget] = useState<string | null>(null);
  const [profileReturnPage, setProfileReturnPage] = useState<Page>('dashboard');
  const [isDev, setIsDev] = useState(false);

  function viewProfile(name: string) {
    setProfileTarget(name);
    setProfileReturnPage(page);
    setPage('profile');
  }

  useEffect(() => {
    const api = window.merchantMode;
    if (!api) return;

    api.debug.isDev().then(setIsDev).catch(() => {});
    api.proxy.getStatus().then(setProxyStatus);
    api.merchants.getAll().then(setAllMerchants);
    api.merchants.onUpdated(setAllMerchants);
    api.characters.list().then((entries) => {
      const names = entries.map((e) => e.name);
      setCharacters(names);
      setCharacterTypes(Object.fromEntries(entries.map((e) => [e.name, e.connectionType])));
      if (names.length > 0 && !activeCharacter) {
        setActiveCharacter(names[0]);
      }
    });
    api.transactions.getAll().then(setTransactions);
    api.sniffer.getLog().then(setSnifferLog);

    api.proxy.onStatus(setProxyStatus);

    api.characters.onConnected((data) => {
      setCharacters((prev) => {
        if (prev.includes(data.name)) return prev;
        return [...prev, data.name];
      });
      setCharacterTypes((prev) => ({ ...prev, [data.name]: data.connectionType }));
      setActiveCharacter((prev) => prev ?? data.name);
    });

    api.characters.onDisconnected((name) => {
      setCharacters((prev) => prev.filter((c) => c !== name));
      setActiveCharacter((prev) => {
        if (prev === name) return null;
        return prev;
      });
      setCharacterStates((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setCharacterTypes((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    });

    api.engine.onState((data) => {
      setCharacterStates((prev) => ({ ...prev, [data.characterName]: data.state }));
    });

    api.engine.onExchangeStarted(({ characterName }) => {
      setExchangeErrors((prev) => {
        const next = { ...prev };
        delete next[characterName];
        return next;
      });
    });

    api.engine.onValidationFailed(({ characterName, reason }) => {
      setExchangeErrors((prev) => ({ ...prev, [characterName]: reason }));
    });

    api.engine.onTransaction((tx) => {
      setTransactions((prev) => [tx, ...prev]);
    });

    api.proxy.onPacket((pkt) => {
      setSnifferLog((prev) => {
        const next = [...prev, pkt];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });

    return () => {
      api.removeAllListeners();
    };
  }, []);

  useEffect(() => {
    if (!activeCharacter && !allMerchantsMode && characters.length > 0) {
      setActiveCharacter(characters[0]);
    }
  }, [characters, activeCharacter, allMerchantsMode]);

  const engineState = activeCharacter ? (characterStates[activeCharacter] ?? 'IDLE') : 'IDLE';

  return (
    <div className="flex h-screen" style={{ background: 'var(--color-surface-100)' }}>
      {/* Sidebar */}
      <nav
        className="w-56 flex flex-col border-r"
        style={{
          background: 'linear-gradient(180deg, var(--color-surface-300) 0%, var(--color-surface-200) 100%)',
          borderColor: 'var(--color-surface-500)',
        }}
      >
        {/* Brand */}
        <div className="px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.05))',
              border: '1px solid rgba(201,168,76,0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <img src="items/4529.png" alt="" style={{ width: 22, height: 22, imageRendering: 'pixelated' }} />
            </div>
            <div>
              <h1 className="text-base font-bold leading-tight tracking-tight" style={{
                background: 'linear-gradient(135deg, #dbb85e, #f0d078, #c9a84c)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                DAMerchant
              </h1>
              <p className="text-[10px] leading-tight" style={{ color: 'var(--color-text-tertiary)', letterSpacing: '0.06em' }}>
                AislingExchange.com
              </p>
            </div>
          </div>
          <div
            className="mt-3"
            style={{
              height: 1,
              background: 'linear-gradient(90deg, var(--color-gold-400), transparent)',
            }}
          />
        </div>

        {/* Navigation */}
        <div className="flex-1 px-2 flex flex-col gap-1">
          {NAV_ITEMS.map(({ page: p, label, icon: Icon }) => {
            const isActive = page === p;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className="nav-item"
                style={{
                  background: isActive ? 'var(--color-surface-400)' : 'transparent',
                  color: isActive ? 'var(--color-gold-400)' : 'var(--color-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--color-surface-400)';
                    e.currentTarget.style.color = 'var(--color-text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--color-text-secondary)';
                  }
                }}
              >
                {isActive && <div className="nav-item-indicator" />}
                <Icon size={16} />
                <span style={{ fontWeight: isActive ? 600 : 400 }}>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-3 pb-4 space-y-3">
          <button
            onClick={async () => {
              setLaunching(true);
              setLaunchError('');
              const api = window.merchantMode;
              if (!api) return;
              const result = await api.launcher.launch();
              setLaunching(false);
              if (!result.success) {
                setLaunchError(result.error || 'Launch failed');
              }
            }}
            disabled={launching}
            className="btn-primary w-full px-3 py-2.5 rounded-lg text-sm"
            style={{ opacity: launching ? 0.6 : 1 }}
          >
            {launching ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            {launching ? 'Launching...' : 'Launch Client'}
          </button>
          {launchError && (
            <p className="text-xs text-center" style={{ color: 'var(--color-danger)' }}>{launchError}</p>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
            padding: '8px 16px',
            borderBottom: '1px solid var(--color-surface-500)',
            background: 'var(--color-surface-200)',
            flexShrink: 0,
          }}
        >
          <ConnectionStatus proxyStatus={proxyStatus} engineState={engineState} />
          <button
            onClick={() => setPage('about')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid var(--color-surface-500)',
              background: page === 'about' ? 'var(--color-surface-400)' : 'transparent',
              color: page === 'about' ? 'var(--color-gold-400)' : 'var(--color-text-tertiary)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (page !== 'about') {
                e.currentTarget.style.background = 'var(--color-surface-300)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
              }
            }}
            onMouseLeave={(e) => {
              if (page !== 'about') {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--color-text-tertiary)';
              }
            }}
          >
            <Info size={13} />
            About
          </button>
          {isDev && (
            <button
              onClick={async () => {
                const result = await window.merchantMode?.debug.simulateServerDisconnect();
                if (result?.success) console.log('[Debug] Server disconnect simulated');
                else console.log('[Debug] Failed:', result?.error);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.25)',
                color: '#ef4444',
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239,68,68,0.1)';
              }}
              title="Simulate server disconnect (dev only)"
            >
              Kill Server
            </button>
          )}
        </div>
        <UpdateBanner />
        <ReconnectBanner />
        {activeCharacter && exchangeErrors[activeCharacter] && (
          <div role="alert" className="px-4 py-2 text-xs" style={{ color: 'var(--color-danger)', background: 'var(--color-surface-200)', borderBottom: '1px solid var(--color-surface-500)' }}>
            Exchange canceled: {exchangeErrors[activeCharacter]}
          </div>
        )}
        {(page === 'dashboard' || page === 'listings') && (
          <CharacterTabs
            characters={characters}
            activeCharacter={activeCharacter}
            onSelect={(name) => { setAllMerchantsMode(false); setActiveCharacter(name); }}
            onSelectAll={() => { setAllMerchantsMode(true); setActiveCharacter(null); }}
            isAllSelected={allMerchantsMode}
            allMerchantsCount={allMerchants.length}
            characterStates={characterStates}
            characterTypes={characterTypes}
          />
        )}
        {page === 'transactions' && (
          <CharacterTabs
            characters={characters}
            activeCharacter={activeCharacter}
            onSelect={(name) => { setAllMerchantsMode(false); setActiveCharacter(name); }}
            onSelectAll={() => {}}
            isAllSelected={false}
            allMerchantsCount={0}
            characterStates={characterStates}
            characterTypes={characterTypes}
            hideAllMerchants
          />
        )}

        <main className="flex-1 overflow-auto p-6">
          {page === 'dashboard' && allMerchantsMode && (
            <AllMerchantsView merchants={allMerchants} proxyStatus={proxyStatus} onViewProfile={viewProfile} />
          )}
          {page === 'dashboard' && !allMerchantsMode && (
            <Dashboard
              proxyStatus={proxyStatus}
              engineState={engineState}
              characterName={activeCharacter}
            />
          )}
          {page === 'listings' && (
            <Listings
              characterName={activeCharacter}
              allMerchantsMode={allMerchantsMode}
              allMerchants={allMerchants}
            />
          )}
          {page === 'whispers' && (
            <Whispers characters={characters} onViewProfile={viewProfile} />
          )}
          {page === 'transactions' && (
            <TransactionLog
              transactions={
                allMerchantsMode || !activeCharacter
                  ? transactions
                  : transactions.filter((tx) => !tx.characterName || tx.characterName === activeCharacter)
              }
              onViewProfile={viewProfile}
            />
          )}
          {page === 'sniffer' && (
            <PacketSniffer packets={snifferLog} />
          )}
          {page === 'profile' && profileTarget && (
            <Profile
              playerName={profileTarget}
              onBack={() => setPage(profileReturnPage)}
            />
          )}
          {page === 'settings' && <Settings />}
          {page === 'about' && <About />}
        </main>
      </div>
    </div>
  );
}
