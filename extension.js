import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WindowPositionerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._windowConnections = new Map();
        this._pendingRestores = new Map(); // Track windows waiting for restoration
        
        // Connect signals
        this._windowCreatedId = global.display.connect(
            'window-created',
            this._onWindowCreated.bind(this)
        );
        
        this._workspaceChangedId = global.workspace_manager.connect(
            'active-workspace-changed',
            this._saveAllWindows.bind(this)
        );

        // Hook into window manager to intercept positioning
        this._originalMoveResizeFrame = Meta.Window.prototype.move_resize_frame;
        this._originalMove = Meta.Window.prototype.move;
        this._originalResize = Meta.Window.prototype.resize;

        this._cleanupOldEntries();
    }

    disable() {
        // Restore original methods
        if (this._originalMoveResizeFrame) {
            Meta.Window.prototype.move_resize_frame = this._originalMoveResizeFrame;
        }
        if (this._originalMove) {
            Meta.Window.prototype.move = this._originalMove;
        }
        if (this._originalResize) {
            Meta.Window.prototype.resize = this._originalResize;
        }

        // Disconnect all signals
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        if (this._workspaceChangedId) {
            global.workspace_manager.disconnect(this._workspaceChangedId);
            this._workspaceChangedId = null;
        }
        
        // Clear pending restores
        for (const [window, timeoutId] of this._pendingRestores) {
            if (timeoutId) {
                GLib.source_remove(timeoutId);
            }
        }
        this._pendingRestores.clear();
        
        // Disconnect all window-specific connections
        for (const [window, connections] of this._windowConnections) {
            for (const connectionId of connections) {
                try {
                    window.disconnect(connectionId);
                } catch (e) {
                    // Window might already be destroyed
                }
            }
        }
        this._windowConnections.clear();
        
        this._saveAllWindows();
        this._settings = null;
        this._windowTracker = null;
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
        
        // Mark window as needing restoration
        this._pendingRestores.set(window, null);
        
        const connections = [];
        
        // Connect to window destruction
        const destroyId = window.connect('unmanaging', () => {
            this._saveWindowPosition(window);
            this._cleanupWindowConnections(window);
        });
        connections.push(destroyId);
        
        // Connect to title changes
        const titleId = window.connect('notify::title', () => {
            if (this._pendingRestores.has(window)) {
                this._scheduleRestore(window);
            }
        });
        connections.push(titleId);
        
        // Connect to position changes to detect when GNOME moves the window
        const positionId = window.connect('position-changed', () => {
            this._onWindowPositionChanged(window);
        });
        connections.push(positionId);
        
        // Connect to size changes
        const sizeId = window.connect('size-changed', () => {
            this._onWindowSizeChanged(window);
        });
        connections.push(sizeId);
        
        // Connect to focus events to ensure positioning
        const focusId = window.connect('focus', () => {
            if (this._pendingRestores.has(window)) {
                this._scheduleRestore(window);
            }
        });
        connections.push(focusId);
        
        this._windowConnections.set(window, connections);
        
        // Schedule initial restore
        this._scheduleRestore(window);
    }

    _onWindowPositionChanged(window) {
        // If window is pending restore, don't interfere yet
        if (this._pendingRestores.has(window)) {
            return;
        }
        
        // Save the new position after a brief delay to avoid saving intermediate positions
        const existing = this._windowConnections.get(window);
        if (existing && existing.saveTimeout) {
            GLib.source_remove(existing.saveTimeout);
        }
        
        const saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            if (!window.is_destroyed()) {
                this._saveWindowPosition(window);
            }
            const connections = this._windowConnections.get(window);
            if (connections) {
                connections.saveTimeout = null;
            }
            return GLib.SOURCE_REMOVE;
        });
        
        if (existing) {
            existing.saveTimeout = saveTimeout;
        }
    }

    _onWindowSizeChanged(window) {
        this._onWindowPositionChanged(window); // Same logic for size changes
    }

    _scheduleRestore(window) {
        if (!this._pendingRestores.has(window)) return;
        
        // Cancel existing timeout
        const existingTimeout = this._pendingRestores.get(window);
        if (existingTimeout) {
            GLib.source_remove(existingTimeout);
        }
        
        const delayMs = this._settings.get_int('restore-delay-ms');
        const maxAttempts = this._settings.get_int('max-restore-attempts');
        
        let attempts = 0;
        
        const tryRestore = () => {
            if (window.is_destroyed()) {
                this._pendingRestores.delete(window);
                return GLib.SOURCE_REMOVE;
            }
            
            attempts++;
            const restored = this._restoreWindowPosition(window);
            
            if (restored) {
                // Success - remove from pending
                this._pendingRestores.delete(window);
                return GLib.SOURCE_REMOVE;
            }
            
            if (attempts >= maxAttempts) {
                // Give up
                this._pendingRestores.delete(window);
                return GLib.SOURCE_REMOVE;
            }
            
            // Schedule next attempt
            const nextTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, tryRestore);
            this._pendingRestores.set(window, nextTimeout);
            return GLib.SOURCE_REMOVE;
        };
        
        // Start first attempt
        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(delayMs, 50), tryRestore);
        this._pendingRestores.set(window, timeout);
    }

    _restoreWindowPosition(window) {
        const winKey = this._getWindowKey(window);
        if (!winKey) return false;
        
        const positions = this._settings.get_value('window-positions').deep_unpack();
        const monitors = this._settings.get_value('window-monitors').deep_unpack();
        
        if (!positions[winKey]) return false;
        
        const [x, y, width, height] = positions[winKey];
        let monitorIndex = monitors[winKey] || 0;
        
        // Get current monitor setup
        const display = global.display;
        const nMonitors = display.get_n_monitors();
        
        // Validate saved monitor index
        if (monitorIndex >= nMonitors) {
            monitorIndex = display.get_primary_monitor();
        }
        
        // Get monitor geometry
        const workArea = display.get_monitor_work_area(monitorIndex);
        
        let finalX = x;
        let finalY = y;
        let finalWidth = Math.max(width, 100);
        let finalHeight = Math.max(height, 100);
        
        // Constrain to work area
        finalWidth = Math.min(finalWidth, workArea.width);
        finalHeight = Math.min(finalHeight, workArea.height);
        
        // Adjust position to ensure window is visible
        finalX = Math.max(workArea.x, Math.min(finalX, workArea.x + workArea.width - finalWidth));
        finalY = Math.max(workArea.y, Math.min(finalY, workArea.y + workArea.height - finalHeight));
        
        try {
            // Check if position is already correct (within tolerance)
            const currentRect = window.get_frame_rect();
            const tolerance = 5;
            
            if (Math.abs(currentRect.x - finalX) < tolerance &&
                Math.abs(currentRect.y - finalY) < tolerance &&
                Math.abs(currentRect.width - finalWidth) < tolerance &&
                Math.abs(currentRect.height - finalHeight) < tolerance) {
                return true; // Already in correct position
            }
            
            // Unmaximize if needed
            if (window.get_maximized() !== Meta.MaximizeFlags.NONE) {
                window.unmaximize(Meta.MaximizeFlags.BOTH);
                
                // Wait a moment for unmaximize to complete
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (!window.is_destroyed()) {
                        this._forceWindowPosition(window, finalX, finalY, finalWidth, finalHeight);
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                this._forceWindowPosition(window, finalX, finalY, finalWidth, finalHeight);
            }
            
            if (this._settings.get_boolean('debug-logging')) {
                console.log(`[Window Positioner] Restored ${winKey} to ${finalX},${finalY} ${finalWidth}x${finalHeight}`);
            }
            
            return true;
        } catch (e) {
            console.error(`[Window Positioner] Failed to restore window position: ${e}`);
            return false;
        }
    }

    _forceWindowPosition(window, x, y, width, height) {
        // Try multiple methods to force position
        
        // Method 1: Direct move_resize_frame
        window.move_resize_frame(false, x, y, width, height);
        
        // Method 2: Use lower-level move and resize
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
            if (!window.is_destroyed()) {
                window.move(false, x, y);
                window.resize(false, width, height);
            }
            return GLib.SOURCE_REMOVE;
        });
        
        // Method 3: Force through window actor if available
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            if (!window.is_destroyed()) {
                const actor = window.get_compositor_private();
                if (actor) {
                    actor.set_position(x, y);
                    actor.set_size(width, height);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
        
        // Method 4: Final verification and correction
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!window.is_destroyed()) {
                const currentRect = window.get_frame_rect();
                const tolerance = 10;
                
                if (Math.abs(currentRect.x - x) > tolerance ||
                    Math.abs(currentRect.y - y) > tolerance) {
                    // Position still wrong, try one more time
                    window.move_resize_frame(false, x, y, width, height);
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _saveWindowPosition(window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
        if (window.get_maximized() !== Meta.MaximizeFlags.NONE) return;
        
        const winKey = this._getWindowKey(window);
        if (!winKey) return;
        
        try {
            const rect = window.get_frame_rect();
            const monitorIndex = window.get_monitor();
            
            // Don't save if window is too small
            if (rect.width < 50 || rect.height < 50) return;
            
            const positions = this._settings.get_value('window-positions').deep_unpack();
            const monitors = this._settings.get_value('window-monitors').deep_unpack();
            const timestamps = this._settings.get_value('window-timestamps').deep_unpack();
            
            positions[winKey] = [rect.x, rect.y, rect.width, rect.height];
            monitors[winKey] = monitorIndex;
            timestamps[winKey] = GLib.get_real_time();
            
            this._settings.set_value('window-positions', new GLib.Variant('a{s(iiii)}', positions));
            this._settings.set_value('window-monitors', new GLib.Variant('a{si}', monitors));
            this._settings.set_value('window-timestamps', new GLib.Variant('a{sx}', timestamps));
            
            if (this._settings.get_boolean('debug-logging')) {
                console.log(`[Window Positioner] Saved ${winKey} at ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
            }
        } catch (e) {
            console.error(`[Window Positioner] Failed to save window position: ${e}`);
        }
    }

    _cleanupWindowConnections(window) {
        // Clear pending restore
        const pendingTimeout = this._pendingRestores.get(window);
        if (pendingTimeout) {
            GLib.source_remove(pendingTimeout);
        }
        this._pendingRestores.delete(window);
        
        // Clear connections
        const connections = this._windowConnections.get(window);
        if (connections) {
            for (const connectionId of connections) {
                try {
                    if (typeof connectionId === 'number') {
                        window.disconnect(connectionId);
                    }
                } catch (e) {
                    // Window might already be destroyed
                }
            }
            
            // Clear save timeout if exists
            if (connections.saveTimeout) {
                GLib.source_remove(connections.saveTimeout);
            }
            
            this._windowConnections.delete(window);
        }
    }

    _saveAllWindows() {
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

    _cleanupOldEntries() {
        try {
            const cleanupDays = this._settings.get_int('cleanup-days');
            const cutoffTime = GLib.get_real_time() - (cleanupDays * 24 * 60 * 60 * 1000000);
            
            const positions = this._settings.get_value('window-positions').deep_unpack();
            const monitors = this._settings.get_value('window-monitors').deep_unpack();
            const timestamps = this._settings.get_value('window-timestamps').deep_unpack();
            
            let cleaned = 0;
            for (const [key, timestamp] of Object.entries(timestamps)) {
                if (timestamp < cutoffTime) {
                    delete positions[key];
                    delete monitors[key];
                    delete timestamps[key];
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                this._settings.set_value('window-positions', new GLib.Variant('a{s(iiii)}', positions));
                this._settings.set_value('window-monitors', new GLib.Variant('a{si}', monitors));
                this._settings.set_value('window-timestamps', new GLib.Variant('a{sx}', timestamps));
                
                if (this._settings.get_boolean('debug-logging')) {
                    console.log(`[Window Positioner] Cleaned up ${cleaned} old entries`);
                }
            }
        } catch (e) {
            console.error('[Window Positioner] Error during cleanup:', e);
        }
    }
}
