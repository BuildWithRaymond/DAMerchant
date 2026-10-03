import { useState, useEffect, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';

interface ReconnectStatus {
  characterName: string;
  attempt: number;
  state: string;
  delay: number;
}

export default function ReconnectBanner() {
  const [entries, setEntries] = useState<ReconnectStatus[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const countdownRefs = useRef<Map<string, number>>(new Map());
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const api = window.merchantMode;
    if (!api?.reconnect) return;

    // Load initial state
    api.reconnect.getState().then((state) => {
      for (const entry of state) {
        if (entry.state === 'waiting' && entry.delay > 0) countdownRefs.current.set(entry.characterName, Date.now() + entry.delay);
      }
      if (state.length > 0) setEntries(state);
    });

    api.reconnect.onStatus((data) => {
      setEntries((prev) => {
        if (data.state === 'connected' || data.state === 'cancelled') {
          return prev.filter((e) => e.characterName !== data.characterName);
        }
        const existing = prev.findIndex((e) => e.characterName === data.characterName);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = data;
          return next;
        }
        return [...prev, data];
      });

      // Update countdown for 'waiting' state
      if (data.state === 'waiting' && data.delay > 0) {
        countdownRefs.current.set(data.characterName, Date.now() + data.delay);
      } else {
        countdownRefs.current.delete(data.characterName);
      }

      // Un-dismiss if reconnecting again
      if (data.state === 'waiting' || data.state === 'launching') {
        setDismissed((prev) => {
          if (!prev.has(data.characterName)) return prev;
          const next = new Set(prev);
          next.delete(data.characterName);
          return next;
        });
      }
    });
  }, []);

  // Countdown tick
  useEffect(() => {
    if (entries.length === 0) return;
    const interval = setInterval(() => forceUpdate((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [entries.length]);

  const visibleEntries = entries.filter((e) => !dismissed.has(e.characterName));
  if (visibleEntries.length === 0) return null;

  return (
    <>
      {visibleEntries.map((entry) => {
        const targetTime = countdownRefs.current.get(entry.characterName);
        const secondsLeft = targetTime ? Math.max(0, Math.ceil((targetTime - Date.now()) / 1000)) : 0;

        return (
          <div
            key={entry.characterName}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 16px',
              fontSize: 13,
              background: 'linear-gradient(90deg, rgba(251,191,36,0.12), rgba(251,191,36,0.04))',
              borderBottom: '1px solid var(--color-surface-500)',
            }}
          >
            <RefreshCw
              size={14}
              className={entry.state === 'launching' ? 'animate-spin' : ''}
              style={{ color: '#fbbf24', flexShrink: 0 }}
            />

            <span style={{ color: 'var(--color-text-primary)', flex: 1 }}>
              {entry.state === 'queued' && (
                <>Queued to reconnect <strong>{entry.characterName}</strong>...</>
              )}
              {entry.state === 'waiting' && (
                <>Reconnecting <strong>{entry.characterName}</strong> — attempt {entry.attempt} in {secondsLeft}s...</>
              )}
              {entry.state === 'launching' && (
                <>Launching <strong>{entry.characterName}</strong> — attempt {entry.attempt}...</>
              )}
              {entry.state === 'failed' && (
                <>Reconnect failed for <strong>{entry.characterName}</strong> — retrying...</>
              )}
            </span>

            <button
              onClick={() => window.merchantMode?.reconnect.cancel(entry.characterName)}
              className="btn-secondary"
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              Cancel
            </button>

            <button
              onClick={() => setDismissed((prev) => new Set(prev).add(entry.characterName))}
              style={{
                padding: 4,
                borderRadius: 4,
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-tertiary)',
                cursor: 'pointer',
                transition: 'color 200ms ease',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </>
  );
}
