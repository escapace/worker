import { describe, expect, expectTypeOf, it } from 'vitest'
import { createWorkerScope, isDedicatedWorkerGlobalScope } from './index'
import type { CreateWorkerScopeOptions, SyntheticWorker, SyntheticWorkerScope } from './index'

describe('@escapace/worker', () => {
  it('exports the worker helpers', () => {
    expect(createWorkerScope).toBeTypeOf('function')
    expect(isDedicatedWorkerGlobalScope).toBeTypeOf('function')
  })

  it('exposes synthetic worker types', () => {
    expectTypeOf<SyntheticWorker>().toHaveProperty('onerror')
    expectTypeOf<SyntheticWorker>().toHaveProperty('onmessage')
    expectTypeOf<SyntheticWorker>().toHaveProperty('postMessage')
    expectTypeOf<SyntheticWorker>().toHaveProperty('terminate')
    expectTypeOf<SyntheticWorkerScope>().toHaveProperty('close')
  })

  it('exposes createWorkerScope options', () => {
    expectTypeOf<CreateWorkerScopeOptions>().toMatchTypeOf<{
      structuredClone?: boolean
    }>()

    expectTypeOf(createWorkerScope).parameters.toEqualTypeOf<
      [
        (scope: Parameters<Parameters<typeof createWorkerScope>[0]>[0]) => void,
        CreateWorkerScopeOptions?,
      ]
    >()
  })
})
