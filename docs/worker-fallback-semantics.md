`createWorkerScope()` supports a narrow, explicit overlap across three runtime branches: a real browser dedicated worker, a Node worker-thread bridge, and an in-process synthetic fallback. The goal is message-driven module reuse, not full worker-runtime emulation.

This document is the current semantic reference for `src/create-worker-scope.ts`. It replaces the earlier split between browser-fallback notes and a separate worker-thread investigation note.

## Scope

The document covers:

- the supported runtime branches
- the portable contract shared across those branches
- the important branch-specific differences
- the remaining implementation limits

It does not attempt to restate the full browser or Node worker APIs. It defines the subset that this library intentionally supports.

## Runtime branches

`createWorkerScope()` now exposes three runtime shapes through `CreateWorkerScopeContext['type']`.

| `type`               | Runtime                                                              | `scope`                           | Return value             |
| -------------------- | -------------------------------------------------------------------- | --------------------------------- | ------------------------ |
| `'dedicated-worker'` | browser dedicated worker                                             | real `DedicatedWorkerGlobalScope` | `undefined`              |
| `'worker-thread'`    | Node `worker_threads` with `parentPort`                              | `SyntheticWorkerScope`            | `undefined`              |
| `'in-process'`       | browser main thread, Node main thread, and other non-worker runtimes | `SyntheticWorkerScope`            | paired `SyntheticWorker` |

Only the browser dedicated-worker branch uses a real `DedicatedWorkerGlobalScope`. The other two branches use the shared synthetic endpoint implementation.

## Portable contract

Shared code can rely on the following surface across the supported branches:

- asynchronous message-driven communication
- `MessageEvent` delivery for ordinary messages
- `addEventListener()` / `removeEventListener()`
- `onmessage`
- `onerror`
- lifecycle cutoffs through `terminate()` and `close()`

The portable event surface is exactly:

- `message`
- `error`
- `onmessage`
- `onerror`

`messageerror` is outside the supported portable contract.

## Message delivery semantics

### Browser dedicated worker

This branch uses the native browser runtime.

Implications:

- message timing is the browser worker runtime’s timing
- `scope` is the real worker global
- the library does not emulate delivery here; it only selects the branch

### Node worker-thread branch

This branch keeps a synthetic scope, but ordinary messaging now relies on the real thread boundary instead of the synthetic scheduler.

Inbound path:

1. parent `Worker.postMessage(...)`
2. native delivery to `parentPort.on('message', ...)`
3. direct bridged delivery to `scope.receiveBridgedMessage(...)`
4. synthetic scope dispatches `MessageEvent`

Outbound path:

1. worker-side `scope.postMessage(...)`
2. internal `postMessageBridge(...)`
3. direct call to `parentPort.postMessage(...)`
4. native delivery to the parent `Worker`

Implications:

- ordinary inbound worker-thread messages do not re-enter the synthetic `MessageChannel` scheduler
- ordinary outbound worker-thread messages do not re-enter the synthetic `MessageChannel` scheduler
- the earlier ordinary double-scheduling gap is closed

### In-process synthetic branch

This branch uses the synthetic pair entirely in process.

Implications:

- message delivery is asynchronous through the synthetic pair's `MessageChannel` scheduler
- the timing is intentionally worker-like, but only approximate relative to a full browser event loop

## Event and listener semantics

The shared synthetic endpoint implementation provides these behaviors for the synthetic branches:

- ordinary message dispatch uses real `MessageEvent`
- duplicate listeners are deduplicated by `EventTarget` rules
- object listeners with `handleEvent()` work
- `{ once: true }` works
- `removeEventListener()` is capture-sensitive
- `onmessage` and `onerror` property handlers work

The worker-thread branch now has dedicated bridge-specific tests for:

- scope surface availability
- inbound `MessageEvent` details
- listener semantics on the worker-thread scope
- `scope.onmessage`
- `scope.onerror`

## Payload, clone, and transfer semantics

The biggest semantic difference between the synthetic branches is payload handling.

| Behavior                 | Browser dedicated worker | Node worker-thread branch         | In-process synthetic default | In-process synthetic with `structuredClone: true` |
| ------------------------ | ------------------------ | --------------------------------- | ---------------------------- | ------------------------------------------------- |
| Object payloads          | cloned                   | cloned by native thread boundary  | passed by reference          | cloned                                            |
| Transfer lists           | honored                  | honored by native thread boundary | ignored                      | honored                                           |
| `ArrayBuffer` detachment | yes                      | yes                               | no                           | yes                                               |
| Non-cloneable values     | fail with clone error    | fail with clone error             | allowed                      | fail with clone error                             |

### Worker-thread branch

The worker-thread branch relies on native Node clone and transfer behavior.

Internally:

- the worker-thread adapter creates the synthetic pair with `structuredClone: false`
- clone and transfer fidelity comes from the real thread boundary, not from the in-process synthetic `structuredClone` option

### In-process branch

The in-process branch makes a deliberate default trade-off:

- payloads are passed by reference
- transfer lists are ignored
- clone errors are not enforced by default

If stronger worker parity is needed in that branch, callers can opt in with:

```ts
createWorkerScope(createWorker, { structuredClone: true })
```

That opt-in changes the in-process branch only.

## Error semantics

### Common rule

The sender should not receive receiver-side exceptions synchronously from `postMessage()`.

### Synthetic branches

For the synthetic branches, scope-side `message` handler failures are translated into worker-like `error` behavior.

The translation remains intentionally narrow:

- scope-side `message` dispatch failures are treated as worker-like errors
- failures from other synthetic event types still follow the host `EventTarget` error path

### Worker-thread branch

The worker-thread branch now uses a synchronous internal worker-error hop before rethrowing into the native Node worker-thread error channel.

Path:

1. scope-side `message` handler throws
2. synthetic worker-like `error` dispatch happens immediately on the internal worker endpoint
3. worker-thread adapter listens for that internal worker `error`
4. adapter rethrows inside the worker thread
5. parent Node `Worker` receives its native `'error'` event

Implications:

- parent-side error observation uses the native worker-thread `'error'` channel
- the earlier worker-thread error-timing scheduler gap is closed

### In-process branch

The in-process branch keeps the scheduled synthetic worker-error behavior. That is acceptable because there is no real thread boundary to align with.

## Lifecycle semantics

### `terminate()`

- browser dedicated worker: parent-side native `Worker.terminate()` exists outside the worker
- worker-thread branch: parent-side native Node `Worker.terminate()` remains the full forced-shutdown path
- in-process branch: `terminate()` closes the synthetic pair

### `close()`

- browser dedicated worker: native worker-side `close()` semantics apply
- worker-thread branch: `scope.close()` is cooperative
- in-process branch: `close()` closes the synthetic pair

### Synthetic-branch lifecycle cutoff

In the synthetic branches, `terminate()` and `close()` cut off future synthetic dispatch.

That cutoff also applies to already queued synthetic work:

- already queued synthetic ordinary messages are dropped
- already queued synthetic worker-error delivery is dropped

### Worker-thread `scope.close()`

Current worker-thread `scope.close()` behavior is:

1. close the synthetic pair
2. call `parentPort.close()`

The synthetic pair's scheduler also `unref()`s its `MessageChannel` ports when `unref()` is available, so the scheduler itself does not keep the worker thread alive.

This is enough for the normal message-driven worker-thread case. It is not equivalent to parent-side Node `Worker.terminate()`.

That distinction is intentional:

- `scope.close()` is the worker-side cooperative shutdown path
- parent-side `Worker.terminate()` is the forced shutdown path

## Detection semantics

The worker-thread branch is selected through one internal guarded capability check.

The implementation now centralizes Node builtin-module lookup in one defensive helper that:

- checks whether `globalThis.process` exists
- checks whether `process.getBuiltinModule` exists
- checks whether it is callable
- uses `Reflect.get` and `Reflect.apply`
- does not rely on `try/catch`

Semantically, the worker-thread branch still depends on:

```ts
process.getBuiltinModule('node:worker_threads')?.parentPort != null
```

If that capability is unavailable, `createWorkerScope()` falls back to the in-process branch.

No broader fallback is currently planned beyond this guarded capability check.

## Deliberate non-goals

This library is not a full worker-runtime emulator.

The current implementation does not attempt to:

- expose a real `DedicatedWorkerGlobalScope` outside the browser dedicated-worker branch
- virtualize worker-only globals onto `globalThis`
- emulate the full `WorkerGlobalScope` surface
- include `messageerror` in the portable contract
- provide spec-exact event-loop ordering across every task source

These are intentional scope boundaries, not accidental omissions.

## Remaining implementation limits

The important remaining limits are now narrower than the earlier implementation had.

### 1. Worker-thread `scope.close()` is still cooperative

`scope.close()` in the worker-thread branch does not forcibly cancel arbitrary user-created timers, intervals, handles, or other ref-holding resources inside the thread.

A full hard stop remains the parent-side native Node `Worker.terminate()` path.

### 2. Worker-thread detection still depends on Node runtime capabilities

The worker-thread branch still depends on:

- `globalThis.process`
- `process.getBuiltinModule`

If that capability is absent, the library falls back to the in-process branch.

### 3. Repeated `createWorkerScope()` calls inside one Node worker thread are an anti-pattern

The implementation assumes the ordinary shape:

- one worker entry module
- one `createWorkerScope()` call

Repeated calls inside the same worker thread are not normalized in code and should be treated as unsupported anti-patterns.

## Type-level contract

`CreateWorkerScopeContext` is intentionally discriminated by runtime branch:

- `type: 'dedicated-worker'`
- `type: 'worker-thread'`
- `type: 'in-process'`

When `type` is `'worker-thread'` or `'in-process'`, `scope` is a `SyntheticWorkerScope`.

The synthetic worker types expose the supported overlap:

- `postMessage()` overloads
- `onmessage`
- `onerror`
- `terminate()` on the synthetic worker endpoint
- `close()` on the synthetic scope

## Current summary

The supported semantics are now:

- real browser dedicated-worker behavior when actually running in a browser dedicated worker
- worker-thread ordinary messaging that uses the real Node thread boundary without the earlier extra synthetic scheduling hops
- in-process synthetic messaging that preserves the narrow worker-like authoring model, with opt-in stronger clone/transfer parity

The remaining differences are explicit:

- the in-process branch still defaults to reference semantics instead of clone semantics
- the worker-thread branch still uses cooperative `scope.close()` rather than forced termination
- worker-thread detection still depends on Node runtime capability checks
- repeated worker-thread `createWorkerScope()` setup is still an unsupported anti-pattern

That is the intended semantic boundary for this library.
