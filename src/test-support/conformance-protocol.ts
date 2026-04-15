export type WorkerProbeRequest =
  | {
      kind: 'describe-scope'
    }
  | {
      kind: 'echo'
      payload: unknown
    }
  | {
      kind: 'inspect-inbound-event'
      payload: unknown
    }
  | {
      kind: 'inspect-transfer-array-buffer'
      payload: ArrayBuffer
    }
  | {
      kind: 'install-dedupe-probe'
    }
  | {
      kind: 'install-object-listener-probe'
    }
  | {
      kind: 'install-onmessage-probe'
    }
  | {
      kind: 'remove-object-listener-probe'
    }
  | {
      kind: 'throw-in-listener'
    }
  | {
      kind: 'trigger-dedupe-probe'
    }
  | {
      kind: 'trigger-object-listener-probe'
    }
  | {
      kind: 'trigger-onmessage-probe'
      payload: unknown
    }

export type WorkerProbeResponse =
  | {
      byteLength: number
      kind: 'inspect-transfer-array-buffer:result'
    }
  | {
      count: number
      kind: 'trigger-dedupe-probe:result'
    }
  | {
      count: number
      kind: 'trigger-object-listener-probe:result'
    }
  | {
      kind: 'describe-scope:result'
      result: {
        hasAddEventListener: boolean
        hasClose: boolean
        hasOnmessage: boolean
        hasOnmessageerror: boolean
        hasPostMessage: boolean
        hasRemoveEventListener: boolean
        selfEqualsGlobalThis: boolean
        selfEqualsSelfProperty: boolean
        toStringTag: string
      }
    }
  | {
      kind: 'echo:result'
      payload: unknown
    }
  | {
      kind: 'inspect-inbound-event:result'
      result: {
        constructorName: string
        currentTargetIsSelf: boolean
        data: unknown
        isMessageEvent: boolean
        lastEventId: string
        origin: string
        portsLength: number
        sourceIsNull: boolean
        targetIsSelf: boolean
        thisIsSelf: boolean
        type: string
      }
    }
  | {
      kind: 'install-dedupe-probe:result'
    }
  | {
      kind: 'install-object-listener-probe:result'
    }
  | {
      kind: 'install-onmessage-probe:result'
    }
  | {
      kind: 'remove-object-listener-probe:result'
    }
  | {
      kind: 'trigger-onmessage-probe:result'
      payload: unknown
    }
