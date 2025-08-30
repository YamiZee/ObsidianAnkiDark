import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { ankify, getFlashcardLines } from './src/parser';
import { Flashcard } from './src/models';
import { highlightFlashcardLines } from './src/highlighter';

interface MyPluginSettings {
	mySetting: string;
	cardsAdded: number;
	enableEditorObserver: boolean;
	showHighlighterRibbon: boolean;
	defaultDeck: string;
	firstHighlightColor: string;
	secondHighlightColor: string;
	firstHighlightOpacity: number;
	secondHighlightOpacity: number;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	cardsAdded: 0,
	enableEditorObserver: false,
	showHighlighterRibbon: true,
	defaultDeck: 'Obsidian',
	firstHighlightColor: '#e0c2ff',
	secondHighlightColor: '#a77ea9',
	firstHighlightOpacity: 0.1,
	secondHighlightOpacity: 0.1
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	private currentFlashcardLines: Array<{ flashcard: Flashcard, startLine: number, endLine: number }> = [];
	private editorObserver: MutationObserver | null = null;
	public highlighterRibbonIconEl: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();
			
		this.setupEditorObserver();

		// Register markdown post processor to hide flashcard IDs in reading view
		this.registerMarkdownPostProcessor((element) => {

			// Find and remove all text nodes that match ^number pattern
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

			const nodesToFilter: Text[] = [];
			let node: Text | null;
			while (node = walker.nextNode() as Text) {
				if (!node.textContent) continue;
				// Filter out footnote lines
				if (node.textContent?.match(/\^[0-9]+/)) {
					nodesToFilter.push(node);
                }
			}
			nodesToFilter.forEach(n => {
				let parentEl = n.parentElement;
				if (parentEl) {
					const html = parentEl.innerHTML;
					parentEl.innerHTML = html.replace(/(<br>)?\s*\^[0-9]+/g, '');
				}
			});
		});

		this.addCommand({
			id: 'highlight-flashcards',
			name: 'Highlight Flashcard Lines',
			callback: () => this.highlightCommand()
		});
		
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

		// Add ribbon icon if enabled in settings
		if (this.settings.showHighlighterRibbon) {
			this.highlighterRibbonIconEl = this.addRibbonIcon('highlighter', 'Highlight Lines', () => {
				this.highlightCommand();
			});
		}

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText(`${this.settings.cardsAdded} cards.`);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		// Clean up the observer when the plugin is unloaded
		if (this.editorObserver) {
			this.editorObserver.disconnect();
			this.editorObserver = null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	highlightCommand(): void {
		// Store fully processed flashcard lines
		let fullContent = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.getValue() || '';
		this.currentFlashcardLines = getFlashcardLines(fullContent);
		//this.highlightFlashcardLines(this.currentFlashcardLines);
		
		// Highlight partial content
		let renderedContent = this.getRenderedContent()?.content || '';
		let flashcardLines = getFlashcardLines(renderedContent);
		highlightFlashcardLines(this.app, flashcardLines, this.settings);

		if (this.currentFlashcardLines.length > 0) {
			new Notice('Flashcard lines highlighted!');
		} else {
			new Notice('No flashcard lines found!');
		}
	}

	setupEditorObserver(): void {
		// Clean up any existing observer
		if (this.editorObserver) {
			this.editorObserver.disconnect();
			this.editorObserver = null;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return;
		const editorEl = activeView.contentEl.querySelector('.cm-editor');
		if (!editorEl) return;

		// Create new observer
		this.editorObserver = new MutationObserver((mutations) => {
			if (this.settings.enableEditorObserver) {
				let rendered = this.getRenderedContent();
				highlightFlashcardLines(this.app, getFlashcardLines(rendered?.content || ''), this.settings);
				//this.highlightFlashcardLines(this.currentFlashcardLines);
			}
		});

		// Start observing
		this.editorObserver.observe(editorEl, {
			childList: true,
			subtree: true,
			characterData: true
		});
	}

	private getRenderedContent(): { content: string } | null {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return null;

		const editorEl = activeView.contentEl.querySelector('.cm-editor');
		if (!editorEl) return null;

		const renderedLines = Array.from(editorEl.querySelectorAll('.cm-line'));
		const visibleContent = renderedLines.map(line => line.textContent || '').join('\n');

		return {
			content: visibleContent,
			// startLineNumber: 0
		};
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
			.setName('Auto-highlight Flashcards')
			.setDesc('Automatically highlight flashcard lines when scrolling or editing')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableEditorObserver)
				.onChange(async (value) => {
					this.plugin.settings.enableEditorObserver = value;
					await this.plugin.saveSettings();
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
						this.plugin.highlighterRibbonIconEl = this.plugin.addRibbonIcon('highlighter', 'Highlight Lines', () => {
							this.plugin.highlightCommand();
						});
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
					await this.plugin.saveSettings();
					
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
				}))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.firstHighlightOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.firstHighlightOpacity = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Second Highlight Color')
			.setDesc('Color and opacity for even-numbered flashcards')
			.addColorPicker(colorpicker => colorpicker
				.setValue(this.plugin.settings.secondHighlightColor)
				.onChange(async (value) => {
					this.plugin.settings.secondHighlightColor = value;
					await this.plugin.saveSettings();
				}))
			.addSlider(slider => slider
				.setLimits(0, 1, 0.05)
				.setValue(this.plugin.settings.secondHighlightOpacity)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.secondHighlightOpacity = value;
					await this.plugin.saveSettings();
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
