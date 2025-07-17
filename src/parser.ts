import { App, MarkdownView } from 'obsidian';
import * as yaml from 'js-yaml';
import { Flashcard, addNotesToAnki, updateNotesInAnki, ankiConnectRequest, checkAnkiConnect, ensureDefaultModelsExist, ensureDeckExists, processImagesForAnki } from './ankiconnect';

export async function ankify(app: App): Promise<{ cardsAdded?: number, cardsUpdated?: number }> {
    // Ensure AnkiConnect is available
    if (!(await checkAnkiConnect())) {
        return {};
    }
    // Ensure default models exist
    await ensureDefaultModelsExist();

    // Get the active markdown view's content
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
        console.log('No active markdown file found');
        return {};
    }
    const content = activeView.editor.getValue();

    const { deck, tags: globalTags } = extractYamlProperties(content);
    globalTags.push('obsidian');
    const deckName = deck || 'Default';
    
    await ensureDeckExists(deckName);
    
    const flashcardBlocks = getFlashcards(content, deckName, globalTags);
    
    // Set source link for all flashcards
    const fileName = activeView.file?.basename || 'unknown';
    const vaultName = activeView.app.vault.getName();
    const sourceLink = `<a href="obsidian://open?vault=${encodeURIComponent(vaultName)}&amp;file=${encodeURIComponent(fileName)}.md">${fileName}</a>`;
    flashcardBlocks.forEach(block => {
        block.flashcard.fields.Source = sourceLink;
    });

    // Process images in each field
    const vaultPath = (activeView.app.vault.adapter as any).basePath;
    for (const block of flashcardBlocks) {
        for (const [fieldName, fieldContent] of Object.entries(block.flashcard.fields)) {
            if (fieldContent) {
                block.flashcard.fields[fieldName] = await processImagesForAnki(fieldContent, vaultPath, activeView.app);
            }
        }
    }

    const { cardsAdded, cardsUpdated } = await syncFlashcardsWithAnki(flashcardBlocks, activeView);

    // console.log('cardsAdded:', cardsAdded);
    // console.log('cardsUpdated:', cardsUpdated);
    return { cardsAdded, cardsUpdated };
}

function getFlashcards(content: string, deck: string | undefined, globalTags: string[]): Array<{ flashcard: Flashcard, startLine: number, endLine: number }> {
    const lines = content.split(/\r?\n/);
    let currentCard: string[] = [];
    let inCodeBlock = false;
    let startLine = 0;
    const flashcardBlocks: Array<{ flashcard: Flashcard, startLine: number, endLine: number }> = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (currentCard.length === 0) startLine = i;
        currentCard.push(line);

        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }
        if (line.trim().endsWith('::') || inCodeBlock ||
            (i + 1 < lines.length && (lines[i+1].trim().startsWith('::') || lines[i+1].trim().startsWith('^')))) {
            continue;
        }
    
        // Generate card
        let card = currentCard.join('\n').trim();
        card = convertToAnkiCloze(card);
        card = handleBrackets(card);
        let isCloze = isClozeCard(card);
        let id: number | undefined = undefined;
        let tags: string[] = [];

        if (!isCloze && !card.includes('::')) {
            // Not a card
            currentCard = [];
            continue;
        }

        // Extract ID, and remove from card
        const idMatch = card.match(/(?:\s|\n)\^(\d+)(?:\s|$)/);
        if (idMatch) {
            id = Number(idMatch[1]);
            card = card.replace(/(?:\s|\n)\^(\d+)(?:\s|$)/, '');
        }

        // Extract tags, and remove from card
        const tagMatches = card.match(/#[\w-]+/g);
        if (tagMatches) {
            tags = tagMatches;
            card = card.replace(/#[\w-]+/g, '').trim();
        }
        tags = [...tags, ...globalTags];

        // Split card into fields
        const fieldsArr = splitIntoFields(card);
        let fields: Record<string, string> = {};
        if (isCloze) {
            fields = { Text: fieldsArr[0] || '', 'Back Extra': fieldsArr[1] || '' };
        } else {
            fields = { Front: fieldsArr[0] || '', Back: fieldsArr[1] || '' };
        }

        const flashcard = new Flashcard({
            id,
            deckName: deck || 'Default',
            isCloze,
            fields,
            tags
        });
        // console.log(flashcard);
        flashcardBlocks.push({ flashcard, startLine, endLine: i });
        currentCard = [];
    }
    return flashcardBlocks;
}

async function syncFlashcardsWithAnki(flashcardBlocks: Array<{ flashcard: Flashcard, startLine: number, endLine: number }>, activeView: MarkdownView) {
    let cardsAdded = 0;
    let cardsUpdated = 0;
    
    // Separate cards into new and existing
    const newCards: Array<{ flashcard: Flashcard, startLine: number, endLine: number }> = [];
    const existingCards: Array<{ flashcard: Flashcard, startLine: number, endLine: number }> = [];
    
    // Check which cards exist in Anki
    for (const { flashcard, startLine, endLine } of flashcardBlocks) {
        let noteExists = false;
        if (flashcard.id !== undefined) {
            const findRes = await ankiConnectRequest('notesInfo', { notes: [flashcard.id] });
            if (
                findRes && findRes.result && 
                Array.isArray(findRes.result) &&
                findRes.result.length > 0 &&
                findRes.result[0] &&
                findRes.result[0].noteId !== undefined
            ) {
                noteExists = true;
            }
        }
        if (noteExists) {
            existingCards.push({ flashcard, startLine, endLine });
        } else {
            newCards.push({ flashcard, startLine, endLine });
        }
    }

    let linesInserted = 0;
    
    // Batch add new cards
    if (newCards.length > 0) {
        const newFlashcards = newCards.map(block => block.flashcard);
        // Add new cards to Anki
        const newIds = await addNotesToAnki(newFlashcards);
        
        // Update flashcards with new IDs and insert footnotes
        for (let i = 0; i < newCards.length; i++) {
            const { flashcard, endLine } = newCards[i];
            const oldId = flashcard.id;
            const newId = newIds[i];
            
            if (typeof newId !== 'number') {
                continue;
            }
            flashcard.id = newId;
            
            const noPreviousFootnote = oldId === undefined;
            if (noPreviousFootnote) {
                // Insert footnote if there was no previous footnote
                const targetLine = endLine + 1 + linesInserted;
                const footnote = `^${newId}\n`;
                if (targetLine >= activeView.editor.lineCount()) {
                    activeView.editor.replaceRange('\n'+footnote, { line: targetLine, ch: 0 });
                }else{
                    activeView.editor.replaceRange(footnote, { line: targetLine, ch: 0 });
                }
                console.log('Inserted footnote at line:', targetLine);
                linesInserted++;
            } else {
                // Replace the old (bad) footnote with the new one
                const targetLine = endLine + linesInserted;
                const line = activeView.editor.getLine(targetLine);
                const newLine = line.replace('^' + oldId.toString(), '^' + newId.toString());
                activeView.editor.replaceRange(
                    newLine,
                    { line: targetLine, ch: 0 },
                    { line: targetLine, ch: line.length }
                );
                console.log(`Bad id! Replaced ${oldId} with ${newId} at line ${targetLine}`);
            }
            cardsAdded++;
        }
    }
    
    // Batch update existing cards
    if (existingCards.length > 0) {
        const existingFlashcards = existingCards.map(block => block.flashcard);
        const updateResults = await updateNotesInAnki(existingFlashcards);
        cardsUpdated = existingCards.length
        // cardsUpdated = updateResults.filter(success => success).length;
    }

    console.log('newCards:', newCards);
    console.log('existingCards:', existingCards);
    
    return { cardsAdded, cardsUpdated };
}

function splitIntoFields(cardContent: string): string[] {
    const parts: string[] = [];
    let currentPart = '';
    let inCurlyBraces = 0;

    for (let i = 0; i < cardContent.length; i++) {
        if (cardContent[i] === ':' && cardContent[i + 1] === ':' && inCurlyBraces === 0) {
            // Found :: outside curly braces
            parts.push(currentPart);
            currentPart = '';
            i++;
            continue;
        }
        if (cardContent[i] === '{') {
            inCurlyBraces++;
        } else if (cardContent[i] === '}') {
            inCurlyBraces--;
        }
        currentPart += cardContent[i];
    }
    if (currentPart) {
        parts.push(currentPart);
    }
    
    return parts.map(part => part.trim());
}

function processImages(content: string, activeView: MarkdownView): string {
    // Handle Obsidian image references
    // Match ![[path]]
    return content.replace(/!\[\[([^\[\]\n]+)\]\]/g, (match, imagePath) => {
        let processedPath = imagePath;
        
        // Handle attachment references
        if (imagePath.startsWith('attachment:')) {
            const attachmentName = imagePath.substring('attachment:'.length);
            // For attachments, we'll use the filename directly
            processedPath = attachmentName;
        } else if (imagePath.startsWith('http')) {
            // External URLs - keep as is
            processedPath = imagePath;
        } else {
            // Local file paths - convert to attachment format
            // Extract just the filename from the path
            const fileName = imagePath.split('/').pop() || imagePath.split('\\').pop() || imagePath;
            processedPath = fileName;
        }
        
        // Return Anki image tag
        return `<img src="${processedPath}">`;
    });
}

// function processImages(content: string, activeView: MarkdownView): string {
//     // Handle Obsidian image references
//     // Match ![alt](path) or ![alt](attachment:filename)
//     return content.replace(/!\([^\]]*\)\]\((^)]+)\)/g, (match, altText, imagePath) => {
//         let processedPath = imagePath;
        
//         // Handle attachment references
//         if (imagePath.startsWith('attachment:')) {
//             const attachmentName = imagePath.substring('attachment:'.length);
//             // For attachments, we'll use the filename directly
//             processedPath = attachmentName;
//         } else if (imagePath.startsWith('http')) {
//             // External URLs - keep as is
//             processedPath = imagePath;
//         } else {
//             // Local file paths - convert to attachment format
//             // Extract just the filename from the path
//             const fileName = imagePath.split('/').pop() || imagePath.split('\\').pop() || imagePath;
//             processedPath = fileName;
//         }
        
//         // Return Anki image tag
//         return `<img src=${processedPath}" alt="${altText}">`;
//     });
// }

function convertToAnkiCloze(content: string): string {
    let result = content;

    // Match {cloze::hint} / {{{cloze::hint}}} and set the cloze number to the number of braces
    result = result.replace(/(\{+)(?!c\d+::)([^\{\}\n\r:]+)(?:::([^\{\}\n\r:]+))?(\}+)/g, (match, openBraces, cloze, hint, closeBraces) => {
        const openCount = openBraces.length;
        const closeCount = closeBraces.length;
        const clozeNum = Math.min(openCount, closeCount);
        return hint ? `{{c${clozeNum}::${cloze}::${hint}}}` : `{{c${clozeNum}::${cloze}}}`;
    });

    // Match {1:cloze:hint} to {{c1::cloze::hint}}, or {1:cloze} to {{c1::cloze}}
    result = result.replace(/(?<!{){(\d+):([^{}\n\r:]+)(?::([^\{\}\n\r:]+))?}/g, (match, num, cloze, hint) => {
        return hint ? `{{c${num}::${cloze}::${hint}}}` : `{{c${num}::${cloze}}}`;
    });

    // ==cloze== to {{c1::cloze}}
    result = result.replace(/==([^=]+)==/g, '{{c1::$1}}');

    return result;
}
function handleBrackets(content: string): string {
    let result = content;
    let bracketContent = '';
    result = result.replace(/(?<!!)\[\[([^\[\]\n]+)\]\]/g, (match, link) => {
        bracketContent = link;
        return link;
    });
    return result;
}

function isClozeCard(content: string): boolean {
    // Check for Anki cloze pattern {{c1::text}} or {{c2::text::hint}}
    const clozeRegex = /\{\{c\d+::[^}]+\}\}/;
    return clozeRegex.test(content);
}

function extractYamlProperties(content: string): { deck?: string, tags: string[] } {
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!yamlMatch) return { tags: [] };
    const yamlContent = yamlMatch[1];
    let parsed: any = {};
    try {
        parsed = yaml.load(yamlContent);
    } catch (e) {
        console.error('YAML parse error:', e);
    }
    let tags: string[] = [];
    if (parsed.tags) {
        if (Array.isArray(parsed.tags)) {
            tags = parsed.tags.map(String);
        } else if (typeof parsed.tags === 'string') {
            tags = parsed.tags.split(/\s+/).map((t: string) => t.trim()).filter(Boolean);
        }
    }
    return { deck: parsed.deck, tags };
}

// Unnecessary functions

function parseClozePatterns(content: string) {
    // Regex to match {c1::world::noun}, {world}, {c2::world}, {world::noun}
    const regex = /\{(?:c(\d+)::)?((?:(?!::)[^}])+)(?:::(.*?))?}/g;
    let match;
    const results = [];
    while ((match = regex.exec(content)) !== null) {
        const clozeNumber = match[1] || 1; // 1 if not present
        const clozeText = match[2];
        const optionalInfo = match[3];
        results.push({ clozeNumber, clozeText, optionalInfo });
    }
    return results;
}

    // Check for code block markers
    // if (content[i] === '`') {
    //     inCodeBlock = !inCodeBlock;
    //     continue;
    // }

    
    // result = result.replace(/(?<!\{)\{([^\n\r:{}]+)(?:::([^\n\r{}]+))?\}(?!\})/g, (match, cloze, hint) => {
