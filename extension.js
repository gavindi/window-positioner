import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WindowPositionerExtension extends Extension {
    enable() {
        this._settings = {};
        this._windowTracker = Shell.WindowTracker.get_default();  // Corrected window tracker
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
        // Disconnect signals
        global.display.disconnect(this._windowCreatedId);
        global.workspace_manager.disconnect(this._windowClosedId);
        
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

    _onWindowCreated(display, window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
        
        const app = this._windowTracker.get_window_app(window);
        if (!app) return;
        
        const appId = app.get_id();
        const winKey = `${appId}-${window.title}`;
        
        if (this._settings[winKey]) {
            const saved = this._settings[winKey];
            const monitors = global.display.get_monitors();
            
            // Find appropriate monitor
            let monitor = null;
            if (saved.monitor < monitors.length) {
                monitor = monitors[saved.monitor];
            } else {
                // Fallback to primary or first monitor
                monitor = monitors.find(m => m.is_primary()) || monitors[0];
            }
            
            // Adjust position to fit current monitor
            const workArea = monitor.get_work_area();
            let [x, y] = saved.position;
            let [width, height] = saved.size;
            
            // Constrain to monitor boundaries
            width = Math.min(width, workArea.width);
            height = Math.min(height, workArea.height);
            x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
            y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
            
            // Apply with delay for better compatibility
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                if (window.is_destroyed()) return GLib.SOURCE_REMOVE;
                
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                window.move_resize_frame(true, x, y, width, height);
                return GLib.SOURCE_REMOVE;
            });
        }
        
        // Connect to window destruction
        this._windowDestroyId = window.connect('destroy', () => {
            this._saveWindowPosition(window);
        });
    }

    _saveWindowPosition(window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
        if (window.maximized_horizontally || window.maximized_vertically) return;
        
        const app = this._windowTracker.get_window_app(window);
        if (!app) return;
        
        const appId = app.get_id();
        const winKey = `${appId}-${window.title}`;
        
        // Save window geometry
        const rect = window.get_frame_rect();
        this._settings[winKey] = {
            position: [rect.x, rect.y],
            size: [rect.width, rect.height],
            monitor: window.get_monitor()
        };
        
        this._saveSettings();
    }

    _saveAllWindows() {
        // Save all tracked windows when workspace changes
        const windows = global.get_window_actors()
            .map(actor => actor.meta_window)
            .filter(window => window.get_window_type() === Meta.WindowType.NORMAL);
            
        for (const window of windows) {
            this._saveWindowPosition(window);
        }
    }
}
