import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class WindowPositionerPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        // Create main page
        const page = new Adw.PreferencesPage({
            title: 'Window Positioner Settings',
            icon_name: 'applications-system-symbolic',
        });
        window.add(page);

        // Behavior group
        const behaviorGroup = new Adw.PreferencesGroup({
            title: 'Behavior',
            description: 'Configure how window positions are restored',
        });
        page.add(behaviorGroup);

        // Restore delay setting
        const delayRow = new Adw.SpinRow({
            title: 'Restore Delay',
            subtitle: 'Delay in milliseconds before attempting to restore window position',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 2000,
                step_increment: 50,
                page_increment: 100,
            }),
        });
        settings.bind('restore-delay-ms', delayRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(delayRow);

        // Max attempts setting
        const attemptsRow = new Adw.SpinRow({
            title: 'Maximum Restore Attempts',
            subtitle: 'Number of times to attempt restoring window position',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 15,
                step_increment: 1,
                page_increment: 1,
            }),
        });
        settings.bind('max-restore-attempts', attemptsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(attemptsRow);

        // Position tolerance setting
        const toleranceRow = new Adw.SpinRow({
            title: 'Position Tolerance',
            subtitle: 'Pixels of tolerance before forcing a window move (0 = always move)',
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                step_increment: 1,
                page_increment: 5,
            }),
        });
        settings.bind('position-tolerance', toleranceRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        behaviorGroup.add(toleranceRow);

        // Maintenance group
        const maintenanceGroup = new Adw.PreferencesGroup({
            title: 'Maintenance',
            description: 'Configure data cleanup and debugging',
        });
        page.add(maintenanceGroup);

        // Cleanup days setting
        const cleanupRow = new Adw.SpinRow({
            title: 'Cleanup After Days',
            subtitle: 'Remove window position data older than this many days',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 365,
                step_increment: 1,
                page_increment: 7,
            }),
        });
        settings.bind('cleanup-days', cleanupRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        maintenanceGroup.add(cleanupRow);

        // Debug logging switch
        const debugRow = new Adw.SwitchRow({
            title: 'Debug Logging',
            subtitle: 'Enable detailed logging for troubleshooting',
        });
        settings.bind('debug-logging', debugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        maintenanceGroup.add(debugRow);

        // Data management group
        const dataGroup = new Adw.PreferencesGroup({
            title: 'Data Management',
            description: 'View and manage saved window positions',
        });
        page.add(dataGroup);

        // Stats row
        const statsRow = new Adw.ActionRow({
            title: 'Saved Window Positions',
            subtitle: this._getStatsText(settings),
        });
        
        const refreshButton = new Gtk.Button({
            label: 'Refresh',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        refreshButton.connect('clicked', () => {
            statsRow.set_subtitle(this._getStatsText(settings));
        });
        statsRow.add_suffix(refreshButton);
        dataGroup.add(statsRow);

        // Clear data button
        const clearRow = new Adw.ActionRow({
            title: 'Clear All Data',
            subtitle: 'Remove all saved window positions',
        });
        
        const clearButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearButton.connect('clicked', () => {
            this._showClearDialog(window, settings, () => {
                statsRow.set_subtitle(this._getStatsText(settings));
            });
        });
        clearRow.add_suffix(clearButton);
        dataGroup.add(clearRow);

        // Manual cleanup button
        const cleanupNowRow = new Adw.ActionRow({
            title: 'Cleanup Old Entries Now',
            subtitle: 'Remove entries older than the configured number of days',
        });
        
        const cleanupButton = new Gtk.Button({
            label: 'Clean Up',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        cleanupButton.connect('clicked', () => {
            this._cleanupOldEntries(settings);
            statsRow.set_subtitle(this._getStatsText(settings));
        });
        cleanupNowRow.add_suffix(cleanupButton);
        dataGroup.add(cleanupNowRow);
    }

    _getStatsText(settings) {
        try {
            const positions = settings.get_value('window-positions').deep_unpack();
            const count = Object.keys(positions).length;
            
            if (count === 0) {
                return 'No saved positions';
            } else if (count === 1) {
                return '1 window position saved';
            } else {
                return `${count} window positions saved`;
            }
        } catch (e) {
            return 'Error reading data';
        }
    }

    _showClearDialog(parent, settings, callback) {
        const dialog = new Adw.AlertDialog({
            heading: 'Clear All Window Positions?',
            body: 'This will permanently delete all saved window positions. This action cannot be undone.',
        });

        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('clear', 'Clear All');
        dialog.set_response_appearance('clear', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response('cancel');

        dialog.connect('response', (_dialog, response) => {
            if (response === 'clear') {
                settings.set_value('window-positions', new GLib.Variant('a{s(iiii)}', {}));
                settings.set_value('window-monitors', new GLib.Variant('a{si}', {}));
                settings.set_value('window-timestamps', new GLib.Variant('a{sx}', {}));

                if (callback) callback();
            }
        });

        dialog.present(parent);
    }

    _cleanupOldEntries(settings) {
        try {
            const cleanupDays = settings.get_int('cleanup-days');
            const cutoffTime = GLib.get_real_time() - (cleanupDays * 24 * 60 * 60 * 1000000);
            
            const positions = settings.get_value('window-positions').deep_unpack();
            const monitors = settings.get_value('window-monitors').deep_unpack();
            const timestamps = settings.get_value('window-timestamps').deep_unpack();
            
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
                settings.set_value('window-positions', new GLib.Variant('a{s(iiii)}', positions));
                settings.set_value('window-monitors', new GLib.Variant('a{si}', monitors));
                settings.set_value('window-timestamps', new GLib.Variant('a{sx}', timestamps));
            }
            
        } catch (e) {
            console.error('Error during cleanup:', e);
        }
    }
}
