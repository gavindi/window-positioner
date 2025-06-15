import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WindowPositionerExtension extends Extension {
    enable() {
        this._settings = {};
        this._windowTracker = Shell.WindowTracker.get_default();
        this._windowConnections = new Map(); // Track connections per window
        
        this.WINDOW_DATA_FILE = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'gnome-shell',
            'extensions',
            this.uuid,
            'window-positions.json'
        ]);

        // Create data directory if needed
        const dataDir = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'gnome-shell',
            'extensions',
            this.uuid
        ]);
        const file = Gio.File.new_for_path(dataDir);
        if (!file.query_exists(null)) {
            file.make_directory_with_parents(null);
        }

        // Load saved positions
        this._loadSettings();

        // Connect signals
        this._windowCreatedId = global.display.connect(
            'window-created',
            this._onWindowCreated.bind(this)
        );
        this._windowClosedId = global.workspace_manager.connect(
            'active-workspace-changed',
            this._saveAllWindows.bind(this)
        );
    }

    disable() {
        // Disconnect all signals
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        if (this._windowClosedId) {
            global.workspace_manager.disconnect(this._windowClosedId);
            this._windowClosedId = null;
        }
        
        // Disconnect all window-specific connections
        for (const [window, connections] of this._windowConnections) {
            for (const connectionId of connections) {
                window.disconnect(connectionId);
            }
        }
        this._windowConnections.clear();
        
        // Save settings and clean up
        this._saveSettings();
        this._settings = null;
        this._windowTracker = null;
    }

    _loadSettings() {
        try {
            const file = Gio.File.new_for_path(this.WINDOW_DATA_FILE);
            if (file.query_exists(null)) {
                const [success, contents] = file.load_contents(null);
                if (success) {
                    const decoder = new TextDecoder('utf-8');
                    this._settings = JSON.parse(decoder.decode(contents));
                }
            }
        } catch (e) {
            console.error(`[Window Positioner] Error loading settings: ${e}`);
        }
    }

    _saveSettings() {
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(JSON.stringify(this._settings, null, 2));
            const file = Gio.File.new_for_path(this.WINDOW_DATA_FILE);
            file.replace_contents(data, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
        } catch (e) {
            console.error(`[Window Positioner] Error saving settings: ${e}`);
        }
    }

    _getWindowKey(window) {
        const app = this._windowTracker.get_window_app(window);
        if (!app) return null;
        
        const appId = app.get_id();
        const title = window.get_title() || 'unknown';
        
        // Use just app ID for better matching if title is generic
        if (title === 'unknown' || title === '' || title === appId) {
            return appId;
        }
        
        return `${appId}-${title}`;
    }

    _onWindowCreated(display, window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
        
        // Connect to window destruction immediately
        const destroyId = window.connect('unmanaging', () => {
            this._saveWindowPosition(window);
            this._cleanupWindowConnections(window);
        });
        
        // Also connect to notify::title in case title changes
        const titleId = window.connect('notify::title', () => {
            this._tryRestorePosition(window);
        });
        
        this._windowConnections.set(window, [destroyId, titleId]);
        
        // Try to restore position with multiple attempts
        this._tryRestorePosition(window);
    }

    _tryRestorePosition(window) {
        // Try immediately
        this._restoreWindowPosition(window);
        
        // Try again after 100ms in case title wasn't ready
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!window.is_destroyed()) {
                this._restoreWindowPosition(window);
            }
            return GLib.SOURCE_REMOVE;
        });
        
        // Final attempt after 300ms for slow applications
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            if (!window.is_destroyed()) {
                this._restoreWindowPosition(window);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _restoreWindowPosition(window) {
        const winKey = this._getWindowKey(window);
        if (!winKey || !this._settings[winKey]) return;
        
        const saved = this._settings[winKey];
        
        // Get current monitor setup
        const display = global.display;
        const nMonitors = display.get_n_monitors();
        
        // Validate saved monitor index
        let monitorIndex = saved.monitor;
        if (monitorIndex >= nMonitors) {
            monitorIndex = display.get_primary_monitor();
        }
        
        // Get monitor geometry
        const monitorGeometry = display.get_monitor_geometry(monitorIndex);
        const workArea = display.get_monitor_work_area(monitorIndex);
        
        let [x, y] = saved.position;
        let [width, height] = saved.size;
        
        // Ensure minimum size
        width = Math.max(width, 100);
        height = Math.max(height, 100);
        
        // Constrain to work area (accounts for panels, docks, etc.)
        width = Math.min(width, workArea.width);
        height = Math.min(height, workArea.height);
        
        // Adjust position to ensure window is visible
        x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
        y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
        
        // Apply the position
        try {
            if (window.get_maximized() !== Meta.MaximizeFlags.NONE) {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
            }
            
            // Use move_resize_frame for better reliability
            window.move_resize_frame(false, x, y, width, height);
            
            console.log(`[Window Positioner] Restored ${winKey} to ${x},${y} ${width}x${height}`);
        } catch (e) {
            console.error(`[Window Positioner] Failed to restore window position: ${e}`);
        }
    }

    _saveWindowPosition(window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
        if (window.get_maximized() !== Meta.MaximizeFlags.NONE) return;
        
        const winKey = this._getWindowKey(window);
        if (!winKey) return;
        
        try {
            // Get window geometry
            const rect = window.get_frame_rect();
            const monitorIndex = window.get_monitor();
            
            // Don't save if window is too small (likely minimized or in weird state)
            if (rect.width < 50 || rect.height < 50) return;
            
            this._settings[winKey] = {
                position: [rect.x, rect.y],
                size: [rect.width, rect.height],
                monitor: monitorIndex,
                timestamp: Date.now() // For potential cleanup of old entries
            };
            
            this._saveSettings();
            console.log(`[Window Positioner] Saved ${winKey} at ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
        } catch (e) {
            console.error(`[Window Positioner] Failed to save window position: ${e}`);
        }
    }

    _cleanupWindowConnections(window) {
        const connections = this._windowConnections.get(window);
        if (connections) {
            for (const connectionId of connections) {
                try {
                    window.disconnect(connectionId);
                } catch (e) {
                    // Window might already be destroyed
                }
            }
            this._windowConnections.delete(window);
        }
    }

    _saveAllWindows() {
        // Save all tracked windows when workspace changes
        try {
            const windows = global.get_window_actors()
                .map(actor => actor.meta_window)
                .filter(window => window && window.get_window_type() === Meta.WindowType.NORMAL);
                
            for (const window of windows) {
                this._saveWindowPosition(window);
            }
        } catch (e) {
            console.error(`[Window Positioner] Error saving all windows: ${e}`);
        }
    }
}
