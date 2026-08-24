# History Sidecar v1

Status: Draft

The history sidecar is a directory of plain Markdown copies kept beside a document, holding past versions of that document. It is a **format, not an API**, implemented twice and independently:

- `packages/server/src/checkpoint-store.ts` in this repository, referred to below as **the store**.
- `files/hooks/roughdraft-write-guard.sh`, a `PreToolUse` hook in the separate roost server repository, referred to below as **the hook**. It derives every path in this document from a file path alone and shares no code with the store.

A change to the layout, the snapshot id grammar, the capture rules, or the retention rules is a change to both.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as described in RFC 2119.

For why the sidecar exists and what keeping deleted content beside a document implies, see [ADR 0001](../adr/0001-single-local-markdown-file.md).

## Scope

This specification defines the on-disk layout, the snapshot naming grammar, and the capture and retention rules that every writer and reader of the sidecar follows. It does not define an HTTP API, a CLI, a diff format, or a synchronization protocol, and it says nothing about how a snapshot is presented to a user.

`v1` in the layout is the version of this specification. A writer that cannot satisfy this document MUST use a different version directory rather than reinterpret this one.

## Layout

For a document at `<dir>/<name>.md`, the sidecar is:

```
<dir>/
├── <name>.md                 the document
└── .roughdraft-history/      sidecar root
    ├── .gitignore
    └── v1/                   format version
        └── <stem>/           leaf, one per document
            └── <id>.md       one snapshot
```

`<stem>` is the document's file name with a trailing `.md` removed. The removal is case-sensitive: the stem of `notes.md` is `notes`, and the stem of `notes.MD` is `notes.MD`.

The leaf is keyed by name, not by inode or by any stored identity. A document renamed after a snapshot was taken keeps its history under its former name, and a new document taking that name inherits it.

The sidecar sits in the document's own directory. Writers create the three directory levels on demand; a document with no history has no sidecar.

## Snapshot ids

A snapshot's id is its file name with `.md` removed. The canonical grammar is:

```
id      = stamp "--p" 1*DIGIT "--" trigger
stamp   = 4DIGIT "-" 2DIGIT "-" 2DIGIT "T" 2DIGIT "-" 2DIGIT "-" 2DIGIT "-" 3DIGIT "Z"
trigger = "save" / "review" / "replaced" / "hook"
```

as the regular expression:

```
^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z--p\d+--(save|review|replaced|hook)$
```

`stamp` is a UTC instant to millisecond precision, in ISO 8601 form with `:` and `.` replaced by `-`. The digits after `p` are the writing process's pid. The grammar admits no `.`, no `/`, and no path separator of any kind, so an id can be joined to the leaf path without traversal.

An id MUST NOT exceed 64 characters. The regular expression does not express this bound; a reader MUST apply it separately. The canonical id is 44 characters at a 7-digit pid.

A reader MUST reject an id whose `stamp` does not round-trip: `2026-02-30T…` is not an invalid date to an ISO 8601 parser, it is March 2nd, and accepting it would let a snapshot's parsed time disagree with its own name. Formatting the parsed instant back and comparing to the original id is sufficient.

A shell writer derives a conforming stamp with GNU `date`:

```sh
date -u +%Y-%m-%dT%H-%M-%S-%3NZ
```

### Ordering

Ids MUST be strictly increasing per document: a writer MUST NOT create a snapshot whose id sorts at or before the newest existing one, so that a pre-write `replaced` capture cannot sort after the write that caused it. A writer whose clock would produce such an id advances it to `max(now, newest + 1ms)`.

The store advances explicitly. The hook does not compare against the newest id at all; it relies on its 90-second coalescing window to keep stamps apart, which a backwards clock step would defeat.

Because every conforming stamp is fixed-width and zero-padded, codepoint order on ids is chronological order. Tooling that determines which snapshot is newest or oldest by sorting file names MUST sort byte-wise. In a shell that means pinning the collation, since a UTF-8 locale's `sort` may ignore punctuation:

```sh
export LC_ALL=C
```

Ordering decides which snapshot is evicted, so two implementations that collate differently will delete different files.

## Triggers

The trigger is the last segment of the id and records what caused the capture. The set is closed; a writer MUST NOT introduce a value outside it.

| Trigger | Meaning |
|---|---|
| `save` | The document was saved through Roughdraft. |
| `review` | The state as it stood when a review was completed. |
| `replaced` | Bytes found on disk that the capturing writer did not put there, recorded before being overwritten. |
| `hook` | Bytes captured by the roost `PreToolUse` hook before an agent's write. |

## Capture rules

A capture records content as the newest snapshot of a document, subject to three rules applied in this order.

**Content-only dedup.** A writer MUST NOT store content identical to that of the newest snapshot. The comparison is on content alone; the trigger is not part of it. Only the newest snapshot is consulted, so identical content may appear more than once in a history if something else was captured in between.

**Review promotion.** When dedup suppresses a `review` capture and the newest snapshot's trigger is not already `review`, the writer MUST rename that snapshot so its id ends in `review`, keeping the rest of the id unchanged. It MUST rename rather than write a second copy. A `review` capture always leaves a `review`-labelled newest entry, which is what Retention pins.

**Coalescing.** A writer MAY skip a capture when the newest snapshot is younger than 90 seconds, so that an edit burst cannot evict the whole history. A writer MUST NOT skip a capture when the leaf is empty.

The two implementations narrow that permission differently, and a reader may assume neither:

- The store skips only a `save` whose newest snapshot is also a `save`, measured from the newest snapshot's id. A `replaced`, `review`, or `hook` capture is never skipped.
- The hook skips its `hook` capture whenever the newest snapshot is younger than 90 seconds, whatever that snapshot's trigger, measured from the file's mtime.

A history therefore records at most one state per 90 seconds per writer, and intermediate states within a burst are not recoverable.

## Retention

A leaf directory holds at most 50 snapshots (`MAX_SNAPSHOTS_PER_DOCUMENT`).

Eviction is oldest-first, except that **the newest `review` entry is never evicted**. The pin is part of the format, not an implementation detail: a writer that trims to 50 without honouring it deletes the reviewed state. Exactly one entry is pinned. Where several `review` entries exist, only the newest is protected; the rest are ordinary eviction candidates.

The cap is enforced lazily, after a capture that actually wrote a file. A capture suppressed by dedup or coalescing performs no eviction, so a leaf that is already over the cap stays over it until the next real capture. The cap is not an invariant a reader may rely on.

Files in the leaf whose names are not conforming ids are neither listed as snapshots nor evicted. A reader SHOULD report their count; a non-zero count means either a hand-placed file or a writer whose ids have drifted from this grammar.

## Version control

Writers MUST create `<dir>/.roughdraft-history/.gitignore` containing `*` when it is absent. It belongs at the sidecar root, where one pattern covers every version directory and every leaf beneath it.

Either writer may be the one to create it: any writer that finds the file missing MUST write it, and MUST NOT overwrite one that exists. Without it, `git add -A` publishes content an author deliberately deleted and `git clean -fd` deletes the history.

A repository whose working tree holds documents MAY additionally ignore `.roughdraft-history/` in its own `.gitignore`; this repository does.

## Symlinks

A writer MUST refuse to create or write through a symlink at any level of the sidecar — root, version directory, or leaf — and MUST make no snapshot rather than follow one. Following one grants whoever planted it file creation in a directory of their choosing, triggered by whoever next edits the document.

A reader MUST NOT list a leaf that is not a directory, and MUST NOT read a snapshot entry that is not a regular file. Opening a snapshot with `O_NOFOLLOW`, and treating `ELOOP` as a missing snapshot, satisfies the second requirement.

## Writing

Documents and snapshots written through the store are written atomically: content goes to a fresh temporary in the target's own directory, which is then renamed over the target.

- The temporary is named `.<target name>.tmp-<16 hex digits>` and is created `O_EXCL`, so a planted path is an error rather than something written through. The name deliberately does not end in `.md`, so an abandoned temporary is never mistaken for a snapshot. Anything enumerating a document's directory should expect such files transiently.
- Renaming over a symlinked target **replaces the link** instead of writing through it, and **breaks a hard link** to the target.
- There is no `fsync`. The write is atomic against concurrent readers, not against a crash: after a power loss a renamed file may be present with unflushed content. Snapshots are a recovery aid; the document itself remains the primary copy.
- Files created through the store have mode `0600`. Replacing an existing document preserves that document's mode; only the temporary is private. File mode is not part of this format, and the two implementations differ: the hook copies snapshots with `cp`, which gives them the document's mode.

The hook writes each snapshot with a single `cp` to its final name, which is not atomic. A reader that encounters a snapshot shorter than expected may be seeing a copy in progress.

## Content

A snapshot file holds the document's content and nothing else: no header, no metadata, no encoding marker. A snapshot of a Roughdraft document is therefore an ordinary Markdown file carrying whatever CriticMarkup the document held.

A snapshot written through the store holds UTF-8 decoded content. A document containing invalid UTF-8 byte sequences is **not** preserved byte-exact; each invalid sequence becomes U+FFFD on decode. The hook copies bytes and does not have this limit.

## Known divergences

Both implementations are conforming; these are the places where they answer differently and where a document can fall between them.

| Point | The store (and this repository's server routes) | The hook |
|---|---|---|
| Documents recognised | Any path ending in `.md`, compared case-insensitively | Only a path matching `*.md` |
| Coalescing applies to | A `save` behind a `save` | Any capture behind any snapshot |
| Coalescing measures | The newest snapshot's id, to the millisecond | The newest snapshot's mtime, to the second |
| Increasing ids | Advanced against the newest id | Left to the clock |
| Snapshot mode | `0600` | The document's mode |
| Snapshot write | Temporary plus rename | `cp` |
| Invalid UTF-8 | Not preserved | Preserved |

Stem derivation is case-sensitive in both. A document named `notes.MD` is consequently accepted by the server, given the stem `notes.MD`, and skipped entirely by the hook. Documents SHOULD use a lowercase `.md` extension.

## Access surfaces

Non-normative. The sidecar is reached through:

- `GET /api/markdown-file/history` and `GET /api/markdown-file/history/:id` — list a document's snapshots and read one.
- `roughdraft history <path>` — list, print, and restore, with no running server. See the CLI reference in [README.md](../../README.md).
- The hook — writes `hook` snapshots before an agent's write; never reads.

Server routes refuse any path containing a `.roughdraft-history` segment, compared case-insensitively, so a snapshot cannot be opened, saved, or reviewed as a document.
