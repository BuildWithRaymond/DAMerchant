import type { MerchantListing } from '../models/listing';

export const DEFAULT_GROUP_DESCRIPTION = 'Whisper "list" to see what\'s for sale';
export const LEGACY_GROUP_TITLE = 'Merchant';
export const LEGACY_GROUP_DESCRIPTION = "Check AislingExchange for listings or whisper 'whats for sale?'";

export function customGroupEnabled(setting: string, savedTitle: string, savedDescription: string): boolean {
  if (setting === 'true') return true;
  if (setting === 'false') return false;
  return (savedTitle !== '' && savedTitle !== LEGACY_GROUP_TITLE) ||
    (savedDescription !== '' && savedDescription !== LEGACY_GROUP_DESCRIPTION);
}

type GroupListing = Pick<MerchantListing, 'type' | 'status' | 'quantityRemaining'>;

export function automaticGroupTitle(listings: GroupListing[]): string {
  const activeTypes = new Set(
    listings.filter(l => l.status === 'ACTIVE' && l.quantityRemaining > 0).map(l => l.type),
  );
  const prefix = (['BUY', 'SELL', 'TRADE'] as const)
    .filter(type => activeTypes.has(type))
    .map(type => ({ BUY: 'B', SELL: 'S', TRADE: 'T' })[type])
    .join('/');
  return `${prefix || 'S'}> ITEMS`;
}

export function groupAppearance(
  listings: GroupListing[],
  customEnabled: boolean,
  customTitle: string,
  customDescription: string,
): { title: string; description: string } {
  return {
    title: customEnabled ? customTitle : automaticGroupTitle(listings),
    description: customEnabled ? customDescription : DEFAULT_GROUP_DESCRIPTION,
  };
}
