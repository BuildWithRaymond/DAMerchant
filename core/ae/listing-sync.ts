import { AeApiClient } from './ae-api-client';
import { ItemCache } from './item-cache';
import * as db from '../db/database';
import type { MerchantListing } from '../models/listing';

interface SyncQueueItem {
  id: number;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  localListingId: string;
  payload: string; // JSON
  attempts: number;
  lastAttempt: string | null;
  error: string | null;
}

export class ListingSync {
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly retryIntervalMs = 5 * 60_000;
  private readonly maxAttempts = 3;

  // Circuit breaker state
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private readonly circuitThreshold = 3;
  private readonly circuitCooldownMs = 60_000; // 1 minute

  constructor(
    private api: AeApiClient,
    private itemCache: ItemCache,
  ) {}

  private isCircuitOpen(): boolean {
    if (this.consecutiveFailures < this.circuitThreshold) return false;
    if (Date.now() >= this.circuitOpenUntil) {
      // Half-open: allow one probe request through
      return false;
    }
    return true;
  }

  private recordSuccess(): void {
    if (this.consecutiveFailures >= this.circuitThreshold) {
      console.log('[ListingSync] Circuit breaker CLOSED — AE reachable again');
    }
    this.consecutiveFailures = 0;
  }

  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.circuitThreshold) {
      this.circuitOpenUntil = Date.now() + this.circuitCooldownMs;
      console.warn(
        `[ListingSync] Circuit breaker OPEN — ${this.consecutiveFailures} consecutive failures, ` +
        `cooling down for ${this.circuitCooldownMs / 1000}s`
      );
    }
  }

  init(): void {
    // Process retry queue on startup, then every 5 minutes
    this.processRetryQueue();
    this.retryTimer = setInterval(() => this.processRetryQueue(), this.retryIntervalMs);

    // Also retry when auth state changes (user logs in)
    this.api.on('authChanged', (status: { loggedIn: boolean }) => {
      if (status.loggedIn) {
        setTimeout(() => this.processRetryQueue(), 2_000);
      }
    });
  }

  dispose(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ── Sync operations ───────────────────────────────────────

  async syncCreate(listing: MerchantListing): Promise<void> {
    if (!this.api.isLoggedIn()) return;
    if (listing.syncToAe === false) return;
    if (listing.status === 'PAUSED') return;

    const resolved = this.itemCache.resolveItemName(listing.itemName);

    const payload: any = {
      item_name: resolved?.canonical || listing.itemName,
      type: listing.type,
      price: listing.price || null,
      quantity: listing.type === 'TRADE' ? listing.quantityRemaining : listing.quantity,
      notes: listing.notes || null,
    };

    if (listing.wantedItems && listing.wantedItems.length > 0) {
      payload.wanted_items = JSON.stringify(listing.wantedItems.map(w => w.name).join(', '));
    }

    if (this.isCircuitOpen()) {
      this.enqueue('CREATE', listing.id, payload);
      return;
    }

    try {
      const result = await this.api.post<{ data: { id: string; item_id: string } }>('/listings', payload);
      if (result.data?.data) {
        db.setAeListingMap(listing.id, result.data.data.id, result.data.data.item_id || null);
        console.log(`[ListingSync] Created AE listing ${result.data.data.id} for local ${listing.id}`);
        this.recordSuccess();
        return;
      }
      // Queue for retry if it's a transient error
      if (result.error && this.isTransient(result.error)) {
        this.recordFailure();
        this.enqueue('CREATE', listing.id, payload);
      } else {
        console.warn(`[ListingSync] Create failed (non-retryable):`, result.error);
      }
    } catch (err: any) {
      console.error('[ListingSync] Create error:', err.message);
      this.recordFailure();
      this.enqueue('CREATE', listing.id, payload);
    }
  }

  async syncUpdate(listing: MerchantListing): Promise<void> {
    if (!this.api.isLoggedIn()) return;
    if (listing.syncToAe === false) return;

    const map = db.getAeListingMap(listing.id);
    if (!map) return; // Never synced — nothing to update on AE

    // Map local status to AE status
    let aeStatus: string | undefined;
    if (listing.status === 'SOLD_OUT') aeStatus = 'SOLD';
    if (listing.status === 'PAUSED') {
      // AE doesn't have PAUSED — archive the listing
      await this.syncDelete(listing.id);
      return;
    }

    const payload: any = {
      price: listing.price || null,
      quantity: listing.type === 'TRADE' ? listing.quantityRemaining : listing.quantity,
      notes: listing.notes || null,
    };
    if (aeStatus) payload.status = aeStatus;

    if (this.isCircuitOpen()) {
      this.enqueue('UPDATE', listing.id, { aeId: map.aeId, ...payload });
      return;
    }

    try {
      const result = await this.api.patch(`/listings/${map.aeId}`, payload);
      if (!result.error) {
        db.setAeListingMap(listing.id, map.aeId, map.aeItemId);
        console.log(`[ListingSync] Updated AE listing ${map.aeId}`);
        this.recordSuccess();
        return;
      }
      if (this.isTransient(result.error)) {
        this.recordFailure();
        this.enqueue('UPDATE', listing.id, { aeId: map.aeId, ...payload });
      }
    } catch (err: any) {
      console.error('[ListingSync] Update error:', err.message);
      this.recordFailure();
      this.enqueue('UPDATE', listing.id, { aeId: map.aeId, ...payload });
    }
  }

  async syncDelete(localListingId: string): Promise<void> {
    if (!this.api.isLoggedIn()) return;

    const map = db.getAeListingMap(localListingId);
    if (!map) return;

    if (this.isCircuitOpen()) {
      this.enqueue('DELETE', localListingId, { aeId: map.aeId });
      return;
    }

    try {
      const result = await this.api.del(`/listings/${map.aeId}`);
      if (!result.error) {
        db.deleteAeListingMap(localListingId);
        console.log(`[ListingSync] Deleted AE listing ${map.aeId}`);
        this.recordSuccess();
        return;
      }
      if (this.isTransient(result.error)) {
        this.recordFailure();
        this.enqueue('DELETE', localListingId, { aeId: map.aeId });
      }
    } catch (err: any) {
      console.error('[ListingSync] Delete error:', err.message);
      this.recordFailure();
      this.enqueue('DELETE', localListingId, { aeId: map.aeId });
    }
  }

  /** Sync a completed transaction as a price entry on AE. */
  async syncTransaction(tx: { itemName: string; type: string; price: number; quantity: number }): Promise<void> {
    if (!this.api.isLoggedIn()) return;

    const resolved = this.itemCache.resolveItemName(tx.itemName);
    if (!resolved) return; // Can't create price entry without known item

    try {
      await this.api.post('/listings', {
        item_name: resolved.canonical,
        type: tx.type,
        price: tx.price || null,
        quantity: tx.quantity || 1,
        notes: 'Auto-recorded from DAMerchant trade',
      });
    } catch (err: any) {
      console.error('[ListingSync] Transaction sync error:', err.message);
    }
  }

  // ── Sync status ───────────────────────────────────────────

  getSyncStatus(localListingId: string): 'synced' | 'pending' | 'failed' | 'not_synced' {
    if (!this.api.isLoggedIn()) return 'not_synced';

    const map = db.getAeListingMap(localListingId);
    if (map) return 'synced';

    const queued = db.getAeSyncQueueItem(localListingId);
    if (queued) {
      return queued.attempts >= this.maxAttempts ? 'failed' : 'pending';
    }

    return 'not_synced';
  }

  getSyncStatuses(ids: string[]): Record<string, 'synced' | 'pending' | 'failed' | 'not_synced'> {
    const result: Record<string, string> = {};
    for (const id of ids) {
      result[id] = this.getSyncStatus(id);
    }
    return result as any;
  }

  /** Manually retry a specific listing or all pending items. */
  async retrySync(localListingId?: string): Promise<void> {
    if (localListingId) {
      // Reset attempts for this item so it gets retried
      db.resetAeSyncQueueItem(localListingId);
    }
    await this.processRetryQueue();
  }

  // ── Queue management ──────────────────────────────────────

  private enqueue(operation: 'CREATE' | 'UPDATE' | 'DELETE', localListingId: string, payload: any): void {
    db.enqueueAeSync(operation, localListingId, JSON.stringify(payload));
    console.log(`[ListingSync] Queued ${operation} for ${localListingId}`);
  }

  private async processRetryQueue(): Promise<void> {
    if (!this.api.isLoggedIn()) return;
    if (this.isCircuitOpen()) return;

    const queue = db.getAeSyncQueue();
    for (const item of queue) {
      if (item.attempts >= this.maxAttempts) continue;

      // Exponential backoff: 1min, 4min, 16min based on attempt count
      const backoffMs = Math.pow(4, item.attempts) * 60_000;
      const lastAttempt = item.lastAttempt ? new Date(item.lastAttempt).getTime() : 0;
      if (lastAttempt && Date.now() - lastAttempt < backoffMs) continue;

      // Stop processing if circuit opened during this batch
      if (this.isCircuitOpen()) break;

      const payload = JSON.parse(item.payload);
      let success = false;

      try {
        switch (item.operation) {
          case 'CREATE': {
            const result = await this.api.post<{ data: { id: string; item_id: string } }>('/listings', payload);
            if (result.data?.data) {
              db.setAeListingMap(item.localListingId, result.data.data.id, result.data.data.item_id || null);
              success = true;
            }
            break;
          }
          case 'UPDATE': {
            const { aeId, ...updatePayload } = payload;
            const result = await this.api.patch(`/listings/${aeId}`, updatePayload);
            success = !result.error;
            break;
          }
          case 'DELETE': {
            const result = await this.api.del(`/listings/${payload.aeId}`);
            if (!result.error) {
              db.deleteAeListingMap(item.localListingId);
              success = true;
            }
            break;
          }
        }
      } catch (err: any) {
        console.error(`[ListingSync] Retry ${item.operation} failed:`, err.message);
      }

      if (success) {
        db.removeAeSyncQueueItem(item.id);
        this.recordSuccess();
      } else {
        db.bumpAeSyncQueueAttempt(item.id);
        this.recordFailure();
      }
    }
  }

  private isTransient(error: string): boolean {
    const transient = ['timed out', 'network error', 'rate limit', 'HTTP 5'];
    return transient.some(t => error.toLowerCase().includes(t.toLowerCase()));
  }
}
