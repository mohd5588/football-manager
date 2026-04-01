import Dexie, { type Table } from 'dexie';
import type { SaveSlotRecord, SaveSlotMeta } from '../types';

/**
 * FootballManagerDB — The Save Game Database
 *
 * Plain English: Think of this like a filing cabinet built into the browser.
 * Every browser has a built-in storage system called "IndexedDB". It's powerful
 * but complicated to use directly. The "Dexie" library (which we installed)
 * makes it simple.
 *
 * Our cabinet has one drawer: "saves"
 * That drawer holds up to 5 folders (slots 0–4).
 * Each folder contains a complete snapshot of the entire game world.
 */

export class FootballManagerDB extends Dexie {
  // "!" tells TypeScript: "I promise this will be set up by Dexie, trust me"
  saves!: Table<SaveSlotRecord, number>;

  constructor() {
    super('FootballManagerDB'); // This is the name of the database in the browser

    this.version(1).stores({
      // 'slotIndex' is the primary key — like the label on each folder (0,1,2,3,4)
      // The other fields listed here are "indexed" — meaning we can search/sort by them quickly
      saves: 'slotIndex, saveName, savedAt, season',
    });
  }
}

// We create ONE shared instance of the database.
// Every other file in the project imports this single object — not the class above.
// This prevents accidentally opening the database twice.
export const db = new FootballManagerDB();

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions — the "receptionist" for the filing cabinet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all save slots that currently have data in them.
 * Returns only the "label" info (name, date, club) — not the full snapshot.
 * This is what populates the "Load Game" screen without loading everything.
 */
export async function listSaveSlots(): Promise<SaveSlotMeta[]> {
  const records = await db.saves.toArray();
  // Strip the heavy 'snapshot' field — we only need the metadata for the list
  return records.map(({ snapshot: _snapshot, ...meta }) => meta as SaveSlotMeta);
}

/**
 * Write a complete game snapshot to a specific slot.
 * If the slot already has data, this overwrites it.
 */
export async function writeSaveSlot(record: SaveSlotRecord): Promise<void> {
  await db.saves.put(record); // "put" = insert or overwrite
}

/**
 * Read a complete game snapshot from a specific slot.
 * Returns null if the slot is empty.
 */
export async function readSaveSlot(slotIndex: 0 | 1 | 2 | 3 | 4): Promise<SaveSlotRecord | null> {
  return (await db.saves.get(slotIndex)) ?? null;
}

/**
 * Delete a save slot entirely.
 */
export async function deleteSaveSlot(slotIndex: 0 | 1 | 2 | 3 | 4): Promise<void> {
  await db.saves.delete(slotIndex);
}
