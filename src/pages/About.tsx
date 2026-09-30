import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Check, Download, AlertCircle, ExternalLink, Heart, Code, Swords, Globe, Shield, ArrowRight } from 'lucide-react';

type UpdateCheckState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error';

/* ── Curated item sprite IDs for visual flair ────────── */
const HERO_ITEMS = [1, 5, 10, 15, 20, 25, 30, 35, 100, 105, 110, 200, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1001, 1005, 1010, 1020, 1032, 1040, 1050];
const FEATURE_ICONS = { trade: 1000, market: 1005, multi: 1020, log: 1032 };

function FloatingItems() {
  const items = useMemo(() => {
    return HERO_ITEMS.map((id, i) => {
      const size = 28 + Math.random() * 20;
      const left = (i / HERO_ITEMS.length) * 100;
      const top = Math.random() * 100;
      const delay = Math.random() * 8;
      const duration = 12 + Math.random() * 10;
      const opacity = 0.08 + Math.random() * 0.12;
      return { id, size, left, top, delay, duration, opacity };
    });
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {items.map((item, i) => (
        <img
          key={i}
          src={`items/${item.id}.png`}
          alt=""
          style={{
            position: 'absolute',
            width: item.size,
            height: item.size,
            left: `${item.left}%`,
            top: `${item.top}%`,
            opacity: item.opacity,
            imageRendering: 'pixelated',
            filter: 'sepia(1) hue-rotate(-10deg) saturate(0.6) brightness(1.2)',
            animation: `aboutFloat ${item.duration}s ease-in-out ${item.delay}s infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

function ItemIcon({ id, size = 32 }: { id: number; size?: number }) {
  return (
    <div
      style={{
        width: size + 12,
        height: size + 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.05))',
        border: '1px solid rgba(201,168,76,0.2)',
        flexShrink: 0,
      }}
    >
      <img
        src={`items/${id}.png`}
        alt=""
        style={{ width: size, height: size, imageRendering: 'pixelated' }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    </div>
  );
}

export default function About() {
  const [checkState, setCheckState] = useState<UpdateCheckState>('idle');
  const [version, setVersion] = useState('');
  const [updateVersion, setUpdateVersion] = useState('');
  const [percent, setPercent] = useState(0);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(true);

  useEffect(() => {
    window.merchantMode?.updater.getVersion().then(setVersion);
    window.merchantMode?.settings.get('auto_update_enabled', 'true').then((v) => setAutoUpdateEnabled(v === 'true'));
    window.merchantMode?.updater.onStatus((data) => {
      setCheckState(data.status as UpdateCheckState);
      if (data.version) setUpdateVersion(data.version);
      if (data.percent != null) setPercent(data.percent);
    });
  }, []);

  const handleCheck = () => {
    setCheckState('checking');
    window.merchantMode?.updater.check();
  };

  const handleDownload = () => {
    window.merchantMode?.updater.download();
  };

  const features = [
    { icon: FEATURE_ICONS.trade, label: 'Auto Trading', desc: 'Hands-free exchange handling via whisper commands' },
    { icon: FEATURE_ICONS.market, label: 'Smart Listings', desc: 'Buy, sell, and trade listings with price shorthand' },
    { icon: FEATURE_ICONS.multi, label: 'Multi-Character', desc: 'Run multiple merchants simultaneously' },
    { icon: FEATURE_ICONS.log, label: 'Transaction Log', desc: 'Full audit trail of every trade completed' },
  ];

  const credits = [
    { name: 'SiLo', role: 'Protocol research & open-source tooling' },
    { name: 'Ramanayan', role: 'Community contributions' },
    { name: 'Vamistle', role: 'Original concept & inspiration' },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100%' }}>
      {/* CSS for animations */}
      <style>{`
        @keyframes aboutFloat {
          0% { transform: translateY(0px) rotate(0deg); }
          100% { transform: translateY(-20px) rotate(8deg); }
        }
        @keyframes aboutGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes aboutSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes aboutPulseRing {
          0% { box-shadow: 0 0 0 0 rgba(201,168,76,0.3); }
          70% { box-shadow: 0 0 0 8px rgba(201,168,76,0); }
          100% { box-shadow: 0 0 0 0 rgba(201,168,76,0); }
        }
        .about-feature-card {
          transition: transform 200ms ease, border-color 200ms ease, box-shadow 200ms ease;
        }
        .about-feature-card:hover {
          transform: translateY(-2px);
          border-color: rgba(201,168,76,0.4) !important;
          box-shadow: 0 8px 32px rgba(201,168,76,0.12) !important;
        }
        .about-credit-chip {
          transition: all 200ms ease;
        }
        .about-credit-chip:hover {
          background: rgba(201,168,76,0.12) !important;
          border-color: rgba(201,168,76,0.35) !important;
        }
        .about-link {
          transition: color 150ms ease;
        }
        .about-link:hover {
          color: #dbb85e !important;
        }
      `}</style>

      <FloatingItems />

      <div style={{ position: 'relative', zIndex: 1 }} className="space-y-6">

        {/* ── Hero Section ──────────────────────────────── */}
        <div
          className="animate-fade-in"
          style={{
            padding: '32px 28px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, rgba(26,26,36,0.95) 0%, rgba(34,34,51,0.85) 50%, rgba(26,26,36,0.95) 100%)',
            border: '1px solid var(--color-surface-500)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Top gold accent line */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'linear-gradient(90deg, transparent, var(--color-gold-400), transparent)',
          }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Logo cluster */}
            <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
              <div style={{
                width: 72,
                height: 72,
                borderRadius: 16,
                background: 'linear-gradient(135deg, rgba(201,168,76,0.2), rgba(201,168,76,0.05))',
                border: '1px solid rgba(201,168,76,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                animation: 'aboutPulseRing 3s ease-in-out infinite',
              }}>
                <Swords size={32} style={{ color: 'var(--color-gold-400)' }} />
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <h1 style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 700,
                background: 'linear-gradient(135deg, #dbb85e, #f0d078, #c9a84c)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '-0.02em',
              }}>
                DAMerchant
              </h1>
              <p style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
                maxWidth: 480,
              }}>
                AFK trade automation for Dark Ages. Set up your listings, walk away, and let your merchants handle the rest.
              </p>
            </div>

            {/* Version badge */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
            }}>
              <div style={{
                padding: '5px 14px',
                borderRadius: 20,
                background: 'rgba(201,168,76,0.1)',
                border: '1px solid rgba(201,168,76,0.25)',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-gold-300)',
                letterSpacing: '0.02em',
              }}>
                v{version || '...'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Update Card ──────────────────────────────── */}
        <div
          className="animate-fade-in"
          style={{
            padding: '14px 20px',
            borderRadius: 10,
            background: 'var(--color-surface-300)',
            border: '1px solid var(--color-surface-500)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            animationDelay: '50ms',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background:
                checkState === 'up-to-date' ? 'var(--color-success)' :
                checkState === 'error' ? 'var(--color-danger)' :
                checkState === 'ready' ? '#22c55e' :
                'var(--color-gold-400)',
              boxShadow:
                checkState === 'up-to-date' ? '0 0 8px rgba(74,222,128,0.4)' :
                checkState === 'error' ? '0 0 8px rgba(248,113,113,0.4)' :
                '0 0 8px rgba(201,168,76,0.3)',
            }} />
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {checkState === 'checking' ? 'Checking for updates...' :
                 checkState === 'up-to-date' ? 'Up to date' :
                 checkState === 'available' ? `Update v${updateVersion} found` :
                 checkState === 'downloading' ? `Downloading... ${percent}%` :
                 checkState === 'ready' ? `v${updateVersion} ready to install` :
                 checkState === 'error' ? 'Update check failed' :
                 'Software Updates'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {checkState === 'idle' && 'Check for the latest version'}
                {checkState === 'up-to-date' && 'You are running the latest version'}
                {checkState === 'downloading' && 'Download in progress...'}
                {checkState === 'ready' && 'Restart to apply the update'}
              </p>
            </div>
          </div>

          {checkState === 'ready' ? (
            <button
              onClick={() => window.merchantMode?.updater.install()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #4ade80, #22c55e)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 200ms ease',
              }}
            >
              <Download size={13} />
              Restart & Update
            </button>
          ) : checkState === 'available' && !autoUpdateEnabled ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleDownload}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #dbb85e, #b8973e)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 200ms ease',
                }}
              >
                <Download size={13} />
                Download Update
              </button>
            </div>
          ) : (
            <button
              onClick={handleCheck}
              disabled={checkState === 'checking' || checkState === 'downloading'}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 16px',
                borderRadius: 8,
                border: '1px solid var(--color-surface-600)',
                background: 'var(--color-surface-400)',
                color: 'var(--color-text-primary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: checkState === 'checking' || checkState === 'downloading' ? 'not-allowed' : 'pointer',
                opacity: checkState === 'checking' || checkState === 'downloading' ? 0.6 : 1,
                transition: 'all 200ms ease',
              }}
            >
              {checkState === 'checking' ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : checkState === 'up-to-date' ? (
                <Check size={13} style={{ color: 'var(--color-success)' }} />
              ) : checkState === 'error' ? (
                <AlertCircle size={13} style={{ color: 'var(--color-danger)' }} />
              ) : (
                <RefreshCw size={13} />
              )}
              Check for Updates
            </button>
          )}
        </div>

        {/* ── Features Grid ────────────────────────────── */}
        <div>
          <p className="stat-label" style={{ marginBottom: 10, paddingLeft: 2 }}>Key Features</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {features.map((f, i) => (
              <div
                key={f.label}
                className="about-feature-card"
                style={{
                  padding: '18px 16px',
                  borderRadius: 10,
                  background: 'var(--color-surface-300)',
                  border: '1px solid var(--color-surface-500)',
                  animation: `aboutSlideUp 400ms ease ${100 + i * 60}ms both`,
                }}
              >
                <ItemIcon id={f.icon} size={28} />
                <h4 style={{
                  margin: '12px 0 4px',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}>
                  {f.label}
                </h4>
                <p style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--color-text-tertiary)',
                  lineHeight: 1.5,
                }}>
                  {f.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Two-Column: Description + AislingExchange ─ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>

          {/* How It Works */}
          <div
            style={{
              padding: '22px 24px',
              borderRadius: 10,
              background: 'var(--color-surface-300)',
              border: '1px solid var(--color-surface-500)',
              animation: 'aboutSlideUp 400ms ease 300ms both',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Shield size={16} style={{ color: 'var(--color-gold-400)' }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">How It Works</h3>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
              DAMerchant acts as a local proxy between your game client and the server, intercepting trade-related packets so you can set up buy and sell listings and walk away.
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
              When another player whispers your character with a matching request, the tool automatically handles the exchange window, places the items or gold, and completes the trade on your behalf — supporting stackable items, price shorthand, and real-time inventory tracking.
            </p>
          </div>

          {/* AislingExchange */}
          <div
            style={{
              padding: '22px 24px',
              borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(26,26,36,0.95), rgba(34,34,51,0.8))',
              border: '1px solid var(--color-surface-500)',
              animation: 'aboutSlideUp 400ms ease 360ms both',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Subtle corner glow */}
            <div style={{
              position: 'absolute',
              top: -40,
              right: -40,
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(201,168,76,0.08) 0%, transparent 70%)',
              pointerEvents: 'none',
            }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, position: 'relative' }}>
              <Globe size={16} style={{ color: 'var(--color-gold-400)' }} />
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">AislingExchange.com</h3>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7, position: 'relative' }}>
              A community-driven marketplace and resource hub for Dark Ages. Browse, list, and search items across the game's economy — bringing price discovery to a trade system built on whispers and word of mouth.
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7, position: 'relative' }}>
              DAMerchant is designed to work hand-in-hand with the exchange, bridging the gap between online listings and in-game trades.
            </p>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                window.merchantMode?.shell?.openExternal?.('https://aislingexchange.com');
              }}
              className="about-link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-gold-400)',
                textDecoration: 'none',
                position: 'relative',
              }}
            >
              Visit AislingExchange
              <ExternalLink size={12} />
            </a>
          </div>
        </div>

        {/* ── Credits ──────────────────────────────────── */}
        <div style={{
          padding: '22px 24px',
          borderRadius: 10,
          background: 'var(--color-surface-300)',
          border: '1px solid var(--color-surface-500)',
          animation: 'aboutSlideUp 400ms ease 420ms both',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Heart size={16} style={{ color: 'var(--color-gold-400)' }} />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }} className="gold-text">Credits & Acknowledgments</h3>
          </div>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6 }}>
            Built by <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>Lancelot</span> — a long-time Dark Ages player focused on building tools that improve quality of life for the community.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {credits.map((c, i) => (
              <div
                key={c.name}
                className="about-credit-chip"
                style={{
                  padding: '12px 14px',
                  borderRadius: 8,
                  background: 'var(--color-surface-200)',
                  border: '1px solid var(--color-surface-500)',
                }}
              >
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--color-gold-300)' }}>{c.name}</p>
                <p style={{ margin: '3px 0 0', fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>{c.role}</p>
              </div>
            ))}
          </div>

          <p style={{ margin: '14px 0 0', fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.6, fontStyle: 'italic' }}>
            Above all, it's SiLo's dedication to the community and commitment to open source that deserves the real thanks — without his work, none of these tools would exist.
          </p>
        </div>

        {/* ── Footer ───────────────────────────────────── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: '8px 0 4px',
          animation: 'aboutSlideUp 400ms ease 480ms both',
        }}>
          <Code size={12} style={{ color: 'var(--color-text-tertiary)' }} />
          <p style={{ margin: 0, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            Made with care for the Dark Ages community
          </p>
        </div>
      </div>
    </div>
  );
}
