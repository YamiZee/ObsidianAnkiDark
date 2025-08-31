import { App, MarkdownView, Notice } from 'obsidian';
import { Flashcard } from './models';

export function highlightFlashcardLines(app: App, flashcardLines: Array<{ flashcard: Flashcard, startLine: number, endLine: number }>, settings: any): void {
    let even = false;
    flashcardLines.forEach(flashcardLine => {
        let color = even ? settings.secondHighlightColor : settings.firstHighlightColor;
        let opacity = even ? settings.secondHighlightOpacity : settings.firstHighlightOpacity;
        highlightLines(app, flashcardLine.startLine, flashcardLine.endLine, color, opacity);
        even = !even;
    });
}

export function highlightLines(app: App, startLine: number, endLine: number, color: string, opacity: number): void {
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    const editorEl = activeView?.contentEl.querySelector('.cm-editor');
    if (!activeView || !editorEl) {
        new Notice('No active editor found!');
        return;
    }

    const lineEls = editorEl.querySelectorAll('.cm-line');
    for (let i = startLine; i <= endLine; i++) {
        const lineEl = lineEls[i];
        if (lineEl) {
            (lineEl as HTMLElement).classList.add('anki-dark-line');
            (lineEl as HTMLElement).style.backgroundColor = hexToRgba(color, opacity);
        }
    }
}

function hexToRgba(hex: string, alpha: number): string {
    hex = hex.replace('#', '');
    let r = 0, g = 0, b = 0;
    let m = hex.length === 3 ? 1 : 2; // #fff = 1, #ffffff = 2
    r = parseInt(hex.substring(0*m, 1*m), 16);
    g = parseInt(hex.substring(1*m, 2*m), 16);
    b = parseInt(hex.substring(2*m, 3*m), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}