import type { CreateWorkerScopeContext } from '../types'

const { createWorkerScope } = (await import(
  new URL('../create-worker-scope.ts', import.meta.url).href
)) as typeof import('../create-worker-scope')

type ScopeProbeRequest =
  | {
      kind: 'describe-scope'
    }
  | {
      kind: 'inspect-inbound-event'
      payload: unknown
    }
  | {
      kind: 'install-capture-probe'
    }
  | {
      kind: 'install-dedupe-probe'
    }
  | {
      kind: 'install-object-listener-probe'
    }
  | {
      kind: 'install-once-probe'
    }
  | {
      kind: 'install-onmessage-probe'
    }
  | {
      kind: 'probe-scope-onerror'
    }
  | {
      kind: 'remove-capture-probe'
    }
  | {
      kind: 'remove-object-listener-probe'
    }
  | {
      kind: 'trigger-capture-probe'
    }
  | {
      kind: 'trigger-dedupe-probe'
    }
  | {
      kind: 'trigger-object-listener-probe'
    }
  | {
      kind: 'trigger-once-probe'
    }
  | {
      kind: 'trigger-onmessage-probe'
      payload: unknown
    }

let observedScope: CreateWorkerScopeContext['scope'] | undefined
let observedType: CreateWorkerScopeContext['type'] | undefined

let dedupeCount = 0
const dedupeListener = () => {
  dedupeCount += 1
}

let objectListenerCount = 0
const objectListener: EventListenerObject = {
  handleEvent() {
    objectListenerCount += 1
  },
}

let onceCount = 0
const onceListener = () => {
  onceCount += 1
}

let captureCount = 0
const captureListener = () => {
  captureCount += 1
}

const returnedWorker = createWorkerScope(({ scope, type }: CreateWorkerScopeContext) => {
  observedScope = scope
  observedType = type

  const dispatchProbeEvent = () => {
    scope.dispatchEvent(new Event('probe'))
  }

  const postResponse = (response: unknown) => {
    scope.postMessage(response)
  }

  scope.addEventListener('message', function onControlMessage(this: typeof scope, event) {
    const request = (event as MessageEvent<ScopeProbeRequest>).data

    switch (request.kind) {
      case 'describe-scope': {
        postResponse({
          kind: 'describe-scope:result',
          result: {
            hasAddEventListener: typeof scope.addEventListener === 'function',
            hasClose: typeof scope.close === 'function',
            hasOnerror: 'onerror' in scope,
            hasOnmessage: 'onmessage' in scope,
            hasPostMessage: typeof scope.postMessage === 'function',
            hasRemoveEventListener: typeof scope.removeEventListener === 'function',
          },
        })
        return
      }

      case 'inspect-inbound-event': {
        postResponse({
          kind: 'inspect-inbound-event:result',
          result: {
            constructorName: event.constructor.name,
            currentTargetIsScope: event.currentTarget === scope,
            data: request.payload,
            isMessageEvent: event instanceof MessageEvent,
            targetIsScope: event.target === scope,
            thisIsScope: this === scope,
            type: event.type,
          },
        })
        return
      }

      case 'install-capture-probe': {
        captureCount = 0
        scope.removeEventListener('probe', captureListener, { capture: false })
        scope.removeEventListener('probe', captureListener, { capture: true })
        scope.addEventListener('probe', captureListener, { capture: false })
        scope.addEventListener('probe', captureListener, { capture: true })
        scope.removeEventListener('probe', captureListener, { capture: false })
        postResponse({
          kind: 'install-capture-probe:result',
        })
        return
      }

      case 'install-dedupe-probe': {
        dedupeCount = 0
        scope.removeEventListener('probe', dedupeListener)
        scope.addEventListener('probe', dedupeListener)
        scope.addEventListener('probe', dedupeListener)
        postResponse({
          kind: 'install-dedupe-probe:result',
        })
        return
      }

      case 'install-object-listener-probe': {
        objectListenerCount = 0
        scope.removeEventListener('probe', objectListener)
        scope.addEventListener('probe', objectListener)
        postResponse({
          kind: 'install-object-listener-probe:result',
        })
        return
      }

      case 'install-once-probe': {
        onceCount = 0
        scope.removeEventListener('probe', onceListener)
        scope.addEventListener('probe', onceListener, {
          once: true,
        })
        postResponse({
          kind: 'install-once-probe:result',
        })
        return
      }

      case 'install-onmessage-probe': {
        queueMicrotask(() => {
          scope.onmessage = (messageEvent) => {
            const probe = (messageEvent as MessageEvent<Partial<ScopeProbeRequest>>).data

            if (probe.kind === 'trigger-onmessage-probe') {
              postResponse({
                kind: 'trigger-onmessage-probe:result',
                payload: probe.payload,
              })
            }
          }

          postResponse({
            kind: 'install-onmessage-probe:result',
          })
        })
        return
      }

      case 'probe-scope-onerror': {
        scope.onerror = (errorEvent) => {
          postResponse({
            currentTargetIsScope: errorEvent.currentTarget === scope,
            kind: 'probe-scope-onerror:result',
            targetIsScope: errorEvent.target === scope,
            type: errorEvent.type,
          })
        }
        scope.dispatchEvent(new Event('error'))
        scope.onerror = null
        return
      }

      case 'remove-capture-probe': {
        scope.removeEventListener('probe', captureListener, { capture: true })
        postResponse({
          kind: 'remove-capture-probe:result',
        })
        return
      }

      case 'remove-object-listener-probe': {
        scope.removeEventListener('probe', objectListener)
        postResponse({
          kind: 'remove-object-listener-probe:result',
        })
        return
      }

      case 'trigger-capture-probe': {
        dispatchProbeEvent()
        postResponse({
          count: captureCount,
          kind: 'trigger-capture-probe:result',
        })
        return
      }

      case 'trigger-dedupe-probe': {
        dispatchProbeEvent()
        postResponse({
          count: dedupeCount,
          kind: 'trigger-dedupe-probe:result',
        })
        return
      }

      case 'trigger-object-listener-probe': {
        dispatchProbeEvent()
        postResponse({
          count: objectListenerCount,
          kind: 'trigger-object-listener-probe:result',
        })
        return
      }

      case 'trigger-once-probe': {
        dispatchProbeEvent()
        postResponse({
          count: onceCount,
          kind: 'trigger-once-probe:result',
        })
        return
      }

      case 'trigger-onmessage-probe': {
        return
      }
    }
  })
})

observedScope?.postMessage({
  kind: 'init',
  returnedUndefined: returnedWorker === undefined,
  type: observedType,
})
