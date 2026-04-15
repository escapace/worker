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

const events: string[] = []

parentPort.on('message', (message: unknown) => {
  const request = message as { kind?: string }

  if (request.kind !== 'timing-probe') {
    return
  }

  events.push('raw:listener')
  queueMicrotask(() => {
    events.push('raw:microtask')
  })
  setTimeout(() => {
    events.push('raw:timeout')
    parentPort.postMessage({
      events: [...events],
      kind: 'timing-probe:result',
    })
  }, 0)
})

createWorkerScope(({ scope, type }) => {
  scope.onmessage = (event) => {
    if ((event as MessageEvent<{ kind?: string }>).data.kind !== 'timing-probe') {
      return
    }

    events.push(`scope:onmessage:${type}`)
  }
})
