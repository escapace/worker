/**
 * Reuses one message-driven worker module across browser dedicated workers, Node worker threads,
 * and an in-process synthetic fallback.
 *
 * @remarks
 * The package exports the runtime entry point {@link createWorkerScope}, the dedicated-worker
 * branch check {@link isDedicatedWorkerGlobalScope}, and the public synthetic worker types.
 *
 * @packageDocumentation
 */
export { createWorkerScope, isDedicatedWorkerGlobalScope } from './create-worker-scope'
export type {
  CreateWorkerScopeContext,
  CreateWorkerScopeOptions,
  DedicatedWorkerGlobalScope,
  SyntheticWorker,
  SyntheticWorkerScope,
  SyntheticWorkerTarget,
} from './types'
