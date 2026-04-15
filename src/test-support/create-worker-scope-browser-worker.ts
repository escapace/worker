declare let self: DedicatedWorkerGlobalScope

import { createWorkerScope } from '../create-worker-scope'

let observedScopeIsSelf: boolean | undefined
let observedType: 'dedicated-worker' | 'in-process' | 'worker-thread' | undefined

const returnedWorker = createWorkerScope(({ scope, type }) => {
  observedType = type
  observedScopeIsSelf = (scope as unknown) === (self as unknown)

  scope.onmessage = (event) => {
    scope.postMessage({
      kind: 'echo',
      payload: (event as MessageEvent<unknown>).data,
    })
  }
})

self.postMessage({
  kind: 'init',
  returnedUndefined: returnedWorker === undefined,
  scopeIsSelf: observedScopeIsSelf,
  type: observedType,
})
