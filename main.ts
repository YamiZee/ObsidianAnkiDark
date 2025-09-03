import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ankify } from './src/parser';
import { livePreviewPostProcessor, markdownPostProcessor } from './src/highlighter';

interface MyPluginSettings {
	mySetting: string;
	cardsAdded: number;
	enableHighlighter: boolean;
	showHighlighterRibbon: boolean;
	defaultDeck: string;
	firstHighlightColor: string;
	secondHighlightColor: string;
	firstHighlightOpacity: number;
	secondHighlightOpacity: number;
	clozeHighlightColor: string;
	clozeHighlightOpacity: number;
	customCSS: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	cardsAdded: 0,
	enableHighlighter: false,
	showHighlighterRibbon: true,
	defaultDeck: 'Obsidian',
	firstHighlightColor: '#e0c2ff',
	secondHighlightColor: '#c9b3db',
	firstHighlightOpacity: 0.1,
	secondHighlightOpacity: 0.05,
	clozeHighlightColor: '#a77ea9',
	clozeHighlightOpacity: 0.25,
	customCSS: `.anki-dark-cloze.reading-view {
 background-color: var(--cloze-color);
 border-radius: 4px;
 padding: 0 4px;
}
.anki-dark-cloze.live-preview {
}
.anki-dark-line.odds {
 background-color: var(--line1-color);
}
.anki-dark-line.evens {
 background-color: var(--line2-color);
}`
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	public highlighterRibbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
		this.updateStyles();

		// Editor extension to highlight flashcard lines
		this.registerEditorExtension(livePreviewPostProcessor(this.settings));
		// Reading view post processor to hide flashcard IDs and highlight clozes
		this.registerMarkdownPostProcessor((el) => markdownPostProcessor(el, this.settings));
		
		// Add ribbon icon for reading current file
		this.addRibbonIcon('file-text', 'Ankify', async () => {
			const info = await ankify(this.app, this.settings.defaultDeck);
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

		this.addCommand({
			id: 'highlight-flashcards',
			name: 'Toggle Flashcard Highlighter',
			callback: () => this.highlightCommand()
		});

		// Add ribbon icon if enabled in settings
		if (this.settings.showHighlighterRibbon) {
			this.highlighterRibbonIconEl = this.addRibbonIcon(
				'highlighter',
				`Anki Highlighter: ${this.settings.enableHighlighter ? 'On' : 'Off'}`,
				async () => this.highlightCommand()
			);
		}

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

	updateStyles() {
		// Remove existing style element if it exists
		const existingStyle = document.getElementById('obsidian-anki-dark-styles');
		if (existingStyle) {
			existingStyle.remove();
		}

		// Create and add new style element
		const styleEl = document.createElement('style');
		styleEl.id = 'obsidian-anki-dark-styles';
		
		// Set CSS variables for dynamic colors
		const clozeColor = this.settings.clozeHighlightColor + Math.round(this.settings.clozeHighlightOpacity * 255).toString(16).padStart(2, '0');
		const line1Color = this.settings.firstHighlightColor + Math.round(this.settings.firstHighlightOpacity * 255).toString(16).padStart(2, '0');
		const line2Color = this.settings.secondHighlightColor + Math.round(this.settings.secondHighlightOpacity * 255).toString(16).padStart(2, '0');
		styleEl.textContent = `
			/* Plugin UI styles */
			.obsidian-anki-dark-css-editor {
				min-height: 200px;
				width: 200%;
				font-family: var(--font-monospace);
			}

			/* Dynamic styles */
			:root {
				--cloze-color: ${clozeColor};
				--line1-color: ${line1Color};
				--line2-color: ${line2Color};
			}

			/* User custom styles */
			${this.settings.customCSS}
		`;
		document.head.appendChild(styleEl);
	}

	refreshAllViews(): void {
		this.app.workspace.iterateAllLeaves(leaf => {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.previewMode?.rerender(true);
				leaf.view.editor?.refresh();
			}
		});
	}

	async highlightCommand(): Promise<void> {
		this.settings.enableHighlighter = !this.settings.enableHighlighter;
		await this.saveSettings();
		if (this.highlighterRibbonIconEl) {
			this.highlighterRibbonIconEl.ariaLabel = `Anki Highlighter: ${this.settings.enableHighlighter ? 'On' : 'Off'}`;
		}
		new Notice(`Flashcard highlighting ${this.settings.enableHighlighter ? 'Enabled' : 'Disabled'}`);

		this.refreshAllViews();
		this.app.workspace.updateOptions();
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
			.setName('Default Deck')
			.setDesc('The default deck name for new flashcards (can be overridden in YAML frontmatter)')
			.addText(text => text
				.setValue(this.plugin.settings.defaultDeck)
				.onChange(async (value) => {
					this.plugin.settings.defaultDeck = value || DEFAULT_SETTINGS.defaultDeck;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Highlight Flashcards')
			.setDesc('Highlight flashcard lines and clozes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableHighlighter)
				.onChange(async (value) => {
					this.plugin.settings.enableHighlighter = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Show Highlight Button')
			.setDesc('Show the highlighter button in the left sidebar')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showHighlighterRibbon)
				.onChange(async (value) => {
					this.plugin.settings.showHighlighterRibbon = value;
					await this.plugin.saveSettings();
					
					// Update ribbon icon visibility
					if (value && !this.plugin.highlighterRibbonIconEl) {
						this.plugin.highlighterRibbonIconEl = this.plugin.addRibbonIcon(
							'highlighter', 
							`Anki Highlighter: ${this.plugin.settings.enableHighlighter ? 'On' : 'Off'}`, 
							() => { this.plugin.highlightCommand(); }
						);
					} else if (!value && this.plugin.highlighterRibbonIconEl) {
						this.plugin.highlighterRibbonIconEl.remove();
						this.plugin.highlighterRibbonIconEl = null;
					}
				}));

		new Setting(containerEl)
			.setName('Highlight Colors')
			.setDesc('Customize the colors used for highlighting')
			.addButton(button => button
				.setButtonText('Reset to Defaults')
				.onClick(async () => {
					// Reset colors and opacities to defaults
					this.plugin.settings.firstHighlightColor = DEFAULT_SETTINGS.firstHighlightColor;
					this.plugin.settings.secondHighlightColor = DEFAULT_SETTINGS.secondHighlightColor;
					this.plugin.settings.firstHighlightOpacity = DEFAULT_SETTINGS.firstHighlightOpacity;
					this.plugin.settings.secondHighlightOpacity = DEFAULT_SETTINGS.secondHighlightOpacity;
					this.plugin.settings.clozeHighlightColor = DEFAULT_SETTINGS.clozeHighlightColor;
					this.plugin.settings.clozeHighlightOpacity = DEFAULT_SETTINGS.clozeHighlightOpacity;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
					
					// Force refresh the settings UI
					this.display();
					
					new Notice('Colors reset to defaults');
				}));

		new Setting(containerEl)
			.setName('First Highlight Color')
			.setDesc('Color and opacity for odd-numbered flashcards')
			.addColorPicker(colorpicker => colorpicker
				.setValue(this.plugin.settings.firstHighlightColor)
				.onChange(async (value) => {
					this.plugin.settings.firstHighlightColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.firstHighlightOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.firstHighlightOpacity = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}));

		new Setting(containerEl)
			.setName('Second Highlight Color')
			.setDesc('Color and opacity for even-numbered flashcards')
			.addColorPicker(colorpicker => colorpicker
				.setValue(this.plugin.settings.secondHighlightColor)
				.onChange(async (value) => {
					this.plugin.settings.secondHighlightColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.secondHighlightOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.secondHighlightOpacity = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}));

		new Setting(containerEl)
			.setName('Cloze Highlight Color')
			.setDesc('Color and opacity for cloze deletions in reading view')
			.addColorPicker(colorpicker => colorpicker
				.setValue(this.plugin.settings.clozeHighlightColor)
				.onChange(async (value) => {
					this.plugin.settings.clozeHighlightColor = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.clozeHighlightOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.clozeHighlightOpacity = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				}));

		new Setting(containerEl)
			.setName('Custom CSS')
			.setDesc('Customize the appearance of plugin elements')
			.addTextArea(text => text
				.setValue(this.plugin.settings.customCSS)
				.setPlaceholder('Enter custom CSS here')
				.onChange(async (value) => {
					this.plugin.settings.customCSS = value;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
				})
				.inputEl.addClass('obsidian-anki-dark-css-editor'))
			.addExtraButton(button => button
				.setIcon('reset')
				.setTooltip('Reset to default CSS')
				.onClick(async () => {
					this.plugin.settings.customCSS = DEFAULT_SETTINGS.customCSS;
					await this.plugin.saveSettings();
					this.plugin.updateStyles();
					this.display();
				}));

		// new Setting(containerEl)
		// 	.setName('Setting #1')
		// 	.setDesc('It\'s a secret')
		// 	.addText(text => text
		// 		.setPlaceholder('Enter your secret')
		// 		.setValue(this.plugin.settings.mySetting)
		// 		.onChange(async (value) => {
		// 			this.plugin.settings.mySetting = value;
		// 			await this.plugin.saveSettings();
		// 		}));
	}
}
