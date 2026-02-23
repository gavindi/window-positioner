import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WindowPositionerExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._windowTracker = Shell.WindowTracker.get_default();
        this._windowConnections = new Map();
        this._pendingRestores = new Map();

        this._windowCreatedId = global.display.connect(
            'window-created',
            this._onWindowCreated.bind(this)
        );

        this._mapId = global.window_manager.connect(
            'map',
            this._onWindowMapped.bind(this)
        );

        this._workspaceChangedId = global.workspace_manager.connect(
            'active-workspace-changed',
            this._saveAllWindows.bind(this)
        );

        this._cleanupOldEntries();
    }

    disable() {
        if (this._windowCreatedId) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
        if (this._mapId) {
            global.window_manager.disconnect(this._mapId);
            this._mapId = null;
        }
        if (this._workspaceChangedId) {
            global.workspace_manager.disconnect(this._workspaceChangedId);
            this._workspaceChangedId = null;
        }

        for (const [_window, timeoutId] of this._pendingRestores) {
            if (timeoutId) {
                GLib.source_remove(timeoutId);
            }
        }
        this._pendingRestores.clear();

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
        return app.get_id();
    }

    _onWindowCreated(_display, window) {
        if (window.get_window_type() !== Meta.WindowType.NORMAL) return;

        this._pendingRestores.set(window, null);

        const connections = [];

        const destroyId = window.connect('unmanaging', () => {
            this._saveWindowPosition(window);
            this._cleanupWindowConnections(window);
        });
        connections.push(destroyId);

        const positionId = window.connect('position-changed', () => {
            this._onWindowPositionChanged(window);
        });
        connections.push(positionId);

        const sizeId = window.connect('size-changed', () => {
            this._onWindowPositionChanged(window);
        });
        connections.push(sizeId);

        this._windowConnections.set(window, connections);
    }

    _onWindowMapped(_shellwm, actor) {
        const window = actor.meta_window;
        if (!window || window.get_window_type() !== Meta.WindowType.NORMAL) return;

        if (!this._pendingRestores.has(window)) return;

        // The compositor actor is guaranteed to exist at this point.
        // Hand off to _scheduleRestore which will attempt the restore after
        // the configured delay (giving the app time to finish its own layout).
        this._scheduleRestore(window);
    }

    _onWindowPositionChanged(window) {
        if (this._pendingRestores.has(window)) {
            return;
        }

        const existing = this._windowConnections.get(window);
        if (existing && existing.saveTimeout) {
            GLib.source_remove(existing.saveTimeout);
        }

        const saveTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            const connections = this._windowConnections.get(window);
            if (connections) {
                connections.saveTimeout = null;
            }
            try {
                if (window.get_compositor_private()) {
                    this._saveWindowPosition(window);
                }
            } catch (_e) {
                // window is gone
            }
            return GLib.SOURCE_REMOVE;
        });

        if (existing) {
            existing.saveTimeout = saveTimeout;
        }
    }

    _scheduleRestore(window) {
        if (!this._pendingRestores.has(window)) return;

        const existingTimeout = this._pendingRestores.get(window);
        if (existingTimeout) {
            GLib.source_remove(existingTimeout);
        }

        const delayMs = this._settings.get_int('restore-delay-ms');
        const maxAttempts = this._settings.get_int('max-restore-attempts');

        let attempts = 0;

        const tryRestore = () => {
            // Clear stored ID immediately — this callback is now running, so the
            // source no longer exists and must not be passed to source_remove.
            this._pendingRestores.set(window, null);

            const debug = this._settings.get_boolean('debug-logging');
            const winKey = this._getWindowKey(window);

            let actor;
            try {
                actor = window.get_compositor_private();
            } catch (_e) {
                // JS wrapper is gone — window truly destroyed.
                if (debug) console.log(`[Window Positioner] tryRestore: wrapper gone for ${winKey}`);
                this._pendingRestores.delete(window);
                return GLib.SOURCE_REMOVE;
            }

            if (debug) console.log(`[Window Positioner] tryRestore: ${winKey} actor=${!!actor} attempts=${attempts}`);

            if (actor) {
                // Window is mapped and ready — attempt the restore.
                attempts++;
                const restored = this._restoreWindowPosition(window);

                if (restored || attempts >= maxAttempts) {
                    this._pendingRestores.delete(window);
                    return GLib.SOURCE_REMOVE;
                }
            }
            // actor === null means the window exists but isn't mapped yet.
            // Keep retrying; use attempts as the overall ceiling so we don't
            // loop forever if the window never gets a compositor actor.
            if (attempts >= maxAttempts) {
                this._pendingRestores.delete(window);
                return GLib.SOURCE_REMOVE;
            }

            const nextTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, tryRestore);
            this._pendingRestores.set(window, nextTimeout);
            return GLib.SOURCE_REMOVE;
        };

        const timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(delayMs, 1), tryRestore);
        this._pendingRestores.set(window, timeout);
    }

    _restoreWindowPosition(window) {
        try {
            const debug = this._settings.get_boolean('debug-logging');

            const winKey = this._getWindowKey(window);
            if (!winKey) {
                if (debug) console.log('[Window Positioner] Restore skipped: no window key');
                return false;
            }

            const positions = this._settings.get_value('window-positions').deep_unpack();
            const monitors = this._settings.get_value('window-monitors').deep_unpack();

            if (!positions[winKey]) {
                if (debug) console.log(`[Window Positioner] Restore skipped: no saved position for ${winKey}`);
                return false;
            }

            const [x, y, width, height] = positions[winKey];
            let monitorIndex = monitors[winKey] ?? 0;

            const display = global.display;
            const nMonitors = display.get_n_monitors();

            if (monitorIndex >= nMonitors) {
                monitorIndex = display.get_primary_monitor();
            }

            const workspace = global.workspace_manager.get_active_workspace();
            const workArea = workspace.get_work_area_for_monitor(monitorIndex);

            let finalWidth = Math.min(Math.max(width, 100), workArea.width);
            let finalHeight = Math.min(Math.max(height, 100), workArea.height);
            let finalX = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - finalWidth));
            let finalY = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - finalHeight));

            if (window.maximized_horizontally || window.maximized_vertically) {
                if (debug) console.log(`[Window Positioner] Restore: unmaximizing ${winKey}`);
                window.unmaximize(Meta.MaximizeFlags.HORIZONTAL | Meta.MaximizeFlags.VERTICAL);
                return false;
            }

            const currentRect = window.get_frame_rect();
            const tolerance = this._settings.get_int('position-tolerance');

            if (debug) console.log(`[Window Positioner] Restore: ${winKey} current=${currentRect.x},${currentRect.y} target=${finalX},${finalY}`);

            if (Math.abs(currentRect.x - finalX) < tolerance &&
                Math.abs(currentRect.y - finalY) < tolerance &&
                Math.abs(currentRect.width - finalWidth) < tolerance &&
                Math.abs(currentRect.height - finalHeight) < tolerance) {
                if (debug) console.log(`[Window Positioner] Restore: ${winKey} already in position`);
                return true;
            }

            if (debug) console.log(`[Window Positioner] Restore: calling move_resize_frame for ${winKey}`);
            window.move_resize_frame(false, finalX, finalY, finalWidth, finalHeight);
            if (debug) console.log(`[Window Positioner] Restored ${winKey} to ${finalX},${finalY} ${finalWidth}x${finalHeight}`);

            return true;
        } catch (e) {
            console.error(`[Window Positioner] Restore exception: ${e}\n${e.stack}`);
            return false;
        }
    }

    _saveWindowPosition(window) {
        try {
            if (window.get_window_type() !== Meta.WindowType.NORMAL) return;
            if (window.maximized_horizontally || window.maximized_vertically) return;

            const winKey = this._getWindowKey(window);
            if (!winKey) return;

            const rect = window.get_frame_rect();
            const monitorIndex = window.get_monitor();

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
            // TypeError means the window's C object has been finalized — normal
            // during unmanaging. Only log genuinely unexpected errors.
            if (!(e instanceof TypeError)) {
                console.error(`[Window Positioner] Failed to save window position: ${e}`);
            }
        }
    }

    _cleanupWindowConnections(window) {
        const pendingTimeout = this._pendingRestores.get(window);
        if (pendingTimeout) {
            GLib.source_remove(pendingTimeout);
        }
        this._pendingRestores.delete(window);

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
