import type { CreateWorkerScopeContext } from '../types'

const { createWorkerScope } = (await import(
  new URL('../create-worker-scope.ts', import.meta.url).href
)) as typeof import('../create-worker-scope')

let observedScope: CreateWorkerScopeContext['scope'] | undefined
let observedType: CreateWorkerScopeContext['type'] | undefined

const returnedWorker = createWorkerScope(({ scope, type }: CreateWorkerScopeContext) => {
  observedType = type
  observedScope = scope

  scope.onmessage = (event: Event) => {
    const message = (event as MessageEvent<unknown>).data as {
      kind?: string
      payload?: ArrayBuffer | undefined
    }

    switch (message.kind) {
      case 'close-scope': {
        scope.close()
        return
      }

      case 'close-scope-with-live-ref': {
        setInterval(() => undefined, 1000)
        scope.postMessage({
          kind: 'close-scope-with-live-ref:before-close',
        })
        scope.close()
        return
      }

      case 'echo': {
        scope.postMessage({
          kind: 'echo:result',
          payload: message.payload,
        })
        return
      }

      case 'inspect-transfer-array-buffer': {
        scope.postMessage({
          byteLength: message.payload!.byteLength,
          kind: 'inspect-transfer-array-buffer:result',
        })
        return
      }

      case 'outbound-transfer-array-buffer': {
        const buffer = new ArrayBuffer(8)

        scope.postMessage(
          {
            buffer,
            kind: 'outbound-transfer-array-buffer:result',
          },
          [buffer],
        )
        scope.postMessage({
          byteLength: buffer.byteLength,
          kind: 'outbound-transfer-array-buffer:after',
        })
        return
      }

      case 'outbound-transfer-array-buffer-options': {
        const buffer = new ArrayBuffer(8)

        scope.postMessage(
          {
            buffer,
            kind: 'outbound-transfer-array-buffer-options:result',
          },
          {
            transfer: [buffer],
          },
        )
        scope.postMessage({
          byteLength: buffer.byteLength,
          kind: 'outbound-transfer-array-buffer-options:after',
        })
        return
      }

      case 'throw-in-listener': {
        throw new Error('worker-thread-scope-throw')
      }

      default: {
        scope.postMessage({
          kind: 'unsupported-request',
          payload: message,
        })
      }
    }
  }
})

observedScope?.postMessage({
  kind: 'init',
  returnedUndefined: returnedWorker === undefined,
  type: observedType,
})
