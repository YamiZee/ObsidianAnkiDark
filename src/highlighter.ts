import { ViewPlugin, DecorationSet, Decoration, ViewUpdate, EditorView } from '@codemirror/view';
import { Range } from '@codemirror/state';
import { getFlashcardLines } from './parser';

export function markdownPostProcessor(element: HTMLElement, settings: any) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);

    const parentElements: Set<HTMLElement> = new Set();
    const footnotesToFilter: Text[] = [];
    const clozeRegex = /\{+(\S[^}:]*)(?:::[^}:]*)?\}(?<=\S\})\}*/g;
    
    let node: Text | null;
    while (node = walker.nextNode() as Text) {
        if (!node.textContent) continue;
        // Collect elements for cloze highlighting
        if (node.parentElement) {
            parentElements.add(node.parentElement);
        }
        // Filter out ^number footnote lines
        if (node.textContent?.match(/\^[0-9]+/)) {
            footnotesToFilter.push(node);
        }
    }
    footnotesToFilter.forEach(n => {
        let parentEl = n.parentElement;
        if (parentEl) {
            const html = parentEl.innerHTML;
            parentEl.innerHTML = html.replace(/(<br>)?\s*\^[0-9]+/g, '');
        }
    });
    parentElements.forEach(p => {
        if (settings.enableHighlighter) {
            p.innerHTML = p.innerHTML.replace(clozeRegex, `<span class="anki-dark-cloze reading-view">$1</span>`);
        }else{
            p.innerHTML = p.innerHTML.replace(clozeRegex, `$1`);
        }
    });
}

export function livePreviewPostProcessor(settings: any) {
    return ViewPlugin.fromClass(class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged || update.viewportChanged) {
                this.decorations = this.buildDecorations(update.view);
            }
        }

        buildDecorations(view: EditorView) {
            if (!settings.enableHighlighter) {
                return Decoration.none;
            }
            const decorations: Range<Decoration>[] = [];
            
            const clozeRegex = /\{+(\S[^}:]*)(?:::[^}:]*)?\}(?<=\S\})\}*/g;
            const docString = view.state.doc.toString();

            const flashcardLines = getFlashcardLines(docString);
            let even = false;
            flashcardLines.forEach(flashcardLine => {
                for (let i = flashcardLine.startLine; i <= flashcardLine.endLine; i++) {
                    const lineStart = view.state.doc.line(i + 1).from;
                    const lineText = view.state.doc.line(i + 1).text;

                    // Highlight flashcard lines
                    decorations.push(Decoration.line({
                        class: `anki-dark-line ${even ? 'evens' : 'odds'} live-preview`
                    }).range(lineStart));

                    // Highlight clozes
                    const clozes = lineText.matchAll(clozeRegex);
                    if (clozes) {
                        Array.from(clozes).forEach(cloze => {
                            const clozeStart = cloze.index + lineStart;
                            const clozeEnd = clozeStart + cloze[0].length;
                            decorations.push(Decoration.mark({
                                class: `anki-dark-cloze live-preview`
                            }).range(clozeStart, clozeEnd));
                        });
                    }
                }
                even = !even;
            });
            return Decoration.set(decorations, true);
        }
    }, {
        decorations: v => v.decorations
    });
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