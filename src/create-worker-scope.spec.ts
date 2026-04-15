import { describe, expect, it } from 'vitest'
import { createWorkerScope } from './create-worker-scope'
import type { WorkerProbeRequest, WorkerProbeResponse } from './test-support/conformance-protocol'

declare const __VITEST_PROJECT__: 'browser' | 'neutral' | 'node'

interface NativeWorkerAdapter {
  assertListenerFailure: (error: unknown) => void
  observeMessages: (listener: (message: WorkerProbeResponse) => void) => () => void
  onceError: () => Promise<unknown>
  onceMessage: <TKind extends WorkerProbeResponse['kind']>(
    kind: TKind,
  ) => Promise<Extract<WorkerProbeResponse, { kind: TKind }>>
  postMessage: (message: WorkerProbeRequest, transfer?: Transferable[]) => void
  terminate: () => Promise<void>
}

const project = __VITEST_PROJECT__
const isBrowserProject = project === 'browser'
const isNeutralProject = project === 'neutral'
const isNodeProject = project === 'node'

const describeRuntime = isNeutralProject ? describe.skip : describe
const describeBrowserOnly = isBrowserProject ? describe : describe.skip
const describeNodeOnly = isNodeProject ? describe : describe.skip

const createBrowserNativeWorker = () =>
  new Worker(new URL('./test-support/conformance-browser-worker.ts', import.meta.url), {
    type: 'module',
  })

const createBrowserCreateWorkerScopeWorker = () =>
  new Worker(new URL('./test-support/create-worker-scope-browser-worker.ts', import.meta.url), {
    type: 'module',
  })

const createNodeCreateWorkerScopeWorker = () => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads

  return new Worker(
    new URL('./test-support/create-worker-scope-node-worker-thread.ts', import.meta.url),
  )
}

const createNodeCreateWorkerScopeOrderingWorker = () => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads

  return new Worker(
    new URL('./test-support/create-worker-scope-node-worker-thread-ordering.ts', import.meta.url),
  )
}

const createNodeCreateWorkerScopeConformanceWorker = () => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads

  return new Worker(
    new URL(
      './test-support/create-worker-scope-node-worker-thread-conformance.ts',
      import.meta.url,
    ),
  )
}

const createNodeCreateWorkerScopeOutboundOrderingWorker = () => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads

  return new Worker(
    new URL(
      './test-support/create-worker-scope-node-worker-thread-outbound-ordering.ts',
      import.meta.url,
    ),
  )
}

const createNodeCreateWorkerScopeErrorOrderingWorker = () => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads

  return new Worker(
    new URL(
      './test-support/create-worker-scope-node-worker-thread-error-ordering.ts',
      import.meta.url,
    ),
  )
}

const appendStringMessage = (messages: string[], prefix: string, event: Event) => {
  messages.push(`${prefix}:${String((event as MessageEvent<string>).data)}`)
}

const returnOk = () => 'ok'

const waitForEvent = async <TEvent extends Event>(
  target: EventTarget,
  type: string,
  predicate: (event: TEvent) => boolean = () => true,
) =>
  await new Promise<TEvent>((resolve) => {
    const listener = (event: Event) => {
      const typedEvent = event as TEvent

      if (predicate(typedEvent)) {
        target.removeEventListener(type, listener)
        resolve(typedEvent)
      }
    }

    target.addEventListener(type, listener)
  })

const waitForUnhandledError = async () => {
  if (isBrowserProject) {
    return await new Promise<Error>((resolve) => {
      const onError = (event: ErrorEvent) => {
        event.preventDefault()
        window.removeEventListener('error', onError)
        resolve(event.error instanceof Error ? event.error : new Error(event.message))
      }

      window.addEventListener('error', onError)
    })
  }

  return await new Promise<Error>((resolve) => {
    process.once('uncaughtException', (error) => {
      resolve(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

const createBrowserNativeWorkerAdapter = (): NativeWorkerAdapter => {
  const worker = createBrowserNativeWorker()

  return {
    assertListenerFailure(error) {
      expect(error).toMatchObject({
        type: 'error',
      })
    },
    observeMessages(listener) {
      const onMessage = (event: MessageEvent<WorkerProbeResponse>) => {
        listener(event.data)
      }

      worker.addEventListener('message', onMessage)

      return () => {
        worker.removeEventListener('message', onMessage)
      }
    },
    async onceError() {
      return await new Promise((resolve) => {
        const onError = (event: Event) => {
          event.preventDefault()
          worker.removeEventListener('error', onError)
          resolve(event)
        }

        worker.addEventListener('error', onError)
      })
    },
    async onceMessage<TKind extends WorkerProbeResponse['kind']>(kind: TKind) {
      return await waitForEvent<MessageEvent<WorkerProbeResponse>>(
        worker,
        'message',
        (event) => event.data.kind === kind,
      ).then((event) => event.data as Extract<WorkerProbeResponse, { kind: TKind }>)
    },
    postMessage(message, transfer) {
      if (transfer === undefined) {
        worker.postMessage(message)
        return
      }

      worker.postMessage(message, transfer)
    },
    async terminate() {
      worker.terminate()
      return await Promise.resolve()
    },
  }
}

const createNodeNativeWorkerAdapter = (): NativeWorkerAdapter => {
  const workerThreads = process.getBuiltinModule('node:worker_threads')

  if (workerThreads === undefined) {
    throw new Error('node:worker_threads unavailable')
  }

  const { Worker } = workerThreads
  const worker = new Worker(new URL('./test-support/conformance-node-worker.ts', import.meta.url))

  return {
    assertListenerFailure(error) {
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('worker-listener-throw')
    },
    observeMessages(listener) {
      const onMessage = (message: WorkerProbeResponse) => {
        listener(message)
      }

      worker.on('message', onMessage)

      return () => {
        worker.off('message', onMessage)
      }
    },
    async onceError() {
      return await new Promise((resolve) => {
        worker.once('error', resolve)
      })
    },
    async onceMessage<TKind extends WorkerProbeResponse['kind']>(kind: TKind) {
      return await new Promise<Extract<WorkerProbeResponse, { kind: TKind }>>((resolve) => {
        const onMessage = (message: WorkerProbeResponse) => {
          if (message.kind === kind) {
            worker.off('message', onMessage)
            resolve(message as Extract<WorkerProbeResponse, { kind: TKind }>)
          }
        }

        worker.on('message', onMessage)
      })
    },
    postMessage(message, transfer) {
      worker.postMessage(
        message,
        transfer as ReadonlyArray<import('node:worker_threads').TransferListItem> | undefined,
      )
    },
    async terminate() {
      return await worker.terminate().then(() => undefined)
    },
  }
}

const createNativeWorkerAdapter = () => {
  if (isBrowserProject) {
    return createBrowserNativeWorkerAdapter()
  }

  if (isNodeProject) {
    return createNodeNativeWorkerAdapter()
  }

  throw new Error(`Unsupported Vitest project: ${project}`)
}

const requestBrowserWorker = async <TKind extends WorkerProbeResponse['kind']>(
  worker: Worker,
  request: WorkerProbeRequest,
  kind: TKind,
): Promise<Extract<WorkerProbeResponse, { kind: TKind }>> => {
  const response = waitForEvent<MessageEvent<WorkerProbeResponse>>(
    worker,
    'message',
    (event) => event.data.kind === kind,
  )

  worker.postMessage(request)

  return (await response).data as Extract<WorkerProbeResponse, { kind: TKind }>
}

const flushTasks = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

const waitForNodeWorkerMessage = async <TMessage>(
  worker: import('node:worker_threads').Worker,
  predicate: (message: TMessage) => boolean = () => true,
) =>
  await new Promise<TMessage>((resolve) => {
    const listener = (message: TMessage) => {
      if (predicate(message)) {
        worker.off('message', listener)
        resolve(message)
      }
    }

    worker.on('message', listener)
  })

const waitForNodeCreateWorkerScopeWorkerInit = async (
  worker: import('node:worker_threads').Worker,
) =>
  await waitForNodeWorkerMessage<{
    kind: 'init'
    returnedUndefined: boolean
    type: 'worker-thread'
  }>(worker, (message) => message.kind === 'init')

const createStructuredCloneSyntheticWorker = (
  createWorker: Parameters<typeof createWorkerScope>[0],
) => createWorkerScope(createWorker, { structuredClone: true })

const getThrownError = (action: () => void) => {
  try {
    action()
    return
  } catch (error) {
    return error
  }
}

const withMockedNodeWorkerThreadParentPort = <T>(
  parentPort: {
    close: () => void
    on: (type: 'message', listener: (message: unknown) => void) => void
    postMessage: (message: unknown, options?: StructuredSerializeOptions) => void
  },
  action: () => T,
): T => {
  const previousProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')

  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: {
      getBuiltinModule(name: string) {
        if (name === 'node:worker_threads') {
          return {
            parentPort,
          }
        }

        return
      },
    },
    writable: true,
  })

  try {
    return action()
  } finally {
    if (previousProcessDescriptor === undefined) {
      Reflect.deleteProperty(globalThis, 'process')
    } else {
      Object.defineProperty(globalThis, 'process', previousProcessDescriptor)
    }
  }
}

describeRuntime('native worker messaging overlap', () => {
  it('delivers messages asynchronously and snapshots posted payloads', async () => {
    const worker = createNativeWorkerAdapter()

    try {
      let receivedSynchronously = false
      const stopObserving = worker.observeMessages(() => {
        receivedSynchronously = true
      })

      const payload = {
        nested: {
          value: 1,
        },
      }

      const echoResponse = worker.onceMessage('echo:result')

      worker.postMessage({
        kind: 'echo',
        payload,
      })

      expect(receivedSynchronously).toBe(false)
      await Promise.resolve()
      expect(receivedSynchronously).toBe(false)

      payload.nested.value = 2

      await expect(echoResponse).resolves.toEqual({
        kind: 'echo:result',
        payload: {
          nested: {
            value: 1,
          },
        },
      })

      stopObserving()
    } finally {
      await worker.terminate()
    }
  })

  it('rejects non-cloneable values and supports transfer lists', async () => {
    const worker = createNativeWorkerAdapter()

    try {
      const thrownError = getThrownError(() => {
        worker.postMessage({
          kind: 'echo',
          payload: () => undefined,
        })
      })

      expect(thrownError).toBeDefined()
      expect((thrownError as { name?: string }).name).toBe('DataCloneError')

      const buffer = new ArrayBuffer(8)
      const transferResponse = worker.onceMessage('inspect-transfer-array-buffer:result')

      worker.postMessage(
        {
          kind: 'inspect-transfer-array-buffer',
          payload: buffer,
        },
        [buffer],
      )

      expect(buffer.byteLength).toBe(0)
      await expect(transferResponse).resolves.toEqual({
        byteLength: 8,
        kind: 'inspect-transfer-array-buffer:result',
      })
    } finally {
      await worker.terminate()
    }
  })

  it('reports uncaught listener failures via the native worker error channel', async () => {
    const worker = createNativeWorkerAdapter()

    try {
      const errorEvent = worker.onceError()

      expect(() => {
        worker.postMessage({
          kind: 'throw-in-listener',
        })
      }).not.toThrow()

      worker.assertListenerFailure(await errorEvent)
    } finally {
      await worker.terminate()
    }
  })
})

describeNodeOnly('createWorkerScope native-branch selection', () => {
  it('returns undefined and passes through self when dedicated-worker detection succeeds', () => {
    const previousSelf = globalThis.self
    const previousTagDescriptor = Object.getOwnPropertyDescriptor(globalThis, Symbol.toStringTag)
    const fakeScope = { kind: 'fake-worker-scope' }
    const restoreSelf = () => {
      if (previousSelf === undefined) {
        Reflect.deleteProperty(globalThis, 'self')
        return
      }

      Object.defineProperty(globalThis, 'self', {
        configurable: true,
        value: previousSelf,
        writable: true,
      })
    }

    Object.defineProperty(globalThis, 'self', {
      configurable: true,
      value: fakeScope,
      writable: true,
    })
    Object.defineProperty(globalThis, Symbol.toStringTag, {
      configurable: true,
      value: 'DedicatedWorkerGlobalScope',
    })

    try {
      let callbackArgument: Parameters<Parameters<typeof createWorkerScope>[0]>[0] | undefined

      const worker = createWorkerScope((scope) => {
        callbackArgument = scope
      })

      expect(worker).toBeUndefined()
      expect(callbackArgument?.type).toBe('dedicated-worker')
      expect(callbackArgument?.scope).toBe(fakeScope)
    } finally {
      restoreSelf()

      if (previousTagDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, Symbol.toStringTag)
      } else {
        Object.defineProperty(globalThis, Symbol.toStringTag, previousTagDescriptor)
      }
    }
  })

  it('selects the worker-thread branch in process and bridges inbound and outbound messages', () => {
    let closeCalls = 0
    let inboundListener: ((message: unknown) => void) | undefined
    let postedMessage:
      | {
          message: unknown
          options: StructuredSerializeOptions | undefined
        }
      | undefined
    let callbackArgument: Parameters<Parameters<typeof createWorkerScope>[0]>[0] | undefined
    const inboundMessages: unknown[] = []

    const worker = withMockedNodeWorkerThreadParentPort(
      {
        close() {
          closeCalls += 1
        },
        on(type, listener) {
          expect(type).toBe('message')
          inboundListener = listener
        },
        postMessage(message, options) {
          postedMessage = {
            message,
            options,
          }
        },
      },
      () =>
        createWorkerScope((scope) => {
          callbackArgument = scope
          scope.scope.addEventListener('message', (event) => {
            inboundMessages.push((event as MessageEvent<unknown>).data)
          })
        }),
    )

    expect(worker).toBeUndefined()
    expect(callbackArgument?.type).toBe('worker-thread')
    expect(callbackArgument?.scope).toBeDefined()
    expect(inboundListener).toBeTypeOf('function')

    const buffer = new ArrayBuffer(4)

    callbackArgument!.scope.postMessage(
      {
        value: 1,
      },
      [buffer],
    )

    expect(postedMessage).toEqual({
      message: {
        value: 1,
      },
      options: {
        transfer: [buffer],
      },
    })

    inboundListener!({
      value: 2,
    })
    expect(inboundMessages).toEqual([
      {
        value: 2,
      },
    ])

    callbackArgument!.scope.close()
    expect(closeCalls).toBe(1)

    inboundListener!('after-close')
    expect(inboundMessages).toEqual([
      {
        value: 2,
      },
    ])
  })

  it('rethrows Error instances from worker-thread scope message handlers through the host uncaught-error channel in the in-process harness', async () => {
    let inboundListener: ((message: unknown) => void) | undefined

    withMockedNodeWorkerThreadParentPort(
      {
        close() {
          return
        },
        on(type, listener) {
          expect(type).toBe('message')
          inboundListener = listener
        },
        postMessage() {
          return
        },
      },
      () =>
        createWorkerScope(({ scope, type }) => {
          expect(type).toBe('worker-thread')
          scope.onmessage = () => {
            throw new Error('mock-worker-thread-error')
          }
        }),
    )

    const unhandledError = waitForUnhandledError()

    inboundListener!('trigger-error')

    await expect(unhandledError).resolves.toMatchObject({
      message: 'mock-worker-thread-error',
    })
  })

  it('wraps non-Error worker-thread scope failures with their stringified message in the in-process harness', async () => {
    let inboundListener: ((message: unknown) => void) | undefined

    const nonErrorThrowable = 'mock-worker-thread-string-error' as unknown as Error

    withMockedNodeWorkerThreadParentPort(
      {
        close() {
          return
        },
        on(type, listener) {
          expect(type).toBe('message')
          inboundListener = listener
        },
        postMessage() {
          return
        },
      },
      () =>
        createWorkerScope(({ scope, type }) => {
          expect(type).toBe('worker-thread')
          scope.onmessage = () => {
            throw nonErrorThrowable
          }
        }),
    )

    const unhandledError = waitForUnhandledError()

    inboundListener!('trigger-string-error')

    await expect(unhandledError).resolves.toMatchObject({
      message: 'mock-worker-thread-string-error',
    })
  })
})

describeNodeOnly('createWorkerScope node worker-thread bridge', () => {
  it('auto-bridges node worker threads and returns undefined inside the worker thread', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    try {
      await expect(waitForNodeCreateWorkerScopeWorkerInit(worker)).resolves.toEqual({
        kind: 'init',
        returnedUndefined: true,
        type: 'worker-thread',
      })

      const echoResponse = waitForNodeWorkerMessage<{
        kind: 'echo:result'
        payload: string
      }>(worker, (message) => message.kind === 'echo:result')

      worker.postMessage({
        kind: 'echo',
        payload: 'ping',
      })

      await expect(echoResponse).resolves.toEqual({
        kind: 'echo:result',
        payload: 'ping',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('preserves transfer lists when auto-bridging node worker threads', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const inboundBuffer = new ArrayBuffer(8)
      const inboundTransferResponse = waitForNodeWorkerMessage<{
        byteLength: number
        kind: 'inspect-transfer-array-buffer:result'
      }>(worker, (message) => message.kind === 'inspect-transfer-array-buffer:result')

      worker.postMessage(
        {
          kind: 'inspect-transfer-array-buffer',
          payload: inboundBuffer,
        },
        [inboundBuffer],
      )

      expect(inboundBuffer.byteLength).toBe(0)
      await expect(inboundTransferResponse).resolves.toEqual({
        byteLength: 8,
        kind: 'inspect-transfer-array-buffer:result',
      })

      const outboundTransferResponse = waitForNodeWorkerMessage<{
        buffer: ArrayBuffer
        kind: 'outbound-transfer-array-buffer:result'
      }>(worker, (message) => message.kind === 'outbound-transfer-array-buffer:result')
      const outboundTransferAfterResponse = waitForNodeWorkerMessage<{
        byteLength: number
        kind: 'outbound-transfer-array-buffer:after'
      }>(worker, (message) => message.kind === 'outbound-transfer-array-buffer:after')

      worker.postMessage({
        kind: 'outbound-transfer-array-buffer',
      })

      const outboundTransferResult = await outboundTransferResponse

      expect(outboundTransferResult.buffer).toBeInstanceOf(ArrayBuffer)
      expect(outboundTransferResult.buffer.byteLength).toBe(8)
      await expect(outboundTransferAfterResponse).resolves.toEqual({
        byteLength: 0,
        kind: 'outbound-transfer-array-buffer:after',
      })

      const outboundTransferOptionsResponse = waitForNodeWorkerMessage<{
        buffer: ArrayBuffer
        kind: 'outbound-transfer-array-buffer-options:result'
      }>(worker, (message) => message.kind === 'outbound-transfer-array-buffer-options:result')
      const outboundTransferOptionsAfterResponse = waitForNodeWorkerMessage<{
        byteLength: number
        kind: 'outbound-transfer-array-buffer-options:after'
      }>(worker, (message) => message.kind === 'outbound-transfer-array-buffer-options:after')

      worker.postMessage({
        kind: 'outbound-transfer-array-buffer-options',
      })

      const outboundTransferOptionsResult = await outboundTransferOptionsResponse

      expect(outboundTransferOptionsResult.buffer).toBeInstanceOf(ArrayBuffer)
      expect(outboundTransferOptionsResult.buffer.byteLength).toBe(8)
      await expect(outboundTransferOptionsAfterResponse).resolves.toEqual({
        byteLength: 0,
        kind: 'outbound-transfer-array-buffer-options:after',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('uses native clone behavior for ordinary payloads and clone failures in auto-bridged node worker threads', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const payload = {
        nested: {
          value: 1,
        },
      }
      const echoResponse = waitForNodeWorkerMessage<{
        kind: 'echo:result'
        payload: typeof payload
      }>(worker, (message) => message.kind === 'echo:result')

      worker.postMessage({
        kind: 'echo',
        payload,
      })
      payload.nested.value = 2

      await expect(echoResponse).resolves.toEqual({
        kind: 'echo:result',
        payload: {
          nested: {
            value: 1,
          },
        },
      })

      const thrownError = getThrownError(() => {
        worker.postMessage({
          kind: 'echo',
          payload: () => undefined,
        })
      })

      expect(thrownError).toBeDefined()
      expect((thrownError as { name?: string }).name).toBe('DataCloneError')
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('exposes worker-thread scope surface and MessageEvent details', async () => {
    const worker = createNodeCreateWorkerScopeConformanceWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const describeScopeResponse = waitForNodeWorkerMessage<{
        kind: 'describe-scope:result'
        result: {
          hasAddEventListener: boolean
          hasClose: boolean
          hasOnerror: boolean
          hasOnmessage: boolean
          hasPostMessage: boolean
          hasRemoveEventListener: boolean
        }
      }>(worker, (message) => message.kind === 'describe-scope:result')

      worker.postMessage({
        kind: 'describe-scope',
      })

      await expect(describeScopeResponse).resolves.toEqual({
        kind: 'describe-scope:result',
        result: {
          hasAddEventListener: true,
          hasClose: true,
          hasOnerror: true,
          hasOnmessage: true,
          hasPostMessage: true,
          hasRemoveEventListener: true,
        },
      })

      const inspectInboundEventResponse = waitForNodeWorkerMessage<{
        kind: 'inspect-inbound-event:result'
        result: {
          constructorName: string
          currentTargetIsScope: boolean
          data: {
            value: number
          }
          isMessageEvent: boolean
          targetIsScope: boolean
          thisIsScope: boolean
          type: string
        }
      }>(worker, (message) => message.kind === 'inspect-inbound-event:result')

      worker.postMessage({
        kind: 'inspect-inbound-event',
        payload: {
          value: 1,
        },
      })

      await expect(inspectInboundEventResponse).resolves.toEqual({
        kind: 'inspect-inbound-event:result',
        result: {
          constructorName: 'MessageEvent',
          currentTargetIsScope: true,
          data: {
            value: 1,
          },
          isMessageEvent: true,
          targetIsScope: true,
          thisIsScope: true,
          type: 'message',
        },
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('supports worker-thread scope EventTarget listener semantics and scope event handler properties', async () => {
    const worker = createNodeCreateWorkerScopeConformanceWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const installDedupeProbeResponse = waitForNodeWorkerMessage<{
        kind: 'install-dedupe-probe:result'
      }>(worker, (message) => message.kind === 'install-dedupe-probe:result')

      worker.postMessage({
        kind: 'install-dedupe-probe',
      })

      await expect(installDedupeProbeResponse).resolves.toEqual({
        kind: 'install-dedupe-probe:result',
      })

      const dedupeProbeResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-dedupe-probe:result'
      }>(worker, (message) => message.kind === 'trigger-dedupe-probe:result')

      worker.postMessage({
        kind: 'trigger-dedupe-probe',
      })

      await expect(dedupeProbeResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-dedupe-probe:result',
      })

      const installObjectListenerProbeResponse = waitForNodeWorkerMessage<{
        kind: 'install-object-listener-probe:result'
      }>(worker, (message) => message.kind === 'install-object-listener-probe:result')

      worker.postMessage({
        kind: 'install-object-listener-probe',
      })

      await expect(installObjectListenerProbeResponse).resolves.toEqual({
        kind: 'install-object-listener-probe:result',
      })

      const objectListenerProbeResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-object-listener-probe:result'
      }>(worker, (message) => message.kind === 'trigger-object-listener-probe:result')

      worker.postMessage({
        kind: 'trigger-object-listener-probe',
      })

      await expect(objectListenerProbeResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-object-listener-probe:result',
      })

      const removeObjectListenerProbeResponse = waitForNodeWorkerMessage<{
        kind: 'remove-object-listener-probe:result'
      }>(worker, (message) => message.kind === 'remove-object-listener-probe:result')

      worker.postMessage({
        kind: 'remove-object-listener-probe',
      })

      await expect(removeObjectListenerProbeResponse).resolves.toEqual({
        kind: 'remove-object-listener-probe:result',
      })

      const objectListenerProbeAfterRemovalResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-object-listener-probe:result'
      }>(worker, (message) => message.kind === 'trigger-object-listener-probe:result')

      worker.postMessage({
        kind: 'trigger-object-listener-probe',
      })

      await expect(objectListenerProbeAfterRemovalResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-object-listener-probe:result',
      })

      const installOnceProbeResponse = waitForNodeWorkerMessage<{
        kind: 'install-once-probe:result'
      }>(worker, (message) => message.kind === 'install-once-probe:result')

      worker.postMessage({
        kind: 'install-once-probe',
      })

      await expect(installOnceProbeResponse).resolves.toEqual({
        kind: 'install-once-probe:result',
      })

      const firstOnceProbeResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-once-probe:result'
      }>(worker, (message) => message.kind === 'trigger-once-probe:result')

      worker.postMessage({
        kind: 'trigger-once-probe',
      })

      await expect(firstOnceProbeResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-once-probe:result',
      })

      const secondOnceProbeResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-once-probe:result'
      }>(worker, (message) => message.kind === 'trigger-once-probe:result')

      worker.postMessage({
        kind: 'trigger-once-probe',
      })

      await expect(secondOnceProbeResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-once-probe:result',
      })

      const installCaptureProbeResponse = waitForNodeWorkerMessage<{
        kind: 'install-capture-probe:result'
      }>(worker, (message) => message.kind === 'install-capture-probe:result')

      worker.postMessage({
        kind: 'install-capture-probe',
      })

      await expect(installCaptureProbeResponse).resolves.toEqual({
        kind: 'install-capture-probe:result',
      })

      const captureProbeResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-capture-probe:result'
      }>(worker, (message) => message.kind === 'trigger-capture-probe:result')

      worker.postMessage({
        kind: 'trigger-capture-probe',
      })

      await expect(captureProbeResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-capture-probe:result',
      })

      const removeCaptureProbeResponse = waitForNodeWorkerMessage<{
        kind: 'remove-capture-probe:result'
      }>(worker, (message) => message.kind === 'remove-capture-probe:result')

      worker.postMessage({
        kind: 'remove-capture-probe',
      })

      await expect(removeCaptureProbeResponse).resolves.toEqual({
        kind: 'remove-capture-probe:result',
      })

      const captureProbeAfterRemovalResponse = waitForNodeWorkerMessage<{
        count: number
        kind: 'trigger-capture-probe:result'
      }>(worker, (message) => message.kind === 'trigger-capture-probe:result')

      worker.postMessage({
        kind: 'trigger-capture-probe',
      })

      await expect(captureProbeAfterRemovalResponse).resolves.toEqual({
        count: 1,
        kind: 'trigger-capture-probe:result',
      })

      const installOnmessageProbeResponse = waitForNodeWorkerMessage<{
        kind: 'install-onmessage-probe:result'
      }>(worker, (message) => message.kind === 'install-onmessage-probe:result')

      worker.postMessage({
        kind: 'install-onmessage-probe',
      })

      await expect(installOnmessageProbeResponse).resolves.toEqual({
        kind: 'install-onmessage-probe:result',
      })

      const onmessageProbeResponse = waitForNodeWorkerMessage<{
        kind: 'trigger-onmessage-probe:result'
        payload: string
      }>(worker, (message) => message.kind === 'trigger-onmessage-probe:result')

      worker.postMessage({
        kind: 'trigger-onmessage-probe',
        payload: 'ping',
      })

      await expect(onmessageProbeResponse).resolves.toEqual({
        kind: 'trigger-onmessage-probe:result',
        payload: 'ping',
      })

      const scopeOnerrorProbeResponse = waitForNodeWorkerMessage<{
        currentTargetIsScope: boolean
        kind: 'probe-scope-onerror:result'
        targetIsScope: boolean
        type: string
      }>(worker, (message) => message.kind === 'probe-scope-onerror:result')

      worker.postMessage({
        kind: 'probe-scope-onerror',
      })

      await expect(scopeOnerrorProbeResponse).resolves.toEqual({
        currentTargetIsScope: true,
        kind: 'probe-scope-onerror:result',
        targetIsScope: true,
        type: 'error',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('dispatches inbound worker-thread messages without an extra synthetic task hop', async () => {
    const worker = createNodeCreateWorkerScopeOrderingWorker()

    try {
      const response = waitForNodeWorkerMessage<{
        events: string[]
        kind: 'timing-probe:result'
      }>(worker, (message) => message.kind === 'timing-probe:result')

      worker.postMessage({
        kind: 'timing-probe',
      })

      await expect(response).resolves.toEqual({
        events: ['raw:listener', 'scope:onmessage:worker-thread', 'raw:microtask', 'raw:timeout'],
        kind: 'timing-probe:result',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('does not use the synthetic MessageChannel scheduler for ordinary outbound worker-thread messages', async () => {
    const worker = createNodeCreateWorkerScopeOutboundOrderingWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const outboundMessageResponse = waitForNodeWorkerMessage<{
        kind: 'outbound-scheduler-probe:message'
      }>(worker, (message) => message.kind === 'outbound-scheduler-probe:message')
      const outboundDeltaResponse = waitForNodeWorkerMessage<{
        delta: number
        kind: 'outbound-scheduler-probe:delta'
      }>(worker, (message) => message.kind === 'outbound-scheduler-probe:delta')

      worker.postMessage({
        kind: 'outbound-scheduler-probe',
      })

      await expect(outboundMessageResponse).resolves.toEqual({
        kind: 'outbound-scheduler-probe:message',
      })
      await expect(outboundDeltaResponse).resolves.toEqual({
        delta: 0,
        kind: 'outbound-scheduler-probe:delta',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('reports auto-bridged node worker-thread scope failures before worker microtasks run', async () => {
    const worker = createNodeCreateWorkerScopeErrorOrderingWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const observedEvents: Array<
        | {
            channel: 'error'
            message: string
          }
        | {
            channel: 'exit'
            code: number
          }
        | {
            channel: 'message'
            kind: string
          }
      > = []

      const exitResponse = new Promise<void>((resolve) => {
        worker.once('exit', (code) => {
          observedEvents.push({
            channel: 'exit',
            code,
          })
          resolve()
        })
      })
      const errorResponse = new Promise<Error>((resolve) => {
        worker.once('error', (error) => {
          const normalizedError = error instanceof Error ? error : new Error(String(error))

          observedEvents.push({
            channel: 'error',
            message: normalizedError.message,
          })
          resolve(normalizedError)
        })
      })
      const messageListener = (message: { kind?: string }) => {
        observedEvents.push({
          channel: 'message',
          kind: String(message.kind),
        })
      }

      worker.on('message', messageListener)

      expect(() => {
        worker.postMessage({
          kind: 'error-timing-probe',
        })
      }).not.toThrow()

      await expect(errorResponse).resolves.toMatchObject({
        message: 'worker-thread-scope-throw-timing',
      })
      await exitResponse
      worker.off('message', messageListener)

      expect(observedEvents).toEqual([
        {
          channel: 'message',
          kind: 'error-timing-probe:before-throw',
        },
        {
          channel: 'error',
          message: 'worker-thread-scope-throw-timing',
        },
        {
          channel: 'exit',
          code: 1,
        },
      ])
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('reports auto-bridged node worker-thread scope failures via native worker error events', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const errorResponse = new Promise<Error>((resolve) => {
        worker.once('error', (error) => {
          resolve(error instanceof Error ? error : new Error(String(error)))
        })
      })

      expect(() => {
        worker.postMessage({
          kind: 'throw-in-listener',
        })
      }).not.toThrow()

      await expect(errorResponse).resolves.toMatchObject({
        message: 'worker-thread-scope-throw',
      })
    } finally {
      await worker.terminate().then(() => undefined)
    }
  })

  it('closes auto-bridged node worker threads when scope.close() is called', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    await waitForNodeCreateWorkerScopeWorkerInit(worker)

    const exitResponse = new Promise<number>((resolve) => {
      worker.once('exit', resolve)
    })

    worker.postMessage({
      kind: 'close-scope',
    })

    await expect(exitResponse).resolves.toBe(0)
  })

  it('does not force auto-bridged node worker threads to exit when scope.close() leaves extra live refs behind', async () => {
    const worker = createNodeCreateWorkerScopeWorker()

    try {
      await waitForNodeCreateWorkerScopeWorkerInit(worker)

      const beforeCloseResponse = waitForNodeWorkerMessage<{
        kind: 'close-scope-with-live-ref:before-close'
      }>(worker, (message) => message.kind === 'close-scope-with-live-ref:before-close')
      let exitCode: number | undefined

      worker.once('exit', (code) => {
        exitCode = code
      })
      worker.postMessage({
        kind: 'close-scope-with-live-ref',
      })

      await expect(beforeCloseResponse).resolves.toEqual({
        kind: 'close-scope-with-live-ref:before-close',
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 100)
      })

      expect(exitCode).toBeUndefined()

      await expect(worker.terminate()).resolves.not.toBe(0)
    } finally {
      await worker.terminate().catch(() => undefined)
    }
  })
})

describeBrowserOnly('browser dedicated worker semantics', () => {
  it('exposes dedicated-worker globals and event-target APIs on the worker scope', async () => {
    const worker = createBrowserNativeWorker()

    try {
      const response = await requestBrowserWorker(
        worker,
        { kind: 'describe-scope' },
        'describe-scope:result',
      )

      expect(response.result).toEqual({
        hasAddEventListener: true,
        hasClose: true,
        hasOnmessage: true,
        hasOnmessageerror: true,
        hasPostMessage: true,
        hasRemoveEventListener: true,
        selfEqualsGlobalThis: true,
        selfEqualsSelfProperty: true,
        toStringTag: 'DedicatedWorkerGlobalScope',
      })
    } finally {
      worker.terminate()
    }
  })

  it('exposes MessageEvent details on both sides', async () => {
    const worker = createBrowserNativeWorker()

    try {
      let mainThreadCurrentTargetIsWorker: boolean | undefined
      let mainThreadIsMessageEvent = false
      let mainThreadTargetIsWorker: boolean | undefined
      let mainThreadThisIsWorker = false
      let mainThreadType: string | undefined

      worker.addEventListener('message', function onMessage(this: Worker, event) {
        mainThreadCurrentTargetIsWorker = event.currentTarget === worker
        mainThreadIsMessageEvent = event instanceof MessageEvent
        mainThreadTargetIsWorker = event.target === worker
        mainThreadThisIsWorker = this === worker
        mainThreadType = event.type
      })

      const responsePromise = waitForEvent<MessageEvent<WorkerProbeResponse>>(
        worker,
        'message',
        (event) => event.data.kind === 'inspect-inbound-event:result',
      )

      worker.postMessage({
        kind: 'inspect-inbound-event',
        payload: {
          value: 1,
        },
      } satisfies WorkerProbeRequest)

      expect(mainThreadType).toBeUndefined()
      await Promise.resolve()
      expect(mainThreadType).toBeUndefined()

      const response = await responsePromise

      expect(response.data).toEqual({
        kind: 'inspect-inbound-event:result',
        result: {
          constructorName: 'MessageEvent',
          currentTargetIsSelf: true,
          data: {
            value: 1,
          },
          isMessageEvent: true,
          lastEventId: '',
          origin: '',
          portsLength: 0,
          sourceIsNull: true,
          targetIsSelf: true,
          thisIsSelf: true,
          type: 'message',
        },
      })

      expect(mainThreadCurrentTargetIsWorker).toBe(true)
      expect(mainThreadIsMessageEvent).toBe(true)
      expect(mainThreadTargetIsWorker).toBe(true)
      expect(mainThreadThisIsWorker).toBe(true)
      expect(mainThreadType).toBe('message')
    } finally {
      worker.terminate()
    }
  })

  it('supports transfer via the postMessage options overload', async () => {
    const worker = createBrowserNativeWorker()

    try {
      const buffer = new ArrayBuffer(8)
      const transferResponse = waitForEvent<MessageEvent<WorkerProbeResponse>>(
        worker,
        'message',
        (event) => event.data.kind === 'inspect-transfer-array-buffer:result',
      )

      worker.postMessage(
        {
          kind: 'inspect-transfer-array-buffer',
          payload: buffer,
        } satisfies WorkerProbeRequest,
        {
          transfer: [buffer],
        },
      )

      expect(buffer.byteLength).toBe(0)
      await expect(transferResponse).resolves.toMatchObject({
        data: {
          byteLength: 8,
          kind: 'inspect-transfer-array-buffer:result',
        },
      })
    } finally {
      worker.terminate()
    }
  })

  it('deduplicates identical listeners, supports handleEvent listeners, and supports onmessage', async () => {
    const worker = createBrowserNativeWorker()

    try {
      await requestBrowserWorker(
        worker,
        { kind: 'install-dedupe-probe' },
        'install-dedupe-probe:result',
      )
      await expect(
        requestBrowserWorker(
          worker,
          { kind: 'trigger-dedupe-probe' },
          'trigger-dedupe-probe:result',
        ),
      ).resolves.toEqual({
        count: 1,
        kind: 'trigger-dedupe-probe:result',
      })

      await requestBrowserWorker(
        worker,
        { kind: 'install-object-listener-probe' },
        'install-object-listener-probe:result',
      )
      await expect(
        requestBrowserWorker(
          worker,
          { kind: 'trigger-object-listener-probe' },
          'trigger-object-listener-probe:result',
        ),
      ).resolves.toEqual({
        count: 1,
        kind: 'trigger-object-listener-probe:result',
      })

      await requestBrowserWorker(
        worker,
        { kind: 'remove-object-listener-probe' },
        'remove-object-listener-probe:result',
      )
      await expect(
        requestBrowserWorker(
          worker,
          { kind: 'trigger-object-listener-probe' },
          'trigger-object-listener-probe:result',
        ),
      ).resolves.toEqual({
        count: 1,
        kind: 'trigger-object-listener-probe:result',
      })

      await requestBrowserWorker(
        worker,
        { kind: 'install-onmessage-probe' },
        'install-onmessage-probe:result',
      )
      await expect(
        requestBrowserWorker(
          worker,
          {
            kind: 'trigger-onmessage-probe',
            payload: 'ping',
          },
          'trigger-onmessage-probe:result',
        ),
      ).resolves.toEqual({
        kind: 'trigger-onmessage-probe:result',
        payload: 'ping',
      })
    } finally {
      worker.terminate()
    }
  })

  it('uses the native worker scope when createWorkerScope runs inside a dedicated worker', async () => {
    const worker = createBrowserCreateWorkerScopeWorker()

    try {
      await expect(
        waitForEvent<
          MessageEvent<{
            kind: 'init'
            returnedUndefined: boolean
            scopeIsSelf: boolean
            type: 'dedicated-worker'
          }>
        >(worker, 'message', (event) => event.data.kind === 'init'),
      ).resolves.toMatchObject({
        data: {
          kind: 'init',
          returnedUndefined: true,
          scopeIsSelf: true,
          type: 'dedicated-worker',
        },
      })

      const echoResponse = waitForEvent<
        MessageEvent<{
          kind: 'echo'
          payload: string
        }>
      >(worker, 'message', (event) => event.data.kind === 'echo')

      worker.postMessage('ping')

      await expect(echoResponse).resolves.toMatchObject({
        data: {
          kind: 'echo',
          payload: 'ping',
        },
      })
    } finally {
      worker.terminate()
    }
  })
})

describeBrowserOnly('createWorkerScope worker-thread detection fallback', () => {
  it('falls back to the in-process branch when process.getBuiltinModule is unavailable', () => {
    const previousProcessDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')

    Object.defineProperty(globalThis, 'process', {
      configurable: true,
      value: {},
      writable: true,
    })

    try {
      let callbackArgument: Parameters<Parameters<typeof createWorkerScope>[0]>[0] | undefined

      const worker = createWorkerScope((scope) => {
        callbackArgument = scope
      })

      expect(worker).toBeDefined()
      expect(callbackArgument?.type).toBe('in-process')
      expect(callbackArgument?.scope).toBeDefined()

      worker!.terminate()
    } finally {
      if (previousProcessDescriptor === undefined) {
        Reflect.deleteProperty(globalThis, 'process')
      } else {
        Object.defineProperty(globalThis, 'process', previousProcessDescriptor)
      }
    }
  })
})

describeRuntime('createWorkerScope synthetic worker semantics', () => {
  it('returns a synthetic worker that delivers messages asynchronously as MessageEvents', async () => {
    let scopeReference: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined
    let scopeRuntimeType: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['type'] | undefined
    const worker = createWorkerScope(({ scope, type }) => {
      scopeReference = scope
      scopeRuntimeType = type
      scope.addEventListener('message', function onMessage(this: typeof scope, event) {
        scope.postMessage({
          payload: (event as MessageEvent<{ value: number }>).data,
          targetIsScope: event.target === scope,
          thisIsScope: this === scope,
        })
      })
    })

    expect(worker).toBeDefined()
    expect(scopeReference).toBeDefined()
    expect(scopeRuntimeType).toBe('in-process')

    let workerIsMessageEvent = false
    let workerThisIsWorker = false
    let workerType: string | undefined

    const responsePromise = waitForEvent<
      MessageEvent<{
        payload: { value: number }
        targetIsScope: boolean
        thisIsScope: boolean
      }>
    >(worker!, 'message', (event) => event.data.payload.value === 1)

    worker!.addEventListener('message', function onMessage(this: typeof worker, event) {
      workerIsMessageEvent = event instanceof MessageEvent
      workerThisIsWorker = this === worker
      workerType = event.type
    })

    worker!.postMessage({
      value: 1,
    })

    expect(workerType).toBeUndefined()
    await Promise.resolve()
    expect(workerType).toBeUndefined()

    const response = await responsePromise

    expect(response).toBeInstanceOf(MessageEvent)
    expect(response.type).toBe('message')
    expect(workerIsMessageEvent).toBe(true)
    expect(workerThisIsWorker).toBe(true)
    expect(workerType).toBe('message')
    expect(response.data).toEqual({
      payload: {
        value: 1,
      },
      targetIsScope: true,
      thisIsScope: true,
    })
  })

  it('passes synthetic worker messages by reference and accepts non-cloneable values by default', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<unknown>).data)
      }
    })

    expect(worker).toBeDefined()

    const payload = {
      nested: {
        value: 1,
      },
    }

    const echoResponse = waitForEvent<MessageEvent<typeof payload>>(
      worker!,
      'message',
      (event) => event.data.nested?.value === 2,
    )

    worker!.postMessage(payload)
    payload.nested.value = 2

    const echoedPayload = await echoResponse

    expect(echoedPayload.data).toBe(payload)
    expect(echoedPayload.data.nested.value).toBe(2)

    const functionResponse = waitForEvent<MessageEvent<typeof returnOk>>(
      worker!,
      'message',
      (event) => event.data === returnOk,
    )

    expect(() => {
      worker!.postMessage(returnOk)
    }).not.toThrow()

    await expect(functionResponse).resolves.toMatchObject({
      data: returnOk,
    })
  })

  it('ignores transfer lists when structuredClone is disabled by default', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<unknown>).data)
      }
    })

    expect(worker).toBeDefined()

    const listBuffer = new ArrayBuffer(4)
    const listTransferResponse = waitForEvent<MessageEvent<ArrayBuffer>>(
      worker!,
      'message',
      (event) => event.data === listBuffer,
    )

    worker!.postMessage(listBuffer, [listBuffer])

    expect(listBuffer.byteLength).toBe(4)
    await expect(listTransferResponse).resolves.toMatchObject({
      data: listBuffer,
    })

    const optionsBuffer = new ArrayBuffer(4)
    const optionsTransferResponse = waitForEvent<MessageEvent<ArrayBuffer>>(
      worker!,
      'message',
      (event) => event.data === optionsBuffer,
    )

    worker!.postMessage(optionsBuffer, {
      transfer: [optionsBuffer],
    })

    expect(optionsBuffer.byteLength).toBe(4)
    await expect(optionsTransferResponse).resolves.toMatchObject({
      data: optionsBuffer,
    })
  })

  it('supports structured cloning, transfer lists, and DataCloneError parity for synthetic worker messaging when enabled', async () => {
    const worker = createStructuredCloneSyntheticWorker(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<unknown>).data)
      }
    })

    expect(worker).toBeDefined()

    const payload = {
      nested: {
        value: 1,
      },
    }

    const echoResponse = waitForEvent<MessageEvent<typeof payload>>(
      worker!,
      'message',
      (event) => event.data.nested?.value === 1,
    )

    worker!.postMessage(payload)
    payload.nested.value = 2

    await expect(echoResponse).resolves.toMatchObject({
      data: {
        nested: {
          value: 1,
        },
      },
    })

    const thrownError = getThrownError(() => {
      worker!.postMessage(() => undefined)
    })

    expect(thrownError).toBeDefined()
    expect((thrownError as { name?: string }).name).toBe('DataCloneError')

    const buffer = new ArrayBuffer(4)
    const transferResponse = waitForEvent<MessageEvent<ArrayBuffer>>(
      worker!,
      'message',
      (event) => event.data.byteLength === 4,
    )

    worker!.postMessage(buffer, [buffer])

    expect(buffer.byteLength).toBe(0)
    const response = await transferResponse

    expect(response.data).toBeInstanceOf(ArrayBuffer)
    expect(response.data.byteLength).toBe(4)
  })

  it('supports the postMessage options transfer overload for synthetic worker messaging when enabled', async () => {
    const worker = createStructuredCloneSyntheticWorker(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<unknown>).data)
      }
    })

    expect(worker).toBeDefined()

    const buffer = new ArrayBuffer(4)
    const transferResponse = waitForEvent<MessageEvent<ArrayBuffer>>(
      worker!,
      'message',
      (event) => event.data.byteLength === 4,
    )

    worker!.postMessage(buffer, {
      transfer: [buffer],
    })

    expect(buffer.byteLength).toBe(0)
    const response = await transferResponse

    expect(response.data).toBeInstanceOf(ArrayBuffer)
    expect(response.data.byteLength).toBe(4)
  })

  it('supports onmessage on both endpoints plus EventTarget listener semantics', async () => {
    const workerMessages: string[] = []
    const scopeMessages: string[] = []
    let scopeReference: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined

    const onScopeMessage = (event: Event) => {
      appendStringMessage(scopeMessages, 'listener', event)
    }

    const worker = createWorkerScope(({ scope }) => {
      scopeReference = scope

      scope.addEventListener('message', onScopeMessage)
      scope.addEventListener('message', onScopeMessage)

      scope.onmessage = (event) => {
        const value = String((event as MessageEvent<string>).data)

        scopeMessages.push(`onmessage:${value}`)
        scope.postMessage(`echo:${value}`)
      }
    })

    expect(worker).toBeDefined()
    expect(scopeReference).toBeDefined()

    const handleEventListener = {
      handleEvent(event: Event) {
        appendStringMessage(workerMessages, 'handleEvent', event)
      },
    }

    worker!.addEventListener('message', handleEventListener)
    worker!.onmessage = (event) => {
      workerMessages.push(`onmessage:${String((event as MessageEvent<string>).data)}`)
    }

    const pingResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'echo:ping',
    )

    worker!.postMessage('ping')
    await pingResponse

    expect(scopeMessages).toEqual(['listener:ping', 'onmessage:ping'])
    expect(workerMessages).toEqual(['handleEvent:echo:ping', 'onmessage:echo:ping'])

    worker!.removeEventListener('message', handleEventListener)

    const pongResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'echo:pong',
    )

    worker!.postMessage('pong')
    await pongResponse

    expect(scopeMessages).toEqual([
      'listener:ping',
      'onmessage:ping',
      'listener:pong',
      'onmessage:pong',
    ])
    expect(workerMessages).toEqual([
      'handleEvent:echo:ping',
      'onmessage:echo:ping',
      'onmessage:echo:pong',
    ])
  })

  it('supports once listeners for synthetic worker message events', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(worker).toBeDefined()

    let callCount = 0

    worker!.addEventListener(
      'message',
      () => {
        callCount += 1
      },
      {
        once: true,
      },
    )

    const firstResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'ping',
    )

    worker!.postMessage('ping')
    await firstResponse

    const secondResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'pong',
    )

    worker!.postMessage('pong')
    await secondResponse

    expect(callCount).toBe(1)
  })

  it('matches removeEventListener by capture flag in synthetic worker messaging', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(worker).toBeDefined()

    let callCount = 0

    const listener = () => {
      callCount += 1
    }

    worker!.addEventListener('message', listener, { capture: false })
    worker!.addEventListener('message', listener, { capture: true })
    worker!.removeEventListener('message', listener, { capture: false })

    const firstResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'ping',
    )

    worker!.postMessage('ping')
    await firstResponse

    expect(callCount).toBe(1)

    worker!.removeEventListener('message', listener, { capture: true })

    const secondResponse = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'pong',
    )

    worker!.postMessage('pong')
    await secondResponse

    expect(callCount).toBe(1)
  })

  it('accepts null listeners and boolean capture flags for synthetic worker EventTarget methods', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(worker).toBeDefined()

    if (isBrowserProject) {
      worker!.addEventListener('message', null)
      worker!.removeEventListener('message', null)
    }

    let callCount = 0

    const listener = () => {
      callCount += 1
    }

    worker!.addEventListener('message', listener, false)
    worker!.addEventListener('message', listener, true)
    worker!.removeEventListener('message', listener, false)
    worker!.removeEventListener('message', () => undefined, true)

    const response = waitForEvent<MessageEvent<string>>(
      worker!,
      'message',
      (event) => event.data === 'ping',
    )

    worker!.postMessage('ping')
    await response

    expect(callCount).toBe(1)
  })

  it('exposes worker event-handler properties and removes replaced handlers', () => {
    const worker = createWorkerScope(() => undefined)

    expect(worker).toBeDefined()
    expect(worker!.onmessage).toBeNull()
    expect(worker!.onerror).toBeNull()

    const seen: string[] = []

    const onMessage = (event: MessageEvent<string>) => {
      seen.push(`message:${event.data}`)
    }
    const onError = () => {
      seen.push('error:first')
    }
    const replacementError = () => {
      seen.push('error:second')
    }

    worker!.onmessage = onMessage
    worker!.onerror = onError

    expect(worker!.onmessage).toBe(onMessage)
    expect(worker!.onerror).toBe(onError)

    worker!.dispatchEvent(new MessageEvent('message', { data: 'ping' }))
    worker!.dispatchEvent(new Event('error'))

    worker!.onerror = replacementError

    expect(worker!.onerror).toBe(replacementError)

    worker!.dispatchEvent(new Event('error'))

    worker!.onmessage = null
    worker!.onerror = null

    expect(worker!.onmessage).toBeNull()
    expect(worker!.onerror).toBeNull()

    worker!.dispatchEvent(new MessageEvent('message', { data: 'ignored' }))
    worker!.dispatchEvent(new Event('error'))

    expect(seen).toEqual(['message:ping', 'error:first', 'error:second'])
  })

  it('drops scheduled synthetic worker messages and worker-error delivery after termination races', async () => {
    let messageScope: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined

    const worker = createWorkerScope(({ scope }) => {
      messageScope = scope
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(worker).toBeDefined()
    expect(messageScope).toBeDefined()

    const workerMessages: string[] = []

    worker!.addEventListener('message', (event) => {
      workerMessages.push((event as MessageEvent<string>).data)
    })

    worker!.postMessage('drop-me')
    worker!.terminate()
    await flushTasks()

    expect(workerMessages).toEqual([])

    let errorScope: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined

    const workerWithFailingScope = createWorkerScope(({ scope }) => {
      errorScope = scope
      scope.onmessage = () => {
        throw new Error('scope-race-throw')
      }
    })

    expect(workerWithFailingScope).toBeDefined()
    expect(errorScope).toBeDefined()

    let sawWorkerError = false

    workerWithFailingScope!.addEventListener('error', () => {
      sawWorkerError = true
    })

    errorScope!.dispatchEvent(new MessageEvent('message', { data: 'trigger-error' }))
    workerWithFailingScope!.terminate()
    await flushTasks()

    expect(sawWorkerError).toBe(false)

    let closedPeerScope: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined

    const workerAfterTerminate = createWorkerScope(({ scope }) => {
      closedPeerScope = scope
      scope.addEventListener('message', () => {
        throw new Error('closed-peer-throw')
      })
    })

    expect(workerAfterTerminate).toBeDefined()
    expect(closedPeerScope).toBeDefined()

    let sawClosedPeerError = false

    workerAfterTerminate!.addEventListener('error', () => {
      sawClosedPeerError = true
    })
    workerAfterTerminate!.terminate()

    expect(() => {
      closedPeerScope!.dispatchEvent(new MessageEvent('message', { data: 'after-terminate' }))
    }).not.toThrow()

    await flushTasks()
    expect(sawClosedPeerError).toBe(false)
  })

  // This intentionally exercises the host uncaught-error path rather than worker-style
  // error remapping. Some runners log the uncaught error to stderr even though the test
  // captures and asserts it, so stderr noise here is expected and not a product bug.
  it('reports non-message synthetic worker listener failures through the host uncaught-error channel', async () => {
    const worker = createWorkerScope(() => undefined)

    expect(worker).toBeDefined()

    const functionListenerError = waitForUnhandledError()

    worker!.addEventListener('custom', () => {
      throw new Error('custom-function-listener-throw')
    })
    worker!.dispatchEvent(new Event('custom'))

    await expect(functionListenerError).resolves.toMatchObject({
      message: 'custom-function-listener-throw',
    })

    const objectListenerError = waitForUnhandledError()

    worker!.addEventListener('custom-object', {
      handleEvent() {
        throw new Error('custom-object-listener-throw')
      },
    })
    worker!.dispatchEvent(new Event('custom-object'))

    await expect(objectListenerError).resolves.toMatchObject({
      message: 'custom-object-listener-throw',
    })

    const propertyHandlerError = waitForUnhandledError()

    worker!.onerror = () => {
      throw new Error('worker-onerror-throw')
    }
    worker!.dispatchEvent(new Event('error'))

    await expect(propertyHandlerError).resolves.toMatchObject({
      message: 'worker-onerror-throw',
    })
  })

  it('reports synthetic worker scope object-listener failures via worker error events', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.addEventListener('message', {
        handleEvent() {
          throw new Error('scope-object-listener-throw')
        },
      })
    })

    expect(worker).toBeDefined()

    const errorEvent = waitForEvent<Event>(worker!, 'error')

    expect(() => {
      worker!.postMessage('ping')
    }).not.toThrow()

    const event = (await errorEvent) as {
      error?: unknown
      message?: string
    } & Event

    expect(event).toMatchObject({
      type: 'error',
    })
    expect(event.message).toBe('scope-object-listener-throw')
    expect(event.error).toBeInstanceOf(Error)
    expect((event.error as Error).message).toBe('scope-object-listener-throw')
  })

  it('reports synthetic worker scope addEventListener failures via worker error events', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.addEventListener('message', () => {
        throw new Error('scope-listener-throw')
      })
    })

    expect(worker).toBeDefined()

    const errorEvent = waitForEvent<Event>(worker!, 'error')

    expect(() => {
      worker!.postMessage('ping')
    }).not.toThrow()

    const event = (await errorEvent) as {
      error?: unknown
      message?: string
    } & Event

    expect(event).toMatchObject({
      type: 'error',
    })
    expect(event.message).toBe('scope-listener-throw')
    expect(event.error).toBeInstanceOf(Error)
    expect((event.error as Error).message).toBe('scope-listener-throw')
  })

  it('reports synthetic worker scope onmessage failures via worker error events', async () => {
    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = () => {
        throw new Error('scope-onmessage-throw')
      }
    })

    expect(worker).toBeDefined()

    const errorEvent = waitForEvent<Event>(worker!, 'error')

    expect(() => {
      worker!.postMessage('ping')
    }).not.toThrow()

    const event = (await errorEvent) as {
      error?: unknown
      message?: string
    } & Event

    expect(event).toMatchObject({
      type: 'error',
    })
    expect(event.message).toBe('scope-onmessage-throw')
    expect(event.error).toBeInstanceOf(Error)
    expect((event.error as Error).message).toBe('scope-onmessage-throw')
  })

  it('stringifies non-Error synthetic worker scope failures on worker error events', async () => {
    const nonErrorThrowable = 'scope-string-throw' as unknown as Error

    const worker = createWorkerScope(({ scope }) => {
      scope.onmessage = () => {
        throw nonErrorThrowable
      }
    })

    expect(worker).toBeDefined()

    const errorEvent = waitForEvent<Event>(worker!, 'error')

    expect(() => {
      worker!.postMessage('ping')
    }).not.toThrow()

    const event = (await errorEvent) as {
      error?: unknown
      message?: string
    } & Event

    expect(event).toMatchObject({
      type: 'error',
    })
    expect(event.message).toBe('scope-string-throw')
    expect(event.error).toBe('scope-string-throw')
  })

  it('supports terminate() and close() as synthetic worker lifecycle boundaries', async () => {
    let scopeReference: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined

    const worker = createWorkerScope(({ scope }) => {
      scopeReference = scope
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(worker).toBeDefined()
    expect(scopeReference).toBeDefined()

    const workerMessages: string[] = []

    worker!.addEventListener('message', (event) => {
      workerMessages.push((event as MessageEvent<string>).data)
    })

    worker!.terminate()
    worker!.postMessage('after-terminate')
    await flushTasks()

    expect(workerMessages).toEqual([])

    const secondWorker = createWorkerScope(({ scope }) => {
      scopeReference = scope
      scope.onmessage = (event) => {
        scope.postMessage((event as MessageEvent<string>).data)
      }
    })

    expect(secondWorker).toBeDefined()
    expect(scopeReference).toBeDefined()

    scopeReference!.close()
    secondWorker!.addEventListener('message', (event) => {
      workerMessages.push((event as MessageEvent<string>).data)
    })
    secondWorker!.postMessage('after-close')
    await flushTasks()

    expect(workerMessages).toEqual([])
  })
})
