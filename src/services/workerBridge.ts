/**
 * src/services/workerBridge.ts
 *
 * THE ONLY place in the app that talks to the Web Worker directly.
 *
 * Phase 4 fix:
 *   MATCH_RESULT removed from TERMINAL_TYPES and now routed to the global
 *   syncStateHandler alongside SYNC_STATE. See comment on TERMINAL_TYPES.
 */

import type { WorkerAction, WorkerResponse } from '../types';
import {
  isWorkerResponse,
  isSyncStateResponse,
  isProgressReportResponse,
  isMatchResultResponse,
} from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ResolveCallback  = (response: WorkerResponse) => void;
type ProgressCallback = (response: WorkerResponse) => void;

interface PendingJob {
  resolve:     ResolveCallback;
  reject:      (err: Error) => void;
  onProgress?: ProgressCallback;
}

/**
 * Response types that signal a job is fully complete.
 *
 * MATCH_RESULT is intentionally NOT here.
 *
 * A single SIM_DAY can produce multiple MATCH_RESULT messages (one per game
 * played) before the final SYNC_STATE arrives. If MATCH_RESULT were terminal,
 * the bridge would resolve and delete the pending job on the first match card,
 * and the subsequent SYNC_STATE would find no job to resolve — Zustand would
 * never update and the spinner would spin forever.
 *
 * Instead, MATCH_RESULT is routed to the global syncStateHandler (alongside
 * SYNC_STATE) so SimulationService can forward each report to inboxStore.
 * The job stays alive until SYNC_STATE, the true terminal signal.
 */
const TERMINAL_TYPES = new Set([
  'SYNC_STATE',
  'SAVE_EXPORT',
  'WORKER_ERROR',
]);

// ---------------------------------------------------------------------------
// WorkerBridge class
// ---------------------------------------------------------------------------

class WorkerBridge {
  private worker: Worker;
  private pendingJobs = new Map<string, PendingJob>();
  private jobCounter  = 0;

  /**
   * Global handler invoked for every SYNC_STATE and MATCH_RESULT message.
   * SimulationService registers this once — calling onSyncState() a second
   * time silently replaces the first, so always put all handling in one call.
   */
  private syncStateHandler: ((response: WorkerResponse) => void) | null = null;

  constructor() {
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

  send(
    action: Omit<WorkerAction, 'jobId'>,
    onProgress?: ProgressCallback
  ): Promise<WorkerResponse> {
    const jobId   = this.nextJobId();
    const payload = { ...action, jobId } as WorkerAction;

    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pendingJobs.set(jobId, { resolve, reject, onProgress });
      this.worker.postMessage(payload);
      if (import.meta.env.DEV) {
        console.log('[WorkerBridge] → sent', payload.type, { jobId });
      }
    });
  }

  onSyncState(handler: (response: WorkerResponse) => void): void {
    this.syncStateHandler = handler;
  }

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
      console.warn('[WorkerBridge] Unrecognised message from worker', response);
      return;
    }

    if (import.meta.env.DEV) {
      console.log('[WorkerBridge] ← received', response.type, {
        jobId: (response as WorkerResponse & { jobId?: string }).jobId,
      });
    }

    // ── Global handler: SYNC_STATE and MATCH_RESULT ─────────────────────────
    //
    // Both message types are forwarded to SimulationService's merged handler:
    //   SYNC_STATE   → applyGameState()     → Zustand updated
    //   MATCH_RESULT → inboxStore.pushReport() → inbox card added
    if (isSyncStateResponse(response) || isMatchResultResponse(response)) {
      this.syncStateHandler?.(response);
    }

    // ── Pending-job routing ─────────────────────────────────────────────────
    const jobId = (response as WorkerResponse & { jobId?: string }).jobId;
    if (!jobId) return;

    const job = this.pendingJobs.get(jobId);
    if (!job) return; // already resolved or broadcast — ignore

    // Stream progress without resolving
    if (isProgressReportResponse(response)) {
      job.onProgress?.(response);
      return;
    }

    // Terminal response: resolve and clean up
    if (TERMINAL_TYPES.has(response.type)) {
      this.pendingJobs.delete(jobId);
      if (response.type === 'WORKER_ERROR') {
        job.reject(new Error(
          (response as { type: string; message?: string }).message ?? 'Worker error'
        ));
      } else {
        job.resolve(response);
      }
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    console.error('[WorkerBridge] Worker runtime error:', event.message, event);
    this.pendingJobs.forEach(job => job.reject(new Error(`Worker crashed: ${event.message}`)));
    this.pendingJobs.clear();
  };

  private handleMessageError = (event: MessageEvent): void => {
    console.error('[WorkerBridge] Failed to deserialise worker message:', event);
  };

  private nextJobId(): string {
    return `job_${++this.jobCounter}_${Date.now()}`;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const workerBridge = new WorkerBridge();
