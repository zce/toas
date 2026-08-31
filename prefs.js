import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class VoicePromptPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Voice Prompt',
            icon_name: 'audio-input-microphone-symbolic',
        });

        const inputGroup = new Adw.PreferencesGroup({
            title: 'Push-to-Talk',
            description: 'Hold the shortcut, speak, then release the modifiers to finish.',
        });

        const shortcut = new Adw.EntryRow({
            title: 'Shortcut',
            text: settings.get_strv('push-to-talk')[0] ?? '',
        });
        const shortcutLabel = new Gtk.ShortcutLabel({
            accelerator: shortcut.text,
            valign: Gtk.Align.CENTER,
        });
        shortcut.add_suffix(shortcutLabel);
        shortcut.connect('changed', () => {
            const value = shortcut.text.trim();
            settings.set_strv('push-to-talk', value ? [value] : []);
            shortcutLabel.accelerator = value;
        });

        const restoreClipboard = new Adw.SwitchRow({
            title: 'Restore text clipboard',
            subtitle: 'Restore the previous clipboard text after auto-paste.',
        });
        settings.bind(
            'restore-clipboard',
            restoreClipboard,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        inputGroup.add(shortcut);
        inputGroup.add(restoreClipboard);

        const asrGroup = new Adw.PreferencesGroup({
            title: 'Fun-ASR Realtime',
            description: 'The legacy DashScope endpoint remains supported; a workspace-specific Beijing endpoint is recommended.',
        });

        asrGroup.add(entry(settings, 'asr-endpoint', 'WebSocket endpoint'));
        asrGroup.add(entry(settings, 'asr-model', 'Model'));
        asrGroup.add(passwordEntry(
            settings,
            'asr-api-key',
            'API key',
            'If empty, DASHSCOPE_API_KEY is used from the GNOME session environment.'
        ));

        const builderGroup = new Adw.PreferencesGroup({
            title: 'Prompt Builder',
            description: 'One non-streaming OpenAI-compatible chat-completions call after ASR. Failure falls back to the raw transcript.',
        });

        const builderEnabled = new Adw.SwitchRow({
            title: 'Enable Prompt Builder',
            subtitle: 'Disable for literal dictation.',
        });
        settings.bind(
            'prompt-builder-enabled',
            builderEnabled,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );

        builderGroup.add(builderEnabled);
        builderGroup.add(entry(
            settings,
            'prompt-builder-endpoint',
            'Chat completions endpoint',
            'Example: https://example.com/v1/chat/completions'
        ));
        builderGroup.add(entry(settings, 'prompt-builder-model', 'Model'));
        builderGroup.add(passwordEntry(
            settings,
            'prompt-builder-api-key',
            'API key',
            'Fallback: VOICE_PROMPT_API_KEY, then OPENAI_API_KEY.'
        ));
        builderGroup.add(entry(
            settings,
            'prompt-builder-system-prompt',
            'System prompt',
            'Keep this focused on semantic normalization rather than requirement invention.'
        ));

        const securityGroup = new Adw.PreferencesGroup({
            title: 'Prototype notes',
            description: 'Keys entered here are stored in dconf as plain text. For a cleaner setup, leave key fields empty and provide environment variables before logging into GNOME.',
        });

        page.add(inputGroup);
        page.add(asrGroup);
        page.add(builderGroup);
        page.add(securityGroup);
        window.add(page);
    }
}

function entry(settings, key, title, tooltip = '') {
    const row = new Adw.EntryRow({
        title,
        text: settings.get_string(key),
    });

    if (tooltip)
        row.set_tooltip_text(tooltip);

    row.connect('changed', () => {
        settings.set_string(key, row.text);
    });

    return row;
}

function passwordEntry(settings, key, title, tooltip = '') {
    const row = new Adw.PasswordEntryRow({
        title,
        text: settings.get_string(key),
    });

    if (tooltip)
        row.set_tooltip_text(tooltip);

    row.connect('changed', () => {
        settings.set_string(key, row.text);
    });

    return row;
}
