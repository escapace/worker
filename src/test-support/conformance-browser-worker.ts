declare let self: DedicatedWorkerGlobalScope

import type { WorkerProbeRequest, WorkerProbeResponse } from './conformance-protocol'

const postResponse = (response: WorkerProbeResponse) => {
  self.postMessage(response)
}

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

self.addEventListener('message', function onMessage(event) {
  const request = event.data as WorkerProbeRequest

  switch (request.kind) {
    case 'describe-scope': {
      const tag = globalThis[
        Symbol.toStringTag as unknown as keyof typeof globalThis
      ] as unknown as string

      postResponse({
        kind: 'describe-scope:result',
        result: {
          hasAddEventListener: typeof self.addEventListener === 'function',
          hasClose: typeof self.close === 'function',
          hasOnmessage: 'onmessage' in self,
          hasOnmessageerror: 'onmessageerror' in self,
          hasPostMessage: typeof self.postMessage === 'function',
          hasRemoveEventListener: typeof self.removeEventListener === 'function',
          selfEqualsGlobalThis: (self as unknown) === (globalThis as unknown),
          selfEqualsSelfProperty: (self.self as unknown) === (self as unknown),
          toStringTag: tag,
        },
      })
      return
    }

    case 'echo': {
      postResponse({
        kind: 'echo:result',
        payload: request.payload,
      })
      return
    }

    case 'inspect-inbound-event': {
      postResponse({
        kind: 'inspect-inbound-event:result',
        result: {
          constructorName: event.constructor.name,
          currentTargetIsSelf: event.currentTarget === self,
          data: request.payload,
          isMessageEvent: event instanceof MessageEvent,
          lastEventId: event.lastEventId,
          origin: event.origin,
          portsLength: event.ports.length,
          sourceIsNull: event.source === null,
          targetIsSelf: event.target === self,
          thisIsSelf: this === self,
          type: event.type,
        },
      })
      return
    }

    case 'inspect-transfer-array-buffer': {
      postResponse({
        byteLength: request.payload.byteLength,
        kind: 'inspect-transfer-array-buffer:result',
      })
      return
    }

    case 'install-dedupe-probe': {
      dedupeCount = 0
      self.removeEventListener('message', dedupeListener)
      self.addEventListener('message', dedupeListener)
      self.addEventListener('message', dedupeListener)
      postResponse({
        kind: 'install-dedupe-probe:result',
      })
      return
    }

    case 'install-object-listener-probe': {
      objectListenerCount = 0
      self.removeEventListener('message', objectListener)
      self.addEventListener('message', objectListener)
      postResponse({
        kind: 'install-object-listener-probe:result',
      })
      return
    }

    case 'install-onmessage-probe': {
      self.onmessage = (messageEvent) => {
        const probe = messageEvent.data as Partial<
          Extract<WorkerProbeRequest, { kind: 'trigger-onmessage-probe' }>
        >

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
      return
    }

    case 'remove-object-listener-probe': {
      self.removeEventListener('message', objectListener)
      postResponse({
        kind: 'remove-object-listener-probe:result',
      })
      return
    }

    case 'trigger-dedupe-probe': {
      setTimeout(() => {
        postResponse({
          count: dedupeCount,
          kind: 'trigger-dedupe-probe:result',
        })
      }, 0)
      return
    }

    case 'trigger-object-listener-probe': {
      setTimeout(() => {
        postResponse({
          count: objectListenerCount,
          kind: 'trigger-object-listener-probe:result',
        })
      }, 0)
      return
    }

    case 'trigger-onmessage-probe': {
      return
    }

    case 'throw-in-listener': {
      throw new Error('worker-listener-throw')
    }
  }
})
