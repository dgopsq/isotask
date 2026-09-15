# 0019. Completed feed bucket

## Status

Accepted, 2026-09-15

## Context

The generated `Tasks.base` file filtered out every done-kind status at the file level
(`status != "done"`, one per done status), hiding done tasks from every view. The feed
bucketed all tasks by date, so even when done tasks were visible, they scattered across date
buckets instead of grouping at a predictable place.

## Decision

1. The generated `.base` file no longer excludes done-kind statuses at the file level. The
   file-level filter keeps only the marker (`type == "task"`). Done-status exclusions move to
   a per-view `filters:` block on the Calendar view only.
2. A new feed bucket, `Completed`, is placed after `No date` in `BUCKET_ORDER`. When the feed
   view option `completedAtBottom` is on (default), every task whose status kind is `done` is
   routed to this bucket regardless of its date. When `completedAtBottom` is off, tasks bucket
   by date as before and there is no terminal/non-terminal split.
3. Within `Completed`, the smart order (when no Bases toolbar sort is configured) is `completed`
   date descending (newest first), tasks without a `completed` date last, then title ascending.

## Consequences

Positive:
- The Feed view now shows all done tasks grouped together rather than scattered across date
  buckets, making it easier to review completed work and find tasks to reopen.
- The Calendar view is unaffected — it still excludes done tasks (per-view filter), preserving
  the original focus on open work.
- The "All tasks" table generated from `.base` now literally includes all tasks.

Negative:
- The Feed can grow unbounded with undated done tasks if not pruned.
- Existing `.base` files with file-level done-status filters must be regenerated or edited by
  hand to remove `status != "done"` lines at the file level.
- If `completedAtBottom` is off, users see done tasks mixed throughout date buckets again.

## Alternatives considered

- **Keep per-bucket terminal sorting, move only the file-level filter.** Rejected: scatters done
  tasks across date buckets even when grouped by status; the user loses the benefit of grouping.
- **A feed-only "show completed" toggle instead of a bucket.** Rejected: views never filter
  (see `docs/ARCHITECTURE.md#why-views-never-filter`); a toggle would make two Bases views
  render different sets of entries from the same `.base` file, breaking the guarantees that
  keep the plugin predictable. Which tasks the feed shows stays a `.base` filter decision;
  the bucket only decides where done tasks render.
