---
title: A Throw Inside A File Watcher Takes The Server With It
date: 2026-08-24
category: cli-bugs
module: Roughdraft local file server
problem_type: crash
component: server
symptoms:
  - "The server exits with an uncaught ENOENT from statSync moments after a watched file is deleted or moved"
  - "Every later request answers ECONNREFUSED and the browser tab goes dead with no message of its own"
  - "A smoke run fails several unrelated tests at once, all of them on content that never rendered"
  - "A whole test run reports every test passed and still exits non-zero"
root_cause: error_handling
resolution_type: code_fix
severity: high
tags: [file-watcher, sse, uncaught-exception, enoent, e2e, flaky]
---

# A Throw Inside A File Watcher Takes The Server With It

## Problem

`GET /api/markdown-file/events` watches the open document with `fs.watchFile({ interval: 500 })` and, on every change, reports the file's new version. Computing that version is two syscalls — `readFileSync` then `statSync` — so the file can vanish between them. When it does, `statSync` throws `ENOENT`.

Everywhere else that version is read, the caller is an Express handler and a throw becomes a 500. Here the caller is a `StatWatcher` listener, which runs outside any request and has nothing above it. The exception is uncaught, and Node exits.

The blast radius is the whole process: every open document loses its stream, every subsequent request is refused, and nothing in the browser explains why. Deleting the open file from another program, moving it, or switching to a branch that does not contain it are all ordinary ways to hit the window.

## Symptoms

- The server log ends with a raw `ENOENT: no such file or directory, stat '…'` and the Node banner, with no request in the stack.
- Requests after that point fail with `ECONNREFUSED` rather than an error page.
- In the e2e suite it looks nothing like a server crash: several unrelated tests fail at once, all of them waiting for content that never rendered, because the app they are driving has no backend any more.
- A run where the crash lands after the last assertion can report every test passed and still exit non-zero — the tests are green and the web server is dead.

## Evidence

From a `pnpm test:smoke` run in which four unrelated tests failed together:

```
Error: ENOENT: no such file or directory, stat '/tmp/roughdraft-roundtrip-PfafII/manual-save.md'
    at Object.statSync (node:fs:1795:25)
    at fileVersionFromFile (packages/server/src/index.ts:195:20)
    at sendChange (packages/server/src/index.ts:619:29)
    at StatWatcher.listener (packages/server/src/index.ts:633:7)
    at StatWatcher.emit (node:events:509:28)

Node.js v24.19.0
```

`readFileSync` on the line above succeeded; the file went between the two calls. The stack has no Express frame in it, which is the whole problem. What deleted the file was a test's own `afterEach`, racing the 500ms poll — the same shape as a reviewer deleting the file they had open.

## What Didn't Work

- The existing `stats.nlink > 0` guard. It is a check on the *poll*, taken before the read, so it says nothing about whether the file is still there when the read happens.

## Solution

Give the watcher a version reader that is allowed to come back empty, and let the read rather than the poll decide whether the file exists:

```ts
export function fileVersionIfPresent(filePath: string): string | null {
  try {
    return fileVersionFromFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
```

```ts
const version = stats.nlink > 0 ? fileVersionIfPresent(absolutePath) : null;
res.write(`event: change\ndata: ${JSON.stringify({
  path: relativePath,
  exists: version !== null,
  version,
})}\n\n`);
```

The three request-handler callers keep the throwing version: a 500 is the right answer there, and swallowing it would hide a real fault.

## Why This Works

A file that disappeared during the read is a file that does not exist, which is a state the event already has a shape for — `exists: false`, `version: null` — and which the browser already handles. So the fix does not invent a new outcome; it routes an impossible-looking case into the outcome it always belonged to. The catch is narrow: only `ENOENT`, so a permissions error or a full disk still surfaces.

## Prevention

- Any callback that runs outside a request — a watcher, a timer, an event emitter — is the top of its own stack. Treat a throw there as a process exit, because that is what it is.
- Do not let a `stat` taken at poll time stand in for a `stat` taken at read time. If two syscalls can disagree, the later one is the answer.
- When a test suite fails several unrelated cases at once, read the server log before reading the tests. A dead backend and a flaky test look identical from the assertion side, and only one of them is worth debugging.

## Related Issues

- Runtime path: `packages/server/src/index.ts` (`GET /api/markdown-file/events`, `fileVersionIfPresent`)
- Coverage: `packages/server/src/index.test.ts` (`fileVersionIfPresent`)
- The client half of this contract, which reads those same events: `docs/solutions/ui-bugs/an-echo-of-our-own-write-is-not-an-external-change.md`
