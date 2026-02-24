# Changelog

All notable changes to this project will be documented in this file.

## [1.0] - 2026-02-24

### Changed
- Version bump to 1.0

## [0.2] - 2026-02-24

### Fixed
- Window positions now correctly restored on relaunch
- Replaced `display.get_monitor_work_area()` (unavailable in GNOME 46+) with `workspace.get_work_area_for_monitor()`
- Switched from `window-created` signal to `Shell.WM` `map` signal for restore triggering, ensuring the compositor actor is present before attempting to move windows
- Wrapped entire `_restoreWindowPosition` body in try-catch so exceptions are always logged with the extension prefix
- Replaced `get_maximized()` (unavailable in GJS) with `maximized_horizontally` / `maximized_vertically` property access
- Replaced `is_destroyed()` (unavailable in GJS) with `get_compositor_private()` checks
- Fixed "Source ID not found" warnings by clearing the stored timeout ID at the start of each retry callback
- Fixed window key to use app ID only (was previously including window title, causing save/restore key mismatches)
- Removed dead prototype monkey-patching code

### Changed
- Restore delay minimum lowered from 50ms to 1ms; default changed from 200ms to 1ms

### Added
- Build system (Makefile) with `dist`, `install`, `uninstall`, and `clean` targets
- Schema installation step in `make install` so `gsettings` CLI can access extension settings
- README.md with installation and configuration instructions
- CHANGELOG.md

## [0.1] - 2025-02-24

### Added
- Initial release
- Window position tracking using GSettings
- Window position restoration when apps reopen
- Multi-monitor support via gsettings
- Preferences UI for configuration

### Features
- Tracks window positions, sizes, and monitor assignments
- Automatic cleanup of old entries (configurable)
- Debug logging option
- Multiple positioning methods to force window placement
- Configurable restore delay and retry attempts
