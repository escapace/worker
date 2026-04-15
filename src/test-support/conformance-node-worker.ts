import { parentPort } from 'node:worker_threads'
import type { WorkerProbeRequest } from './conformance-protocol'

if (parentPort == null) {
  throw new Error('parentPort missing')
}

const port = parentPort

port.on('message', (request: WorkerProbeRequest) => {
  switch (request.kind) {
    case 'echo': {
      port.postMessage({
        kind: 'echo:result',
        payload: request.payload,
      })
      return
    }

    case 'inspect-transfer-array-buffer': {
      port.postMessage({
        byteLength: request.payload.byteLength,
        kind: 'inspect-transfer-array-buffer:result',
      })
      return
    }

    case 'throw-in-listener': {
      throw new Error('worker-listener-throw')
    }

    default: {
      throw new Error(`unsupported-request:${request.kind}`)
    }
  }
})
