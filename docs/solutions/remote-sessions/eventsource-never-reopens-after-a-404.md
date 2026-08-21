---
title: EventSource Never Re-Opens After A 404
date: 2026-08-21
category: remote-sessions
module: Remote document viewer
problem_type: integration_bug
component: browser
symptoms:
  - "After the server restarts, a remote viewer tab stays disconnected forever even once the CLI is back"
  - "The disconnected banner never clears without a manual page reload"
  - "No further save events reach the tab, and no repeat requests to the events endpoint appear in the server log"
root_cause: incorrect_assumption
resolution_type: code_fix
severity: high
tags: [remote-sessions, sse, eventsource, reconnect, browser]
---

# EventSource Never Re-Opens After A 404

## Problem

`RemoteBackend.watchMarkdownFile` subscribed to `GET /api/remote-document/:id/events` with a single native `EventSource` and relied on the browser's built-in reconnection. That reliance is only half true. The browser reconnects after a *transient* failure (the connection drops, the stream ends), but a response that is not 2xx is a **fatal** error in the EventSource specification: the browser fires `error`, sets `readyState` to `CLOSED`, and never tries again.

The events endpoint answers 404 whenever the session is not registered, which is exactly the state a restarted server is in until the CLI re-registers. So the one outage the reconnect logic existed for was the one it could not survive: the tab went dark permanently and only a manual reload brought it back.

## Symptoms

- Server log shows a single request to `/api/remote-document/:id/events` and no retries, however long the tab stays open.
- The tab keeps rendering the disconnected banner after the CLI is demonstrably back.
- Edits made in the tab still reach the server, so the session looks half alive: saves work, incoming save events do not.

## What Didn't Work

- Trusting `EventSource`'s automatic reconnect. It covers stream drops, not HTTP failures.
- Treating the viewer's own `onerror` as the session-health signal. The CLI dropping does not disturb the viewer's stream at all; the server pushes an explicit `disconnected` event for that, and the viewer has to listen for it.

## Solution

Wrap the subscription in a `connect()` closure and re-open it from `onerror` when, and only when, the browser has closed the stream:

```ts
source.onerror = () => {
  if (source.readyState !== EventSource.CLOSED) return;
  this.setSessionStatus("disconnected");
  scheduleReopen();
};
```

`scheduleReopen` backs off 1s, 2s, 4s, 8s, capped at 10s, and the counter resets on the next `connected` event. Two pieces of state make the disposer safe: a mutable cell holding whichever source is currently live, and a `disposed` token. The disposer clears the pending timer, closes the live source and sets the token, so a backoff that was already in flight cannot open an orphan stream against a torn-down backend.

Reattaching is not only about the stream. The session the viewer comes back to may hold a different document than the one it left, because a re-registering CLI re-reads the file from disk under a fresh version. The `connected` event carries that version and the stream has no `id:` field, so nothing replays the `save` events missed during the outage: the viewer has to treat a version it does not recognise as a document change and reload. Without that, a reattached tab shows a green banner over pre-outage content and 409s on its next save.

## Why This Works

Measured in real Chrome against a server that 404s the first three attempts, then serves a stream announcing version `v9` and pushing a save at `v2`:

```
[server] events attempt 1 at 5826ms   (page load, 404)
[server] events attempt 2 at 6837ms   (+1011ms)
[server] events attempt 3 at 8851ms   (+2014ms)
[server] events attempt 4 at 12863ms  (+4012ms, served)
browser log: 1ms status=disconnected, 7047ms status=connected,
             7047ms change version=v9, 7346ms change version=v2
```

Attempts two through four exist only because the loop created them, which is the direct evidence that the browser had given up: the intervals are the loop's own backoff schedule. The `v9` change at the moment of reattach is the version resync, and the `v2` change is a save arriving over the recovered stream.

## Prevention

- Treat "the browser reconnects for us" as a claim about transient failures only. Any SSE endpoint that can answer 404, 401 or 500 needs an application-level re-open loop.
- Give every re-open loop a disposer that owns both the live handle and the pending timer. A loop whose cancellation only closes the current source leaks a stream one backoff later.
- Verify reconnect behavior in a real browser. A fake EventSource proves the loop reacts correctly to `readyState`, but only a real one proves what `readyState` does after a 404.

## Related Issues

- Runtime path: `packages/app/src/remote-backend.ts` (`watchMarkdownFile`)
- Coverage: `packages/app/src/remote-backend.test.ts`
- Server side of the contract: `packages/server/src/index.ts` (`GET /api/remote-document/:id/events`)
