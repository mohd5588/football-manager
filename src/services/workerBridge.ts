/**
 * src/services/workerBridge.ts
 *
 * THE ONLY place in the app that talks to the Web Worker directly.
 *
 * Responsibilities:
 *   1. Boot the worker using Vite's ES-module worker syntax.
 *   2. Assign every outgoing action a unique `jobId` so responses can be
 *      matched back to their caller (correlation pattern).
 *   3. Expose a Promise-based `send()` API so callers can await results.
 *   4. Route streaming PROGRESS_REPORT messages to an optional per-job
 *      progress callback without resolving the parent Promise early.
 *   5. Route SYNC_STATE messages to a globally registered handler so
 *      Zustand stays up-to-date whenever the worker pushes state.
 *
 * IMPORTANT: Nothing outside this file should call postMessage.
 *            Use SimulationService instead of this bridge directly.
 */

import type { WorkerAction, WorkerResponse } from '../types';
import {
  isWorkerResponse,
  isSyncStateResponse,
  isProgressReportResponse,
  isSaveExportResponse,
  isMatchResultResponse,
} from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Called once when the worker sends back the "terminal" response for a job. */
type ResolveCallback = (response: WorkerResponse) => void;

/** Called zero or more times as the worker streams progress for a long job. */
type ProgressCallback = (response: WorkerResponse) => void;

interface PendingJob {
  resolve: ResolveCallback;
  reject: (err: Error) => void;
  onProgress?: ProgressCallback;
}

/** Which response types signal that a job is fully complete. */
const TERMINAL_TYPES = new Set([
  'SYNC_STATE',
  'MATCH_RESULT',
  'SAVE_EXPORT',
  'WORKER_ERROR',
]);

// ---------------------------------------------------------------------------
// WorkerBridge class
// ---------------------------------------------------------------------------

class WorkerBridge {
  private worker: Worker;
  private pendingJobs = new Map<string, PendingJob>();
  private jobCounter = 0;

  /**
   * Global handler for SYNC_STATE messages.
   * The SimulationService registers this so Zustand is updated on every push.
   */
  private syncStateHandler: ((response: WorkerResponse) => void) | null = null;

  constructor() {
    // Vite-specific syntax for ES-module workers.
    // The `{ type: 'module' }` option is required for import statements inside
    // the worker file to work correctly.
    this.worker = new Worker(
      new URL('../worker/sim.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleWorkerError);
    this.worker.addEventListener('messageerror', this.handleMessageError);

    console.log('[WorkerBridge] Worker booted ✅');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Send an action to the worker and return a Promise that resolves when the
   * worker sends back the terminal response for this job.
   *
   * @param action   - The WorkerAction payload (without jobId — we add it here)
   * @param onProgress - Optional callback for PROGRESS_REPORT streaming updates
   */
  send(
    action: Omit<WorkerAction, 'jobId'>,
    onProgress?: ProgressCallback
  ): Promise<WorkerResponse> {
    const jobId = this.nextJobId();
    const payload = { ...action, jobId } as WorkerAction;

    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pendingJobs.set(jobId, { resolve, reject, onProgress });
      this.worker.postMessage(payload);

      if (import.meta.env.DEV) {
        console.log('[WorkerBridge] → sent', payload.type, { jobId });
      }
    });
  }

  /**
   * Register the function that will be called every time the worker sends
   * a SYNC_STATE message (including those not tied to a specific pending job).
   * SimulationService calls this once during its own construction.
   */
  onSyncState(handler: (response: WorkerResponse) => void): void {
    this.syncStateHandler = handler;
  }

  /** Terminate the worker — call when unmounting the entire app. */
  terminate(): void {
    this.worker.terminate();
    console.log('[WorkerBridge] Worker terminated');
  }

  // -------------------------------------------------------------------------
  // Private message routing
  // -------------------------------------------------------------------------

  private handleMessage = (event: MessageEvent): void => {
    const response = event.data as unknown;

    if (!isWorkerResponse(response)) {
      console.warn('[WorkerBridge] Received unrecognised message from worker', response);
      return;
    }

    if (import.meta.env.DEV) {
      console.log('[WorkerBridge] ← received', response.type, {
        jobId: (response as WorkerResponse & { jobId?: string }).jobId,
      });
    }

    // ── SYNC_STATE: always call the global handler (state mirror) ──────────
    if (isSyncStateResponse(response)) {
      this.syncStateHandler?.(response);
    }

    // ── Route to a pending job (if one exists for this jobId) ───────────────
    const jobId = (response as WorkerResponse & { jobId?: string }).jobId;

    if (!jobId) {
      // No jobId — it's a broadcast (e.g. autonomous SYNC_STATE push).
      return;
    }

    const job = this.pendingJobs.get(jobId);
    if (!job) {
      // Already resolved, or the job was never registered — ignore.
      return;
    }

    // ── PROGRESS_REPORT: stream to callback, don't resolve yet ────────────
    if (isProgressReportResponse(response)) {
      job.onProgress?.(response);
      return;
    }

    // ── Terminal response: resolve the Promise and clean up ────────────────
    if (TERMINAL_TYPES.has(response.type)) {
      this.pendingJobs.delete(jobId);

      if (response.type === 'WORKER_ERROR') {
        job.reject(new Error((response as { type: string; message?: string }).message ?? 'Worker error'));
      } else {
        job.resolve(response);
      }
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    console.error('[WorkerBridge] Worker runtime error:', event.message, event);

    // Reject all pending jobs so callers don't hang forever
    this.pendingJobs.forEach((job) => {
      job.reject(new Error(`Worker crashed: ${event.message}`));
    });
    this.pendingJobs.clear();
  };

  private handleMessageError = (event: MessageEvent): void => {
    console.error('[WorkerBridge] Failed to deserialise worker message:', event);
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private nextJobId(): string {
    return `job_${++this.jobCounter}_${Date.now()}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * The single WorkerBridge instance for the entire application.
 * Import this wherever you need low-level worker access, but prefer
 * importing `simulationService` from SimulationService.ts instead.
 */
export const workerBridge = new WorkerBridge();
