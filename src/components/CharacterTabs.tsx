import { useEffect, useState } from 'react';
import { Users, User } from 'lucide-react';
import { getSpriteDataUrl } from '../lib/ae-api';

interface Props {
  characters: string[];
  activeCharacter: string | null;
  onSelect: (name: string) => void;
  characterStates: Record<string, string>;
  characterTypes: Record<string, 'launched' | 'bot'>;
  onSelectAll: () => void;
  isAllSelected: boolean;
  allMerchantsCount: number;
  hideAllMerchants?: boolean;
}

function CharacterFace({ name }: { name: string }) {
  const [spriteUrl, setSpriteUrl] = useState<string | null>(null);

  useEffect(() => {
    getSpriteDataUrl(name).then(setSpriteUrl);
  }, [name]);

  if (!spriteUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-sm flex items-center justify-center overflow-hidden"
        style={{
          width: 18,
          height: 18,
          background: 'linear-gradient(135deg, rgba(201,168,76,0.12), rgba(201,168,76,0.04))',
          border: '1px solid rgba(201,168,76,0.15)',
        }}
      >
        <User size={10} style={{ color: 'var(--color-gold-600)', opacity: 0.7 }} />
      </div>
    );
  }

  return (
    <div
      className="flex-shrink-0 rounded-sm overflow-hidden character-portrait"
      style={{
        width: 18,
        height: 18,
        backgroundImage: `url(${spriteUrl})`,
        border: '1px solid rgba(201,168,76,0.2)',
      }}
    />
  );
}

export default function CharacterTabs({ characters, activeCharacter, onSelect, characterStates, characterTypes, onSelectAll, isAllSelected, allMerchantsCount, hideAllMerchants }: Props) {
  return (
    <div
      className="flex"
      style={{
        borderBottom: '1px solid var(--color-surface-500)',
        background: 'linear-gradient(180deg, var(--color-surface-200), var(--color-surface-200))',
      }}
    >
      {characters.map((name) => {
        const isActive = !isAllSelected && name === activeCharacter;
        const state = characterStates[name] ?? 'IDLE';
        const isBusy = state !== 'IDLE';
        const isBot = characterTypes[name] === 'bot';

        return (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className="tab-btn"
            style={{
              background: isActive ? 'var(--color-surface-100)' : 'transparent',
              color: isActive ? 'var(--color-gold-400)' : 'var(--color-text-secondary)',
              fontWeight: isActive ? 600 : 400,
              borderBottom: isActive ? '2px solid var(--color-gold-400)' : '2px solid transparent',
              boxShadow: isActive ? '0 2px 8px var(--color-gold-glow)' : 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'var(--color-surface-300)';
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
            <CharacterFace name={name} />
            {name}
            {isBot && (
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 6px',
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  borderRadius: 4,
                  background: 'var(--color-surface-500)',
                  color: 'var(--color-text-tertiary)',
                  lineHeight: 1,
                }}
              >
                BOT
              </span>
            )}
            {isBusy && (
              <span
                style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--color-warning)',
                  animation: 'pulse-gold 2s infinite',
                  boxShadow: '0 0 6px rgba(251,191,36,0.4)',
                }}
                title={state}
              />
            )}
          </button>
        );
      })}
      {!hideAllMerchants && <button
        onClick={onSelectAll}
        className="tab-btn"
        style={{
          background: isAllSelected ? 'var(--color-surface-100)' : 'transparent',
          color: isAllSelected ? 'var(--color-gold-400)' : 'var(--color-text-secondary)',
          fontWeight: isAllSelected ? 600 : 400,
          borderBottom: isAllSelected ? '2px solid var(--color-gold-400)' : '2px solid transparent',
          boxShadow: isAllSelected ? '0 2px 8px var(--color-gold-glow)' : 'none',
        }}
        onMouseEnter={(e) => {
          if (!isAllSelected) {
            e.currentTarget.style.background = 'var(--color-surface-300)';
            e.currentTarget.style.color = 'var(--color-text-primary)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isAllSelected) {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }
        }}
      >
        <Users size={14} />
        All Merchants
        {allMerchantsCount > 0 && (
          <span
            style={{
              display: 'inline-block',
              padding: '2px 7px',
              fontSize: 10,
              fontWeight: 600,
              borderRadius: 10,
              background: 'rgba(201,168,76,0.15)',
              color: 'var(--color-gold-300)',
              lineHeight: 1,
              border: '1px solid rgba(201,168,76,0.2)',
            }}
          >
            {allMerchantsCount}
          </span>
        )}
      </button>}
    </div>
  );
}
