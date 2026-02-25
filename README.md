<img src="https://github.com/gavindi/window-positioner/blob/master/icons/Window%20Positioner%201.png?raw=true" alt="title" width="5%">

# Window Positioner - Gnome Extension

A GNOME Shell extension that remembers and restores the position and size of application windows. When a tracked application is opened, it is automatically moved back to where it was last seen.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/P5P21M7MBS)

[![GitHub](https://img.shields.io/badge/GitHub-gavindi%2Fwindow--positioner-24292e?logo=github&logoColor=white)](https://github.com/gavindi/window-positioner)

## Features

- Saves window position, size, and monitor assignment per application
- Restores windows to their last known position on launch
- Handles multi-monitor setups, falling back to the primary monitor if the saved monitor is no longer available
- Automatically cleans up stale position data for applications not seen within a configurable number of days
- Configurable restore delay and retry attempts to handle applications that reposition themselves during startup

## Requirements

- GNOME Shell 46, 47, 48, 49, or 50

## Installation

### From the GNOME Extensions website

Visit [extensions.gnome.org](https://extensions.gnome.org) and search for **Window Positioner**.

### From a release zip

1. Download the latest `window-positioner@gavindi.github.com.zip` from the [releases page](https://github.com/gavindi/window-positioner/releases)
2. Install it:
   ```bash
   gnome-extensions install window-positioner@gavindi.github.com.zip
   ```
3. Register the GSettings schema so preferences are accessible:
   ```bash
   mkdir -p ~/.local/share/glib-2.0/schemas
   cp schemas/org.gnome.shell.extensions.window-positioner.gschema.xml ~/.local/share/glib-2.0/schemas/
   glib-compile-schemas ~/.local/share/glib-2.0/schemas
   ```
4. Log out and back in (or restart GNOME Shell on X11 with `Alt+F2` → `r`)
5. Enable the extension:
   ```bash
   gnome-extensions enable window-positioner@gavindi.github.com
   ```

### From source using Make

```bash
git clone https://github.com/gavindi/window-positioner
cd window-positioner@gavindi.github.com
make install
```

`make install` builds the zip, installs the extension, and registers the GSettings schema in one step.

Log out and back in, then enable the extension:

```bash
gnome-extensions enable window-positioner@gavindi.github.com
```

## Configuration

Open the extension preferences via GNOME Extensions app or:

```bash
gnome-extensions prefs window-positioner@gavindi.github.com
```

| Setting | Default | Description |
|---|---|---|
| Restore Delay | 1 ms | How long to wait after a window opens before attempting to restore its position. Increase this for applications that move themselves during startup. |
| Maximum Restore Attempts | 5 | How many times to retry restoring a position if the first attempt fails. |
| Cleanup After Days | 30 | Position data for applications not seen within this many days is automatically removed. |
| Debug Logging | Off | Logs save and restore events to the GNOME Shell journal for troubleshooting. |

To view debug output when enabled:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep "Window Positioner"
```

## Development

### Build

```bash
make dist
```

Produces `build/window-positioner@gavindi.github.com.zip`.

### Install from source

```bash
make install
```

### Uninstall

```bash
make uninstall
```

### Clean build output

```bash
make clean
```

## License

GPL-2.0-or-later
