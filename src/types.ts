/// <reference lib="webworker" preserve="true" />

export type DedicatedWorkerGlobalScope = globalThis.DedicatedWorkerGlobalScope

/**
 * Configures the in-process branch of `createWorkerScope()`.
 *
 * @remarks
 * These options only affect the in-process branch. In a browser dedicated worker,
 * `createWorkerScope()` uses the real `DedicatedWorkerGlobalScope` and ignores them. In a
 * Node worker thread, clone and transfer behavior already comes from the native thread
 * boundary, so these options do not change that behavior.
 */
export interface CreateWorkerScopeOptions {
  /**
   * Enables `structuredClone()` and transfer-list semantics in the in-process branch.
   *
   * @remarks
   * This only affects the in-process branch. When omitted or `false`, that branch passes
   * payloads by reference and ignores transfer lists.
   *
   * @defaultValue false
   */
  structuredClone?: boolean
}

export interface NodeWorkerThreadParentPort {
  close: () => void
  on: (type: 'message', listener: (message: unknown) => void) => void
  postMessage: (message: unknown, options?: StructuredSerializeOptions) => void
}

export interface NodeWorkerThreadMessagePort extends MessagePort {
  unref?: () => void
}

export interface NodeWorkerThreadsModule {
  parentPort?: NodeWorkerThreadParentPort | null
}

export interface SyntheticWorkerEndpointHooks {
  dispatchWorkerErrorSynchronously?: boolean
  closeHook?: () => void
  postMessageBridge?: (
    message: unknown,
    transferOrOptions?: StructuredSerializeOptions | Transferable[],
  ) => void
}

export interface ListenerRegistration {
  capture: boolean
  original: EventListenerOrEventListenerObject
  type: string
  wrapped: EventListenerOrEventListenerObject
}

/**
 * Represents the native endpoint shapes mirrored by synthetic worker endpoints.
 *
 * @remarks
 * `SyntheticWorkerScope` uses the worker-global shape, and the paired `SyntheticWorker`
 * defaults to the main-thread `Worker` shape.
 */
export type SyntheticWorkerTarget = DedicatedWorkerGlobalScope | Worker

export type SyntheticWorkerEventHandler<T extends SyntheticWorkerTarget> =
  | ((event: Event) => unknown)
  | ((this: T, event: Event) => unknown)

/**
 * Represents one endpoint in a synthetic worker pair.
 *
 * @remarks
 * The surface matches the portable overlap used by `createWorkerScope()`: `EventTarget`
 * methods, `postMessage()`, `onmessage`, `onerror`, `terminate()`, and `close()`.
 *
 * @typeParam T - Native endpoint shape mirrored by this synthetic endpoint.
 */
export interface SyntheticWorker<T extends SyntheticWorkerTarget = Worker> extends EventTarget {
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => void

  close: () => void

  listeners: EventListener[]
  onerror: T['onerror']
  onmessage: T['onmessage']

  postMessage: {
    (message: unknown, transfer: Transferable[]): void
    (message: unknown, options?: StructuredSerializeOptions): void
  }

  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => void

  terminate: () => void
}

/**
 * Represents the synthetic scope passed to `createWorkerScope()` outside a browser dedicated
 * worker.
 */
export type SyntheticWorkerScope = SyntheticWorker<DedicatedWorkerGlobalScope>

export interface SyntheticWorkerImplementationScope extends SyntheticWorkerScope {
  receiveBridgedMessage: (message: unknown) => void
}

export interface SyntheticWorkerPair<TScope = SyntheticWorkerScope, TWorker = SyntheticWorker> {
  scope: TScope
  worker: TWorker
}

export type SyntheticWorkerImplementationPair =
  SyntheticWorkerPair<SyntheticWorkerImplementationScope>

/**
 * Describes the runtime branch selected by `createWorkerScope()`.
 *
 * @remarks
 * This is a discriminated union keyed by `type`.
 *
 * When `type` is `'dedicated-worker'`, `scope` is the real browser `DedicatedWorkerGlobalScope`.
 *
 * When `type` is `'worker-thread'` or `'in-process'`, `scope` is a {@link SyntheticWorkerScope}
 * that keeps the same message-driven worker module usable outside a browser dedicated worker.
 */
export type CreateWorkerScopeContext =
  | {
      scope: DedicatedWorkerGlobalScope
      type: 'dedicated-worker'
    }
  | {
      scope: SyntheticWorkerScope
      type: 'in-process'
    }
  | {
      scope: SyntheticWorkerScope
      type: 'worker-thread'
    }

export type SyntheticRuntimeContext = Extract<
  CreateWorkerScopeContext,
  {
    type: 'in-process' | 'worker-thread'
  }
>

export interface SyntheticRuntimeAdapter<TPair extends SyntheticWorkerPair = SyntheticWorkerPair> {
  readonly type: SyntheticRuntimeContext['type']
  createContext: (pair: TPair) => SyntheticRuntimeContext
  createPair: (options: CreateWorkerScopeOptions) => TPair
  getReturnValue: (pair: TPair) => SyntheticWorker | undefined
  start: (pair: TPair) => void
}
