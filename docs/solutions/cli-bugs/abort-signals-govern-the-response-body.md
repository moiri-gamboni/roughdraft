---
title: A Connect Timeout Signal Also Kills The Response Body
date: 2026-08-21
category: cli-bugs
module: Roughdraft remote-document CLI
problem_type: data_loss
component: server
symptoms:
  - "Remote saves stopped reaching disk about ten seconds after roughdraft open, with no error"
  - "PUT /api/remote-document/:id answered 503 'No active CLI session' while the CLI process was still running"
  - "The browser's remote session banner flipped to disconnected while the CLI printed nothing"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags: [remote-document, sse, abortsignal, undici, fetch, timeouts]
---

# A Connect Timeout Signal Also Kills The Response Body

## Problem

`runRemoteOpen` opened the CLI's save-back event stream with a connect deadline:

```ts
eventsResponse = await deps.fetchImpl(eventsUrl.toString(), {
  headers: { Accept: "text/event-stream", ...authHeaders },
  signal: AbortSignal.timeout(SSE_CONNECT_TIMEOUT_MS), // 10s
});
```

The name and the placement both read as "give up if the host does not answer in ten seconds". A signal passed to `fetch` is not scoped to the connect, though: it stays attached to the `Response`, and aborting it errors the body stream. Ten seconds after a *successful* connect, `reader.read()` threw `TimeoutError`, the loop broke, and the CLI printed "Remote session disconnected." only in non-JSON mode before exiting 0.

Every remote-document session therefore had a ten-second useful life. After that the server had no `saveClient`, so each browser save was answered with 503 and never reached the file.

## Symptoms

- Saves made in the browser within the first ten seconds landed on disk; later ones did not.
- The server answered `503 No active CLI session; save not delivered to disk.`
- The CLI process was still alive from the shell's point of view (it exited only when the shell noticed), and its exit code was 0, so nothing looked like a failure.

## What Didn't Work

- Reading the code statically: the constant is named `SSE_CONNECT_TIMEOUT_MS` and sits on the connect call, which is exactly what it looks like it does.
- Faking the clock in a test. Node's `AbortSignal.timeout` runs off an internal timer that Vitest's fake timers do not patch, so a faked clock never fires it and the buggy code passes. The reproduction has to spend the real ten seconds.

## Solution

Separate the deadline from the stream lifetime: arm an `AbortController` with a plain `setTimeout` and clear it as soon as response headers arrive.

```ts
const abort = new AbortController();
const connectDeadline = setTimeout(() => {
  abort.abort(new Error("Timed out opening the remote event stream"));
}, SSE_CONNECT_TIMEOUT_MS);

try {
  response = await deps.fetchImpl(eventsUrl.toString(), {
    headers: { Accept: "text/event-stream", ...authHeaders },
    signal: abort.signal,
  });
} finally {
  clearTimeout(connectDeadline);
}
```

A stalled connect still aborts at ten seconds; an established stream now lives as long as the session.

The regression test runs a real host, waits out the deadline, and asserts that a save dispatched at t≈11s reaches disk. The give-away in the red run is the PUT status: `expected 503 to be 200`, i.e. the server no longer had a CLI attached.

## Why This Works

`AbortSignal` semantics are per-request, not per-phase. Anything that must bound only one phase of a request has to own its own timer and disarm it when that phase ends. Once the timer is cleared, nothing holds a deadline over the body, and the SSE stream behaves like the long-lived channel it is meant to be.

## Prevention

- Treat `AbortSignal.timeout(...)` on a `fetch` as a deadline for the *whole* exchange, including reading the body. For streaming responses, that is almost never what you want.
- When a timeout constant is named after one phase, check that the mechanism is actually scoped to that phase.
- Prefer a real-time reproduction when the mechanism lives in a runtime timer the test framework does not control; a faked clock can silently agree with the bug.
- Watch for failure modes that report success: this one exited 0 and logged a friendly line, so only the file on disk revealed it.

## Related Issues

- Runtime path: `packages/server/src/cli.ts` (`runRemoteOpen`)
- Coverage: `packages/server/src/cli.test.ts` ("keeps writing remote saves that arrive after the connect deadline", "gives up when the remote host never answers the event stream")
- The reconnect loop built on top of this fix would have flapped every ten seconds without it.
