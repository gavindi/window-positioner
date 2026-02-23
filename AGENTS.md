# Window Positioner - GNOME Shell Extension

## Purpose
Remembers and restores window positions on GNOME desktop. When apps are reopened, they return to where they were last closed.

## Architecture

### Files
- `extension.js` - Main extension (450 lines)
- `prefs.js` - Preferences UI (219 lines)
- `metadata.json` - Extension manifest (GNOME Shell 48)
- `schemas/org.gnome.shell.extensions.window-positioner.gschema.xml` - GSettings schema

### Key Features
- Tracks window positions using GSettings (window-positions, window-monitors, window-timestamps)
- Window key = `appId` or `appId-title`
- Hooks: `window-created`, `unmanaging`, `position-changed`, `size-changed`, `notify::title`, `focus`
- Uses multiple positioning methods to force window position

### Settings
- `restore-delay-ms`: 200ms default
- `max-restore-attempts`: 5 default
- `cleanup-days`: 30 default
- `debug-logging`: false default
- `aggressive-positioning`: true default
- `position-tolerance`: 5 default
