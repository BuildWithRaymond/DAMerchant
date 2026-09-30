import { useEffect, useState } from 'react';
import { Download, Receipt, ArrowLeftRight, ArrowRight, User, Coins } from 'lucide-react';
import { getSpriteDataUrl } from '../lib/ae-api';

interface Transaction {
  id: string;
  listingId: string;
  characterName?: string;
  counterpartyName: string;
  type: 'BUY' | 'SELL' | 'TRADE';
  itemsGiven: { name: string; quantity: number }[];
  itemsReceived: { name: string; quantity: number }[];
  goldGiven: number;
  goldReceived: number;
  status: string;
  reason?: string;
  timestamp: string;
}

interface Props {
  transactions: Transaction[];
  onViewProfile?: (name: string) => void;
}

export default function TransactionLog({ transactions, onViewProfile }: Props) {
  function exportCsv() {
    const header = 'Time,Type,Character,Counterparty,Items Given,Items Received,Gold Given,Gold Received,Status\n';
    const rows = transactions.map((tx) =>
      [
        tx.timestamp,
        tx.type,
        tx.characterName || '',
        tx.counterpartyName,
        tx.itemsGiven.map((i) => `${i.name} x${i.quantity}`).join('; '),
        tx.itemsReceived.map((i) => `${i.name} x${i.quantity}`).join('; '),
        tx.goldGiven,
        tx.goldReceived,
        tx.status,
      ].join(','),
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `damerchant-transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col h-full space-y-5">
      {/* Hero */}
      <div className="page-hero animate-fade-in">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="page-hero-icon">
            <ArrowLeftRight size={22} style={{ color: 'var(--color-gold-400)' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 className="page-hero-title">History</h1>
            <p className="page-hero-subtitle">
              {transactions.length} {transactions.length === 1 ? 'trade' : 'trades'} recorded
            </p>
          </div>
          {transactions.length > 0 && (
            <button
              onClick={exportCsv}
              className="btn-secondary px-4 py-2 rounded-lg text-sm"
            >
              <Download size={14} />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {transactions.length === 0 && (
        <div className="empty-state section-card animate-slide-up" style={{ animationDelay: '80ms', flex: 1 }}>
          <div className="empty-state-icon">
            <Receipt size={24} style={{ color: 'var(--color-text-tertiary)' }} />
          </div>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
            No transactions yet
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            Completed trades will appear here
          </p>
        </div>
      )}

      <div className="space-y-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden animate-slide-up" style={{ animationDelay: '80ms' }}>
        {transactions.map((tx, i) => (
          <TransactionCard key={tx.id} tx={tx} index={i} onViewProfile={onViewProfile} />
        ))}
      </div>
    </div>
  );
}

function TransactionCard({ tx, index, onViewProfile }: { tx: Transaction; index: number; onViewProfile?: (name: string) => void }) {
  const myName = tx.characterName || 'You';
  const theirName = tx.counterpartyName;

  // From your character's perspective:
  // itemsGiven + goldGiven = what you gave
  // itemsReceived + goldReceived = what you got
  const youGaveItems = tx.itemsGiven;
  const youGaveGold = tx.goldGiven;
  const youGotItems = tx.itemsReceived;
  const youGotGold = tx.goldReceived;

  return (
    <div
      className="card-inset tx-row"
      style={{ padding: '14px 16px', animationDelay: `${80 + index * 30}ms` }}
    >
      {/* Top row: type badge + timestamp + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span
          className="badge shrink-0"
          style={{
            background: tx.type === 'SELL' ? '#22c55e20' : tx.type === 'BUY' ? '#3b82f620' : '#f59e0b20',
            color: tx.type === 'SELL' ? 'var(--color-success)' : tx.type === 'BUY' ? '#60a5fa' : 'var(--color-warning)',
          }}
        >
          {tx.type}
        </span>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {new Date(tx.timestamp).toLocaleString()}
        </span>
        <span
          className="badge shrink-0"
          style={{
            background: tx.status === 'COMPLETED' ? '#22c55e20' : '#f8717120',
            color: tx.status === 'COMPLETED' ? 'var(--color-success)' : 'var(--color-danger)',
          }}
        >
          {tx.status}
        </span>
      </div>

      {/* Trade flow: [Your char] gave X -> [Their char] gave Y */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Your character side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlayerBadge name={myName} />
          <div style={{ marginTop: 6 }}>
            <TradeItems label="Gave" items={youGaveItems} gold={youGaveGold} color="var(--color-danger)" />
            <TradeItems label="Got" items={youGotItems} gold={youGotGold} color="var(--color-success)" />
          </div>
        </div>

        {/* Arrow */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          flexShrink: 0,
          padding: '0 4px',
        }}>
          <ArrowLeftRight size={18} style={{ color: 'var(--color-gold-400)', opacity: 0.6 }} />
        </div>

        {/* Counterparty side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <PlayerBadge name={theirName} onClick={onViewProfile ? () => onViewProfile(theirName) : undefined} />
          <div style={{ marginTop: 6 }}>
            <TradeItems label="Gave" items={youGotItems} gold={youGotGold} color="var(--color-danger)" />
            <TradeItems label="Got" items={youGaveItems} gold={youGaveGold} color="var(--color-success)" />
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerBadge({ name, onClick }: { name: string; onClick?: () => void }) {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);

  useEffect(() => {
    getSpriteDataUrl(name).then(setSpriteUrl);
  }, [name]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <AvatarCircle spriteUrl={spriteUrl} size={28} />
      <span
        style={{
          fontSize: 13, fontWeight: 600,
          color: onClick ? 'var(--color-gold-400)' : 'var(--color-text-primary)',
          cursor: onClick ? 'pointer' : undefined,
        }}
        onClick={onClick}
      >
        {name}
      </span>
    </div>
  );
}

function AvatarCircle({ spriteUrl, size = 28 }: { spriteUrl: string | null; size?: number }) {
  if (!spriteUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full flex items-center justify-center"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.05))',
          border: '1px solid rgba(201,168,76,0.2)',
        }}
      >
        <User size={Math.round(size * 0.5)} style={{ color: 'var(--color-gold-600)', opacity: 0.7 }} />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 rounded-full overflow-hidden character-portrait"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${spriteUrl})`,
        border: '1px solid rgba(201,168,76,0.3)',
      }}
    />
  );
}

function TradeItems({ label, items, gold, color }: {
  label: string;
  items: { name: string; quantity: number }[];
  gold: number;
  color: string;
}) {
  const hasItems = items.length > 0;
  const hasGold = gold > 0;
  if (!hasItems && !hasGold) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.04em', flexShrink: 0 }}>
        {label}:
      </span>
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {hasItems && formatItemList(items)}
        {hasItems && hasGold && ' + '}
        {hasGold && formatGold(gold) + ' gold'}
      </span>
    </div>
  );
}

function formatItemList(items: { name: string; quantity: number }[]): string {
  return items.map((i) => i.quantity > 1 ? `${i.quantity}x ${i.name}` : i.name).join(', ');
}

function formatGold(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString();
}
