import type {
  CreateWorkerScopeContext,
  CreateWorkerScopeOptions,
  DedicatedWorkerGlobalScope,
  ListenerRegistration,
  NodeWorkerThreadMessagePort,
  NodeWorkerThreadParentPort,
  NodeWorkerThreadsModule,
  SyntheticRuntimeAdapter,
  SyntheticRuntimeContext,
  SyntheticWorker,
  SyntheticWorkerEndpointHooks,
  SyntheticWorkerEventHandler,
  SyntheticWorkerImplementationPair,
  SyntheticWorkerTarget,
} from './types'

declare let self: DedicatedWorkerGlobalScope

class TaskScheduler {
  private scheduler: ((callback: () => void) => void) | undefined

  public schedule(callback: () => void) {
    this.scheduler ??= this.createScheduler()
    this.scheduler(callback)
  }

  private createScheduler() {
    const callbacks: Array<() => void> = []
    const channel = new MessageChannel()

    channel.port1.addEventListener('message', () => {
      const callback = callbacks.shift()

      callback?.()
    })
    channel.port1.start()

    const port1 = channel.port1 as NodeWorkerThreadMessagePort
    const port2 = channel.port2 as NodeWorkerThreadMessagePort

    port1.unref?.()
    port2.unref?.()

    return (callback: () => void) => {
      callbacks.push(callback)
      channel.port2.postMessage(undefined)
    }
  }
}

const normalizeCapture = (
  options?: boolean | AddEventListenerOptions | EventListenerOptions,
): boolean => {
  if (typeof options === 'boolean') {
    return options
  }

  return options?.capture ?? false
}

const normalizePostMessageOptions = (
  transferOrOptions?: StructuredSerializeOptions | Transferable[],
): StructuredSerializeOptions | undefined => {
  if (transferOrOptions === undefined) {
    return
  }

  return Array.isArray(transferOrOptions)
    ? {
        transfer: transferOrOptions,
      }
    : transferOrOptions
}

const getNodeBuiltinModule = <TModule>(name: string): TModule | undefined => {
  const nodeProcess = Reflect.get(globalThis, 'process')

  if (typeof nodeProcess !== 'object' || nodeProcess === null) {
    return
  }

  const getBuiltinModule = Reflect.get(nodeProcess, 'getBuiltinModule')

  if (typeof getBuiltinModule !== 'function') {
    return
  }

  return Reflect.apply(getBuiltinModule, nodeProcess, [name]) as TModule | undefined
}

const getNodeWorkerThreadParentPort = () =>
  getNodeBuiltinModule<NodeWorkerThreadsModule>('node:worker_threads')?.parentPort

const createSyntheticWorkerErrorEvent = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  if (typeof ErrorEvent === 'function') {
    return new ErrorEvent('error', {
      error,
      message,
    })
  }

  const event = new Event('error') as {
    error?: unknown
    message?: string
  } & Event

  Object.defineProperty(event, 'error', {
    configurable: true,
    value: error,
  })
  Object.defineProperty(event, 'message', {
    configurable: true,
    value: message,
  })

  return event
}

class SyntheticWorkerImplementation<T extends SyntheticWorkerTarget = Worker>
  extends EventTarget
  implements SyntheticWorker<T>
{
  listeners: EventListener[]

  #closed = false

  readonly #listenerRegistrations: ListenerRegistration[] = []

  #onerror: T['onerror'] = null

  #onerrorListener: EventListener | undefined

  #onmessage: T['onmessage'] = null

  #onmessageListener: EventListener | undefined

  #peer!: SyntheticWorkerImplementation<SyntheticWorkerTarget>

  readonly #role: 'scope' | 'worker'

  readonly #structuredClone: boolean

  readonly #closeHook: (() => void) | undefined

  readonly #dispatchWorkerErrorSynchronously: boolean

  readonly #postMessageBridge:
    | ((message: unknown, transferOrOptions?: StructuredSerializeOptions | Transferable[]) => void)
    | undefined

  readonly #taskScheduler: TaskScheduler

  static createPair(
    options: CreateWorkerScopeOptions = {},
    hooks: SyntheticWorkerEndpointHooks = {},
  ) {
    const taskScheduler = new TaskScheduler()
    const worker = new SyntheticWorkerImplementation<Worker>('worker', taskScheduler, options)
    const scope = new SyntheticWorkerImplementation<DedicatedWorkerGlobalScope>(
      'scope',
      taskScheduler,
      options,
      hooks,
    )

    worker.#peer = scope
    scope.#peer = worker

    return {
      scope,
      worker,
    }
  }

  constructor(
    role: 'scope' | 'worker',
    taskScheduler: TaskScheduler,
    options: CreateWorkerScopeOptions = {},
    hooks: SyntheticWorkerEndpointHooks = {},
    listeners: EventListener[] = [],
  ) {
    super()
    this.#role = role
    this.#structuredClone = options.structuredClone ?? false
    this.#closeHook = hooks.closeHook
    this.#dispatchWorkerErrorSynchronously = hooks.dispatchWorkerErrorSynchronously ?? false
    this.#postMessageBridge = hooks.postMessageBridge
    this.#taskScheduler = taskScheduler
    this.listeners = listeners
  }

  public postMessage(message: unknown, transfer: Transferable[]): void
  public postMessage(message: unknown, options?: StructuredSerializeOptions): void
  public postMessage(
    message: unknown,
    transferOrOptions?: StructuredSerializeOptions | Transferable[],
  ) {
    if (this.#closed) {
      return
    }

    if (this.#postMessageBridge !== undefined) {
      this.#postMessageBridge(message, transferOrOptions)
      return
    }

    const peer = this.#peer
    const data = this.#structuredClone
      ? structuredClone(message, normalizePostMessageOptions(transferOrOptions))
      : message

    this.#taskScheduler.schedule(() => {
      if (this.#closed || peer.#closed) {
        return
      }

      peer.#dispatchMessage(data)
    })
  }

  public terminate() {
    this.#close()
  }

  public close() {
    this.#close()
  }

  public get onmessage(): T['onmessage'] {
    return this.#onmessage
  }

  public set onmessage(handler: T['onmessage']) {
    this.#onmessage = handler
    this.#setEventHandler(
      'message',
      handler as unknown as SyntheticWorkerEventHandler<T>,
      this.#onmessageListener,
      (listener) => {
        this.#onmessageListener = listener
      },
    )
  }

  public get onerror(): T['onerror'] {
    return this.#onerror
  }

  public set onerror(handler: T['onerror']) {
    this.#onerror = handler
    this.#setEventHandler(
      'error',
      handler as unknown as SyntheticWorkerEventHandler<T>,
      this.#onerrorListener,
      (listener) => {
        this.#onerrorListener = listener
      },
    )
  }

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void
  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    const wrappedListener = this.#getWrappedListener(type, listener, options)

    super.addEventListener(type, wrappedListener, options)

    if (
      type === 'message' &&
      typeof listener === 'function' &&
      !this.listeners.includes(listener)
    ) {
      this.listeners.push(listener)
    }
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void
  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) {
    const wrappedListener = this.#getWrappedListener(type, listener, options, false)

    super.removeEventListener(type, wrappedListener, options)
    this.#removeWrappedListener(type, listener, options)

    if (type === 'message' && typeof listener === 'function') {
      const index = this.listeners.indexOf(listener)

      if (index > -1) {
        this.listeners.splice(index, 1)
      }
    }
  }

  public receiveBridgedMessage(message: unknown) {
    if (this.#closed) {
      return
    }

    this.#dispatchMessage(message)
  }

  #close() {
    this.#closePair()
    this.#closeHook?.()
  }

  #closePair() {
    this.#closed = true
    this.#peer.#closed = true
  }

  #createWrappedListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): EventListenerOrEventListenerObject {
    if (typeof listener === 'function') {
      return (event: Event) => {
        try {
          void listener.call(this, event)
        } catch (error) {
          if (this.#shouldReportAsWorkerError(type)) {
            this.#dispatchWorkerError(error)
            return
          }

          throw error
        }
      }
    }

    return {
      handleEvent: (event: Event) => {
        try {
          void listener.handleEvent(event)
        } catch (error) {
          if (this.#shouldReportAsWorkerError(type)) {
            this.#dispatchWorkerError(error)
            return
          }

          throw error
        }
      },
    }
  }

  #dispatchError(error: unknown) {
    this.dispatchEvent(createSyntheticWorkerErrorEvent(error))
  }

  #dispatchMessage(data: unknown) {
    this.dispatchEvent(
      new MessageEvent('message', {
        data,
      }),
    )
  }

  #dispatchWorkerError(error: unknown) {
    const peer = this.#peer

    if (peer.#closed) {
      return
    }

    if (this.#dispatchWorkerErrorSynchronously) {
      peer.#dispatchError(error)
      return
    }

    this.#taskScheduler.schedule(() => {
      if (peer.#closed) {
        return
      }

      peer.#dispatchError(error)
    })
  }

  #getWrappedListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions | EventListenerOptions,
    create = true,
  ): EventListenerOrEventListenerObject | null {
    if (listener === null) {
      return null
    }

    const capture = normalizeCapture(options)
    const registration = this.#listenerRegistrations.find(
      (value) => value.capture === capture && value.original === listener && value.type === type,
    )

    if (registration !== undefined) {
      return registration.wrapped
    }

    if (!create) {
      return listener
    }

    const wrapped = this.#createWrappedListener(type, listener)

    this.#listenerRegistrations.push({
      capture,
      original: listener,
      type,
      wrapped,
    })

    return wrapped
  }

  #invokeEventHandler(
    type: 'error' | 'message',
    handler: SyntheticWorkerEventHandler<T>,
    event: Event,
  ) {
    try {
      void handler.call(this as unknown as T, event)
    } catch (error) {
      if (this.#shouldReportAsWorkerError(type)) {
        this.#dispatchWorkerError(error)
        return
      }

      throw error
    }
  }

  #removeWrappedListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions | EventListenerOptions,
  ) {
    if (listener === null) {
      return
    }

    const capture = normalizeCapture(options)
    const index = this.#listenerRegistrations.findIndex(
      (value) => value.capture === capture && value.original === listener && value.type === type,
    )

    if (index > -1) {
      this.#listenerRegistrations.splice(index, 1)
    }
  }

  #setEventHandler(
    type: 'error' | 'message',
    handler: SyntheticWorkerEventHandler<T> | null,
    currentListener: EventListener | undefined,
    setCurrentListener: (listener: EventListener | undefined) => void,
  ) {
    if (currentListener !== undefined) {
      super.removeEventListener(type, currentListener)
    }

    if (handler === null) {
      setCurrentListener(undefined)
      return
    }

    const listener: EventListener = (event) => {
      this.#invokeEventHandler(type, handler, event)
    }

    setCurrentListener(listener)
    super.addEventListener(type, listener)
  }

  #shouldReportAsWorkerError(type: string) {
    return this.#role === 'scope' && type === 'message'
  }
}

class InProcessRuntimeAdapter implements SyntheticRuntimeAdapter<SyntheticWorkerImplementationPair> {
  public readonly type = 'in-process' as const

  public createContext({ scope }: SyntheticWorkerImplementationPair): SyntheticRuntimeContext {
    return {
      scope,
      type: this.type,
    }
  }

  public createPair(options: CreateWorkerScopeOptions): SyntheticWorkerImplementationPair {
    return SyntheticWorkerImplementation.createPair(options)
  }

  public getReturnValue({ worker }: SyntheticWorkerImplementationPair): SyntheticWorker {
    return worker
  }

  public start(): void {
    return
  }
}

class WorkerThreadRuntimeAdapter implements SyntheticRuntimeAdapter<SyntheticWorkerImplementationPair> {
  public readonly type = 'worker-thread' as const

  readonly #parentPort: NodeWorkerThreadParentPort

  public constructor(parentPort: NodeWorkerThreadParentPort) {
    this.#parentPort = parentPort
  }

  public createContext({ scope }: SyntheticWorkerImplementationPair): SyntheticRuntimeContext {
    return {
      scope,
      type: this.type,
    }
  }

  public createPair(options: CreateWorkerScopeOptions): SyntheticWorkerImplementationPair {
    return SyntheticWorkerImplementation.createPair(
      {
        ...options,
        structuredClone: false,
      },
      {
        dispatchWorkerErrorSynchronously: true,
        closeHook: () => {
          this.#parentPort.close()
        },
        postMessageBridge: (message, transferOrOptions) => {
          this.#parentPort.postMessage(message, normalizePostMessageOptions(transferOrOptions))
        },
      },
    )
  }

  public getReturnValue(_pair: SyntheticWorkerImplementationPair): undefined {
    return
  }

  public start({ scope, worker }: SyntheticWorkerImplementationPair) {
    this.#parentPort.on('message', (message: unknown) => {
      scope.receiveBridgedMessage(message)
    })

    worker.addEventListener('error', (event) => {
      const workerErrorEvent = event as {
        error?: unknown
        message?: string
      } & Event
      const workerError = workerErrorEvent.error

      if (workerError instanceof Error) {
        throw workerError
      }

      /* v8 ignore next -- synthetic worker error events always carry a message */
      throw new Error(workerErrorEvent.message ?? 'Worker message handler failed')
    })
  }
}

/**
 * Checks whether the current global scope is a browser `DedicatedWorkerGlobalScope`.
 *
 * @remarks
 * This only identifies the real browser dedicated-worker branch. It returns `false` in the
 * in-process synthetic branch and in the Node worker-thread branch.
 *
 * @returns `true` when the current global scope is a browser dedicated worker; otherwise, `false`.
 */
export const isDedicatedWorkerGlobalScope = () => {
  const scope = globalThis[
    Symbol.toStringTag as unknown as keyof typeof globalThis
  ] as unknown as string

  return scope === 'DedicatedWorkerGlobalScope'
}

/**
 * Initializes a worker module against the active runtime branch.
 *
 * @remarks
 * `createWorkerScope()` selects one of three branches:
 *
 * - Browser dedicated worker: passes the real `DedicatedWorkerGlobalScope` with `type: 'dedicated-worker'` and returns `undefined`.
 *
 * - Node worker thread: passes a `SyntheticWorkerScope` with `type: 'worker-thread'`, auto-bridges ordinary messages to `parentPort`, and returns `undefined`.
 *
 * - In-process fallback: passes a `SyntheticWorkerScope` with `type: 'in-process'` and returns the paired `SyntheticWorker`.
 *
 * The shared contract is intentionally narrow. Shared code can rely on asynchronous ordinary
 * message delivery, `MessageEvent` dispatch for ordinary messages, `EventTarget` listener
 * behavior, `onmessage`, `onerror`, and lifecycle cutoffs through `terminate()` and `close()`.
 * The portable event surface is exactly `message`, `error`, `onmessage`, and `onerror`.
 *
 * In the in-process branch, payloads are passed by reference and transfer lists are ignored by
 * default. Setting `options.structuredClone` to `true` enables `structuredClone()` and
 * transfer-list behavior for that branch only. It has no effect in the browser dedicated-worker
 * branch, and it does not change clone or transfer behavior in the Node worker-thread branch.
 *
 * Scope-side `message` handler failures are translated into worker-like `error` delivery.
 * Failures from other event types continue to follow the host `EventTarget` error path.
 *
 * In the worker-thread branch, `scope.close()` is a cooperative shutdown path. The parent-side
 * native Node `Worker.terminate()` API remains the forced-shutdown path.
 *
 * `terminate()` and `close()` also drop already queued synthetic messages and already queued
 * synthetic worker-error delivery.
 *
 * @param createWorker - Receives the runtime branch and scope selected for the module.
 * @param options - Controls payload handling in the in-process branch.
 * @returns `undefined` in the browser dedicated-worker and Node worker-thread branches; otherwise, the paired `SyntheticWorker` for the in-process branch.
 */
export function createWorkerScope(
  createWorker: (scope: CreateWorkerScopeContext) => void,
  options: CreateWorkerScopeOptions = {},
): SyntheticWorker | undefined {
  if (isDedicatedWorkerGlobalScope()) {
    createWorker({
      scope: self,
      type: 'dedicated-worker',
    })

    return
  }

  const parentPort = getNodeWorkerThreadParentPort()
  const adapter: SyntheticRuntimeAdapter<SyntheticWorkerImplementationPair> =
    parentPort != null ? new WorkerThreadRuntimeAdapter(parentPort) : new InProcessRuntimeAdapter()
  const pair = adapter.createPair(options)

  adapter.start(pair)
  createWorker(adapter.createContext(pair))

  return adapter.getReturnValue(pair)
}
