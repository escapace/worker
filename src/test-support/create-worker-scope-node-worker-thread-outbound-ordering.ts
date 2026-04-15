const NativeMessageChannel = MessageChannel
let scheduledPostCount = 0

const InstrumentedMessageChannel = function MessageChannelInstrumented() {
  const channel = new NativeMessageChannel()
  const port2PostMessage = channel.port2.postMessage.bind(channel.port2)

  channel.port2.postMessage = ((message: unknown) => {
    scheduledPostCount += 1
    return port2PostMessage(message)
  }) as typeof channel.port2.postMessage

  return channel
} as unknown as typeof MessageChannel

Object.defineProperty(globalThis, 'MessageChannel', {
  configurable: true,
  value: InstrumentedMessageChannel,
})

const workerThreads = (
  globalThis as {
    process?: {
      getBuiltinModule?: (name: string) => unknown
    }
  } & typeof globalThis
).process?.getBuiltinModule?.('node:worker_threads') as
  | {
      parentPort?: {
        on: (type: 'message', listener: (message: unknown) => void) => void
        postMessage: (message: unknown) => void
      } | null
    }
  | undefined

const parentPort = workerThreads?.parentPort

if (parentPort == null) {
  throw new Error('parentPort missing')
}

const { createWorkerScope } = (await import(
  new URL('../create-worker-scope.ts', import.meta.url).href
)) as typeof import('../create-worker-scope')

let observedScope: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['scope'] | undefined
let observedType: Parameters<Parameters<typeof createWorkerScope>[0]>[0]['type'] | undefined

const returnedWorker = createWorkerScope(({ scope, type }) => {
  observedScope = scope
  observedType = type

  scope.onmessage = (event) => {
    if ((event as MessageEvent<{ kind?: string }>).data.kind !== 'outbound-scheduler-probe') {
      return
    }

    const before = scheduledPostCount

    scope.postMessage({
      kind: 'outbound-scheduler-probe:message',
    })

    parentPort.postMessage({
      delta: scheduledPostCount - before,
      kind: 'outbound-scheduler-probe:delta',
    })
  }
})

observedScope?.postMessage({
  kind: 'init',
  returnedUndefined: returnedWorker === undefined,
  type: observedType,
})
