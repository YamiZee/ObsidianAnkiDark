import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ankify } from './src/parser';

interface MyPluginSettings {
	mySetting: string;
	cardsAdded: number;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	cardsAdded: 0
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();
		
		// Add ribbon icon for reading current file
		this.addRibbonIcon('file-text', 'Ankify', async () => {
			const info = await ankify(this.app);
			if (info && typeof info.cardsAdded === 'number' && typeof info.cardsUpdated === 'number') {
				if (info.cardsAdded > 0 || info.cardsUpdated > 0) {
					new Notice(`Note Ankified! ${info.cardsAdded} cards added, ${info.cardsUpdated} cards updated!`);
					this.settings.cardsAdded += info.cardsAdded;
					await this.saveSettings();
				} else {
					new Notice('No cards found!');
				}
			} else {
				console.log('info:', info);
				new Notice('No active file found!');
			}
		});

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`${this.settings.cardsAdded} cards.`);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
