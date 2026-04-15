import type { CreateWorkerScopeContext } from '../types'

const { createWorkerScope } = (await import(
  new URL('../create-worker-scope.ts', import.meta.url).href
)) as typeof import('../create-worker-scope')

let observedScope: CreateWorkerScopeContext['scope'] | undefined
let observedType: CreateWorkerScopeContext['type'] | undefined

const returnedWorker = createWorkerScope(({ scope, type }: CreateWorkerScopeContext) => {
  observedScope = scope
  observedType = type

  scope.onmessage = (event: Event) => {
    const message = (event as MessageEvent<{ kind?: string }>).data

    if (message.kind !== 'error-timing-probe') {
      return
    }

    scope.postMessage({
      kind: 'error-timing-probe:before-throw',
    })
    queueMicrotask(() => {
      scope.postMessage({
        kind: 'error-timing-probe:microtask',
      })
    })
    setTimeout(() => {
      scope.postMessage({
        kind: 'error-timing-probe:timeout',
      })
    }, 0)

    throw new Error('worker-thread-scope-throw-timing')
  }
})

observedScope?.postMessage({
  kind: 'init',
  returnedUndefined: returnedWorker === undefined,
  type: observedType,
})
