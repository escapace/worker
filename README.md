# @escapace/web-worker-tools

`createWorkerScope()` lets one message-driven worker module run in three branches: a real browser dedicated worker, a Node worker-thread bridge, or an in-process synthetic fallback. The library keeps that overlap narrow on purpose, so shared worker code can be reused without claiming full worker-runtime emulation.

That matters when the same worker entry module needs to run in a browser worker, a Node worker thread, and a main-thread fallback or test path with one message-handling implementation.

## Install

```sh
pnpm add @escapace/web-worker-tools
```

## Runtime model

| Environment              | `type`               | `scope`                      | Return value      |
| ------------------------ | -------------------- | ---------------------------- | ----------------- |
| Browser dedicated worker | `'dedicated-worker'` | `DedicatedWorkerGlobalScope` | `undefined`       |
| Browser main thread      | `'in-process'`       | `SyntheticWorkerScope`       | `SyntheticWorker` |
| Node main thread         | `'in-process'`       | `SyntheticWorkerScope`       | `SyntheticWorker` |
| Node `worker_threads`    | `'worker-thread'`    | `SyntheticWorkerScope`       | `undefined`       |

Only the browser dedicated-worker branch exposes the real `DedicatedWorkerGlobalScope`.

In the Node worker-thread branch, `createWorkerScope()` keeps a `SyntheticWorkerScope` inside the thread and auto-bridges ordinary messages to `parentPort`. In the in-process branch, the synthetic pair stays entirely local and `createWorkerScope()` returns the paired `SyntheticWorker` endpoint.

If the Node worker-thread capability check is unavailable, `createWorkerScope()` falls back to the in-process branch.

The supported shape inside one Node worker thread is one worker entry module and one `createWorkerScope()` call. Repeated setup inside the same thread is unsupported.

The portable contract is intentionally small. The synthetic path does not virtualize worker-only globals onto `globalThis`, does not expose the full `WorkerGlobalScope` surface, does not include `messageerror` in the shared contract, and does not promise spec-exact task ordering across every runtime.

## Payloads

The largest semantic difference between branches is payload handling.

| Runtime                               | Objects             | Transfers | `ArrayBuffer` detaches | Non-cloneables        |
| ------------------------------------- | ------------------- | --------- | ---------------------- | --------------------- |
| Browser worker                        | cloned              | honored   | yes                    | fail with clone error |
| Node thread                           | cloned              | honored   | yes                    | fail with clone error |
| In-process (`structuredClone: false`) | passed by reference | ignored   | no                     | allowed               |
| In-process (`structuredClone: true`)  | cloned              | honored   | yes                    | fail with clone error |

The default in-process trade-off preserves local object identity and accepts non-cloneable values. `structuredClone` only affects the in-process branch. It has no effect in the browser dedicated-worker branch, and it does not change clone or transfer behavior in the Node worker-thread branch, where those semantics already come from the native thread boundary.

If stronger worker parity is needed in the in-process branch, opt in explicitly:

```ts
import { createWorkerScope } from '@escapace/web-worker-tools'

const worker = createWorkerScope(
  ({ scope }) => {
    scope.onmessage = (event) => {
      scope.postMessage(event.data)
    }
  },
  {
    structuredClone: true,
  },
)
```

With `structuredClone: true`, sent payloads go through `structuredClone()` in the in-process branch. Objects are snapshotted instead of shared by reference, transfer lists are honored, and non-cloneable payloads fail at send time with `DataCloneError`.

## Message delivery

Shared code can rely on these behaviors across the supported branches:

- ordinary message delivery stays asynchronous
- ordinary messages arrive as real `MessageEvent` objects
- `addEventListener()` and `removeEventListener()` are available
- `onmessage` and `onerror` property handlers work
- listener behavior follows `EventTarget` rules for deduplication, `handleEvent()` objects, `{ once: true }`, and capture-sensitive removal
- `terminate()` and `close()` act as lifecycle cutoffs

The portable event surface is exactly `message`, `error`, `onmessage`, and `onerror`. `messageerror` stays outside the shared contract.

Branch timing differs where the runtimes differ:

- browser dedicated workers use the native browser worker runtime directly
- Node worker threads deliver ordinary inbound and outbound messages across `parentPort` without re-entering the synthetic `MessageChannel` scheduler
- the in-process branch uses the synthetic pair's `MessageChannel` scheduler, so timing is worker-like but only approximate relative to a full browser event loop

## Errors

Receiver-side exceptions are not thrown back synchronously from `postMessage()`.

Scope-side `message` handler failures are translated into worker-like error delivery. In the in-process branch, those synthetic worker errors are scheduled. In the worker-thread branch, the internal worker-style error dispatch happens before the adapter rethrows into Node's native worker-thread error channel, so parent-side observation still happens through the native `Worker` `'error'` event.

That remapping is narrow. Failures from other synthetic event types continue to follow the host `EventTarget` error path instead of worker-style error delivery.

## Lifecycle

Browser dedicated workers keep the native browser split between worker-side `close()` and parent-side `Worker.terminate()`.

In the in-process branch, `terminate()` on the returned `SyntheticWorker` and `close()` on the synthetic scope both close the pair.

In the Node worker-thread branch, `scope.close()` is a cooperative worker-side shutdown path. It closes the synthetic pair and calls `parentPort.close()`, which is enough for the normal message-driven case. It does not cancel arbitrary timers, intervals, handles, or other ref-holding resources created inside the thread. It is not equivalent to parent-side `Worker.terminate()`, which remains the forced shutdown path for a Node worker thread.

After `terminate()` or `close()` in the synthetic path, already queued synthetic messages and already queued synthetic worker-error delivery are dropped.

## Examples

The examples use one shared module and different runtime wiring around it.

### Shared module

```ts
// echo-worker.ts
import { createWorkerScope } from '@escapace/web-worker-tools'

export const worker = createWorkerScope(({ scope }) => {
  scope.addEventListener('message', (event) => {
    scope.postMessage({
      reply: event.data,
    })
  })
})
```

### Browser dedicated worker

```ts
// main.ts
const worker = new Worker(new URL('./echo-worker.ts', import.meta.url), {
  type: 'module',
})

worker.addEventListener('message', (event) => {
  console.log(event.data)
})

worker.postMessage({
  value: 1,
})
```

In this case, `createWorkerScope()` runs inside a dedicated worker. The callback receives the real `DedicatedWorkerGlobalScope`, and the exported `worker` value from `echo-worker.ts` is `undefined`.

### Node in process

Using the same `echo-worker.ts` module:

```ts
import { worker } from './echo-worker.js'

if (worker === undefined) {
  throw new Error('Expected a synthetic worker outside a dedicated worker scope')
}

worker.addEventListener('message', (event) => {
  console.log(event.data)
})

worker.postMessage({
  value: 1,
})
```

In this case, the module is imported outside a dedicated worker. `createWorkerScope()` returns a `SyntheticWorker`, and the same message handler runs in process.

### Node `worker_threads`

Node worker threads still use the synthetic scope because they do not expose `DedicatedWorkerGlobalScope`. When `createWorkerScope()` runs inside a Node worker thread, it auto-bridges that synthetic scope to `parentPort`, so worker entry modules do not need manual wiring.

```ts
// thread-worker.ts
import { createWorkerScope } from '@escapace/web-worker-tools'

export const worker = createWorkerScope(({ scope }) => {
  scope.addEventListener('message', (event) => {
    scope.postMessage({
      reply: event.data,
    })
  })
})
```

```ts
// main.ts
import { Worker } from 'node:worker_threads'

const worker = new Worker(new URL('./thread-worker.ts', import.meta.url))

worker.on('message', (message) => {
  console.log(message)
})

worker.postMessage({
  value: 1,
})
```

Inside the worker thread, the exported `worker` value is `undefined` because the scope is auto-bridged to `parentPort`. Forced shutdown still uses the parent-side native `Worker.terminate()` API.

# API

## function createWorkerScope [↗](src/create-worker-scope.ts#L631-L653 'createWorkerScope')

Initializes a worker module against the active runtime branch.

```typescript
export declare function createWorkerScope(
  createWorker: (scope: CreateWorkerScopeContext) => void,
  options?: CreateWorkerScopeOptions,
): SyntheticWorker | undefined
```

### Parameters

| Parameter      | Type                                                                                                                    | Description                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `createWorker` | <pre>(scope: [CreateWorkerScopeContext](#type-createworkerscopecontext- 'type CreateWorkerScopeContext')) => void</pre> | Receives the runtime branch and scope selected for the module. |
| `options`      | <pre>[CreateWorkerScopeOptions](#interface-createworkerscopeoptions- 'interface CreateWorkerScopeOptions')</pre>        | Controls payload handling in the in-process branch.            |

### Returns

`undefined` in the browser dedicated-worker and Node worker-thread branches; otherwise, the paired `SyntheticWorker` for the in-process branch.

### Remarks

`createWorkerScope()` selects one of three branches:

- Browser dedicated worker: passes the real `DedicatedWorkerGlobalScope` with `type: 'dedicated-worker'` and returns `undefined`.
- Node worker thread: passes a `SyntheticWorkerScope` with `type: 'worker-thread'`, auto-bridges ordinary messages to `parentPort`, and returns `undefined`.
- In-process fallback: passes a `SyntheticWorkerScope` with `type: 'in-process'` and returns the paired `SyntheticWorker`.

The shared contract is intentionally narrow. Shared code can rely on asynchronous ordinary message delivery, `MessageEvent` dispatch for ordinary messages, `EventTarget` listener behavior, `onmessage`, `onerror`, and lifecycle cutoffs through `terminate()` and `close()`. The portable event surface is exactly `message`, `error`, `onmessage`, and `onerror`.

In the in-process branch, payloads are passed by reference and transfer lists are ignored by default. Setting `options.structuredClone` to `true` enables `structuredClone()` and transfer-list behavior for that branch only. It has no effect in the browser dedicated-worker branch, and it does not change clone or transfer behavior in the Node worker-thread branch.

Scope-side `message` handler failures are translated into worker-like `error` delivery. Failures from other event types continue to follow the host `EventTarget` error path.

In the worker-thread branch, `scope.close()` is a cooperative shutdown path. The parent-side native Node `Worker.terminate()` API remains the forced-shutdown path.

`terminate()` and `close()` also drop already queued synthetic messages and already queued synthetic worker-error delivery.

## function isDedicatedWorkerGlobalScope [↗](src/create-worker-scope.ts#L588-L594 'isDedicatedWorkerGlobalScope')

Checks whether the current global scope is a browser `DedicatedWorkerGlobalScope`.

```typescript
isDedicatedWorkerGlobalScope: () => boolean
```

### Returns

`true` when the current global scope is a browser dedicated worker; otherwise, `false`.

### Remarks

This only identifies the real browser dedicated-worker branch. It returns `false` in the in-process synthetic branch and in the Node worker-thread branch.

## interface CreateWorkerScopeOptions [↗](src/types.ts#L14-L25 'CreateWorkerScopeOptions')

Configures the in-process branch of `createWorkerScope()`.

```typescript
export interface CreateWorkerScopeOptions
```

### Remarks

These options only affect the in-process branch. In a browser dedicated worker, `createWorkerScope()` uses the real `DedicatedWorkerGlobalScope` and ignores them. In a Node worker thread, clone and transfer behavior already comes from the native thread boundary, so these options do not change that behavior.

### CreateWorkerScopeOptions.structuredClone

Enables `structuredClone()` and transfer-list semantics in the in-process branch.

```typescript
structuredClone?: boolean;
```

#### Remarks

This only affects the in-process branch. When omitted or `false`, that branch passes payloads by reference and ignores transfer lists.

## interface SyntheticWorker [↗](src/types.ts#L79-L104 'SyntheticWorker')

Represents one endpoint in a synthetic worker pair.

```typescript
export interface SyntheticWorker<T extends SyntheticWorkerTarget = Worker> extends EventTarget
```

### Type Parameters

| Parameter | Description                                                |
| --------- | ---------------------------------------------------------- |
| `T`       | Native endpoint shape mirrored by this synthetic endpoint. |

### Remarks

The surface matches the portable overlap used by `createWorkerScope()`: `EventTarget` methods, `postMessage()`, `onmessage`, `onerror`, `terminate()`, and `close()`.

## type CreateWorkerScopeContext [↗](src/types.ts#L135-L147 'CreateWorkerScopeContext')

Describes the runtime branch selected by `createWorkerScope()`.

```typescript
export type CreateWorkerScopeContext =
  | {
      scope: DedicatedWorkerGlobalScope
      type: 'dedicated-worker'
    }
  | {
      scope: SyntheticWorkerScope
      type: 'in-process'
    }
  | {
      scope: SyntheticWorkerScope
      type: 'worker-thread'
    }
```

### Remarks

This is a discriminated union keyed by `type`.

When `type` is `'dedicated-worker'`, `scope` is the real browser `DedicatedWorkerGlobalScope`.

When `type` is `'worker-thread'` or `'in-process'`, `scope` is a [SyntheticWorkerScope](#type-syntheticworkerscope-) that keeps the same message-driven worker module usable outside a browser dedicated worker.

## type SyntheticWorkerScope [↗](src/types.ts#L110 'SyntheticWorkerScope')

Represents the synthetic scope passed to `createWorkerScope()` outside a browser dedicated worker.

```typescript
export type SyntheticWorkerScope = SyntheticWorker<DedicatedWorkerGlobalScope>
```

## type SyntheticWorkerTarget [↗](src/types.ts#L64 'SyntheticWorkerTarget')

Represents the native endpoint shapes mirrored by synthetic worker endpoints.

```typescript
export type SyntheticWorkerTarget = DedicatedWorkerGlobalScope | Worker
```

### Remarks

`SyntheticWorkerScope` uses the worker-global shape, and the paired `SyntheticWorker` defaults to the main-thread `Worker` shape.
