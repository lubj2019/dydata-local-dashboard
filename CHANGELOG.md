# Changelog

## 1.0.4 - 2026-08-19

### Added

- Add dashboard and video-level daily play growth against the previous Shanghai-date snapshot.
- Restore video task association and play-delta columns while keeping unique-video aggregation.

### Improved

- Combine active and pending account counts into a two-row account status metric.
- Keep all video table columns visible with fixed widths and ellipsis for long task names.

## 1.0.3 - 2026-08-09

### Improved

- Refine the v1 dashboard hierarchy, color system, spacing, surfaces, and data typography.
- Add responsive layouts for desktop, narrow desktop, and mobile workspaces.
- Add loading skeletons, keyboard focus states, and an explicit details-drawer close action.
- Improve scanning and state feedback across task, account, video, and analytics pages.
- Align the task filter toolbar and export button with the dashboard control styling.

## 1.0.2 - 2026-08-09

### Improved

- Group videos from the same account and Star Map mission into one collapsible task card.
- Summarize task-level amounts once and aggregate video-level playback and settlement metrics.
- Hide the unclear manual video-binding action from the task analysis page.

## 1.0.1 - 2026-08-09

### Improved

- Show each account's real-time sync status while a single-account sync is running.
- Give immediate feedback from the manual sync button and keep other accounts available for operation.
- Poll account sync status so progress remains visible after a page refresh.

## 0.4.0 - 2026-07-21

### Added

- Synchronize and display each account's Douyin ID on the account card.
- Export all account names and Douyin IDs to `账号信息.xlsx`.
