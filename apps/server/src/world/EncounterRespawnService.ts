import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getEncounterDefinition } from "./encounterDefinitions";
import type { WorldService } from "./WorldService";

interface RespawnRow {
  location_id: string;
  encounter_id: string;
  respawn_at: Date;
}

interface EncounterLease {
  token: string;
  encounterId: string;
  locationId: string;
  respawnMs: number;
  respawnAt?: number;
  persisted: boolean;
  completion?: Promise<void>;
  retryAt?: number;
}

const PERSISTENCE_RETRY_MS = 5000;

/** Availability is authoritative here; clients only display the published deadline. */
export class EncounterRespawnService {
  readonly ready: Promise<void>;
  private loaded = false;
  private readonly encounters = new Map<string, EncounterLease>();
  private readonly leases = new Map<string, EncounterLease>();

  constructor(
    private readonly pool: Pool,
    private readonly world: WorldService,
    private readonly onChange: (locationId: string) => void,
    private readonly now: () => number = Date.now
  ) {
    this.ready = this.hydrate();
  }

  reserve(encounterId: string): string | undefined {
    if (!this.loaded) throw new Error("WORLD_LOADING");
    const definition = getEncounterDefinition(encounterId);
    if (!definition) throw new Error("ENCOUNTER_NOT_FOUND");
    if (!definition.respawnMs) return undefined;
    this.refresh();
    const current = this.encounters.get(encounterId);
    if (current) throw new Error(current.respawnAt === undefined ? "ENCOUNTER_BUSY" : "ENCOUNTER_RESPAWNING");
    const lease: EncounterLease = {
      token: randomUUID(), encounterId, locationId: definition.locationId,
      respawnMs: definition.respawnMs, persisted: false
    };
    this.encounters.set(encounterId, lease);
    this.leases.set(lease.token, lease);
    this.publish(lease, "engaged");
    return lease.token;
  }

  release(token: string): void {
    const lease = this.leases.get(token);
    // An old disconnect must never clear a completed spawn or its next lease.
    if (!lease || lease.respawnAt !== undefined || this.encounters.get(lease.encounterId) !== lease) return;
    this.encounters.delete(lease.encounterId);
    this.leases.delete(token);
    this.publish(lease, "alive");
  }

  finish(token: string | undefined, victory: boolean): Promise<void> {
    if (!token) return Promise.resolve();
    const lease = this.leases.get(token);
    if (!lease || this.encounters.get(lease.encounterId) !== lease) return Promise.resolve();
    if (lease.completion) return lease.completion;
    if (lease.persisted) return Promise.resolve();
    if (!victory) {
      this.release(token);
      return Promise.resolve();
    }
    if (lease.respawnAt === undefined) {
      lease.respawnAt = this.now() + lease.respawnMs;
      this.publish(lease, "respawning");
    }
    const completion = (async () => {
      try {
        await this.pool.query(
          `INSERT INTO encounter_respawns (location_id, encounter_id, respawn_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (location_id, encounter_id)
           DO UPDATE SET respawn_at = GREATEST(encounter_respawns.respawn_at, EXCLUDED.respawn_at)`,
          [lease.locationId, lease.encounterId, new Date(lease.respawnAt!)]
        );
        lease.persisted = true;
        delete lease.retryAt;
        this.refresh();
      } catch (error) {
        lease.retryAt = this.now() + PERSISTENCE_RETRY_MS;
        throw error;
      }
    })();
    lease.completion = completion;
    const forget = () => { if (lease.completion === completion) delete lease.completion; };
    void completion.then(forget, forget);
    return completion;
  }

  refresh(): void {
    const now = this.now();
    for (const lease of this.encounters.values()) {
      if (lease.respawnAt === undefined) continue;
      if (!lease.persisted) {
        // Retain the original deadline, retry without overlapping writes, and
        // keep the spawn unavailable until that deadline is durable.
        if (!lease.completion && lease.retryAt !== undefined && lease.retryAt <= now) {
          void this.finish(lease.token, true).catch(() => undefined);
        }
        continue;
      }
      if (lease.respawnAt > now) continue;
      this.encounters.delete(lease.encounterId);
      this.leases.delete(lease.token);
      this.publish(lease, "alive");
    }
  }

  dispose(): void {
    // Refresh scheduling belongs to the game server; this service owns no timers.
  }

  private async hydrate(): Promise<void> {
    const rows = await this.pool.query<RespawnRow>(
      "SELECT location_id, encounter_id, respawn_at FROM encounter_respawns"
    );
    const now = this.now();
    for (const row of rows.rows) {
      const definition = getEncounterDefinition(row.encounter_id);
      const deadline = new Date(row.respawn_at).getTime();
      if (!definition?.respawnMs || definition.locationId !== row.location_id || !Number.isFinite(deadline) || deadline <= now) continue;
      const lease: EncounterLease = {
        token: randomUUID(), encounterId: definition.id, locationId: definition.locationId,
        respawnMs: definition.respawnMs, respawnAt: deadline, persisted: true
      };
      this.encounters.set(lease.encounterId, lease);
      this.leases.set(lease.token, lease);
      this.publish(lease, "respawning");
    }
    this.loaded = true;
  }

  private publish(lease: EncounterLease, status: "alive" | "engaged" | "respawning"): void {
    this.world.setEncounterAvailability(lease.encounterId, {
      status, ...(status === "respawning" ? { respawnAt: lease.respawnAt! } : {})
    });
    this.onChange(lease.locationId);
  }
}
