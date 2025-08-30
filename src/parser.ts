import { App, MarkdownView } from 'obsidian';
import * as yaml from 'js-yaml';
import { addNotesToAnki, updateNotesInAnki, ankiConnectRequest, checkAnkiConnect, ensureDefaultModelsExist, ensureDeckExists, processImagesForAnki } from './ankiconnect';
import { Flashcard, FlashcardType } from './models';

export function getFlashcardLines(content: string): Array<{ flashcard: Flashcard, startLine: number, endLine: number }> {
    const flashcardBodies = getFlashcardBodies(content);
    return makeFlashcards(flashcardBodies, "", []);
}

export async function ankify(app: App, defaultDeck: string): Promise<{ cardsAdded?: number, cardsUpdated?: number, cardsDeleted?: number }> {
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
    const deckName = deck || defaultDeck;
    
    await ensureDeckExists(deckName);

    const flashcardBodies = getFlashcardBodies(content);
    const flashcardBlocks = makeFlashcards(flashcardBodies, deckName, globalTags);

    // Extract tags from headers and apply to flashcards
    for (const block of flashcardBlocks) {
        const headers = getHeadersForLine(content, block.startLine);
        for (const h of headers) {
            console.log(h.content.match(/(?:^|\s)(#[\w-]+)/g))
        }
        const headerTags = headers.flatMap(h => (h.content.match(/#(?<=(?:^|\s)#)([\w-]+)/g) || []));
        const headerLinks = headers.flatMap(h => (h.content.match(/(?<=\[\[)(?<!!\[\[)([^\[\]\r\n]+)(?=\]\])/g) || []));
        // Add header tags to the flashcard's tags, avoiding duplicates
        block.flashcard.tags = Array.from(new Set([...(block.flashcard.tags || []), ...headerTags, ...headerLinks]));
    }

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

    const cardsDeleted = await deleteMarkedFlashcards(activeView);

    return { cardsAdded, cardsUpdated, cardsDeleted };
}

export function getFlashcardBodies(content: string): {body: string, startLine: number, endLine: number}[] {
    const lines = content.split(/\r?\n/);
    let currentCard: string[] = [];
    let startLine = 0;
    let inCodeBlock = false;
    let inLatexBlock = false;
    const flashcardBodies = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (currentCard.length === 0) startLine = i;
        currentCard.push(line);

        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        } else if (line.trim().startsWith('$$')) {
            inLatexBlock = !inLatexBlock;
        }
        if (line.trim().endsWith(':') || inCodeBlock || inLatexBlock ||
            (i + 1 < lines.length && (
                lines[i+1].trim().startsWith('::') || 
                lines[i+1].trim().startsWith('^') ||
                lines[i+1].trim().startsWith('- ') ||
                /^\d+\.\s/.test(lines[i+1].trim())
            ))
        ){
            continue;
        }

        // Check card validity
        let cardBody = currentCard.join('\n');
        if (!cardBody.includes('{') && !cardBody.includes('}') && !cardBody.includes('==') && !cardBody.includes('::')) {
            // Not a card
            currentCard = [];
            continue;
        }
        flashcardBodies.push({body: currentCard.join('\n'), startLine, endLine: i});
        currentCard = [];
    }
    return flashcardBodies;
}

function makeFlashcards(flashcardBodies: {body: string, startLine: number, endLine: number}[], deck: string | undefined, globalTags: string[]): Array<{ flashcard: Flashcard, startLine: number, endLine: number }> {
    const flashcardBlocks = [];
    for (let {body: card, startLine, endLine} of flashcardBodies) {

        let id: number | undefined = undefined;
        let tags: string[] = [];

        // Extract ID, and remove from card
        const idMatch = card.match(/(?:\s|\n)\^(\d+)(?:\s|$)/);
        if (idMatch) {
            id = Number(idMatch[1]);
            card = card.replace(/(?:\s|\n)\^(\d+)(?:\s|$)/, '');
        }

        // Extract [[link]] tags, and remove from card
        let linkTags: string[] = [];
        card = card.replace(/\[\[(?<!!\[\[)([^\[\]\r\n]+)\]\]/g, (match, link) => {
            linkTags.push(link);
            return link;
        });

        // Extract tags, and remove from card
        const tagMatches = card.match(/#[\w-]+/g);
        if (tagMatches) {
            tags = tagMatches;
            card = card.replace(/#[\w-]+/g, '').trim();
        }
        tags = [...tags, ...linkTags, ...globalTags];

        // Split card into fields
        let {fields, reverseCard} = splitIntoFields(card);

        // Format fields from markdown to html (such as bold, italic, strikethrough, codeblocks,  etc.)
        for (let i = 0; i < fields.length; i++) {
            fields[i] = formatFlashcardField(fields[i]);
        }

        const isCloze = isClozeCard(fields[0]);
        
        if (!isCloze && !card.includes('::')) {
            // Not a card
            continue;
        }
        
        // TODO: make fields not hardcoded
        let namedFields: Record<string, string> = {};
        if (isCloze) {
            namedFields = { Text: fields[0] || '', 'Back Extra': fields[1] || '' };
        } else {
            namedFields = { Front: fields[0] || '', Back: fields[1] || '' };
        }

        const flashcard = new Flashcard({
            id,
            deckName: deck || 'Default',
            type: isCloze ? FlashcardType.Cloze : reverseCard ? FlashcardType.Reversed : FlashcardType.Basic,
            fields: namedFields,
            tags,
        });
        flashcardBlocks.push({ flashcard, startLine, endLine });
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
            if (findRes?.result?.[0]?.noteId !== undefined) {
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

    console.log(`Added ${newCards.length} cards:`, newCards.map(block => block.flashcard));
    console.log(`Updated ${existingCards.length} cards:`, existingCards.map(block => block.flashcard));
    
    return { cardsAdded, cardsUpdated };
}

async function deleteMarkedFlashcards(activeView: MarkdownView): Promise<number> {
    const editor = activeView.editor;
    const content = editor.getValue();
    // Regex to match 'delete' on its own line followed by a footnote
    const deleteRegex = /^(?<!::\n)(?<!::\r\n)[ \t]*?delete\s*?\^(\d+)\s*?$/gmi;
    const deletePortions: { start: number, end: number }[] = [];
    const noteIds: number[] = [];
    // Find all matches and their positions
    let match;
    while (match = deleteRegex.exec(content)) {
        deletePortions.push({
            start: match.index,
            end: deleteRegex.lastIndex,
        });
        noteIds.push(Number(match[1]));
    }
    if (noteIds.length === 0) {
        return 0;
    }
    // Delete notes in Anki and remove from editor, process from end to start to avoid shifting
    for (let i = noteIds.length - 1; i >= 0; i--) {
        const { start, end } = deletePortions[i];
        // Convert start and end indices to line/char positions
        const startPos = editor.offsetToPos(start);
        const endPos = editor.offsetToPos(end);
        editor.replaceRange('', startPos, endPos);
    }
    const result = await ankiConnectRequest('deleteNotes', { notes: noteIds });
    console.log('Deleted notes:', noteIds);
    return noteIds.length;
}

// TODO: use blocks instead of tracking curly braces manually
function splitIntoFields(cardContent: string): {fields: string[], reverseCard: boolean} {
    const fields: string[] = [];
    let currentPart = '';
    let inCurlyBraces = 0;
    let reverseCard = false;

    for (let i = 0; i < cardContent.length; i++) {
        if (cardContent[i] === ':' && cardContent[i + 1] === ':' && inCurlyBraces === 0) {
            // Found :: outside curly braces
            fields.push(currentPart);
            currentPart = '';
            // find how long the sequence of : is via regex
            const colonCount = cardContent.slice(i).match(/^(:+)/g)?.[0]?.length || 0;
            reverseCard = colonCount == 3;
            i += colonCount - 1;
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
        fields.push(currentPart);
    }
    
    return {fields: fields.map(field => field.trim()), reverseCard};
}

function convertToAnkiCloze(content: string, insideCode: boolean, insideLatex: boolean): string {
    let result = content;
    // Match {cloze::hint} / {{{cloze::hint}}} and set the cloze number to the number of braces
    result = result.replace(/(\{+)(?!c\d+::)([^\{\}\n\r:]+)(?:::([^\{\}\n\r:]+))?(\}+)/g, (match, openBraces, cloze, hint, closeBraces) => {
        const openCount = openBraces.length;
        const closeCount = closeBraces.length;
        const clozeNum = Math.min(openCount, closeCount);
        if (insideLatex && clozeNum == 1) {
            return match;
        }
        return hint ? `{{c${clozeNum}::${cloze}::${hint}}}` : `{{c${clozeNum}::${cloze}}}`;
    });
    // Match {1:cloze:hint} to {{c1::cloze::hint}}, or {1:cloze} to {{c1::cloze}}
    result = result.replace(/(?<!{){(\d+):([^{}\n\r:]+)(?::([^\{\}\n\r:]+))?}/g, (match, num, cloze, hint) => {
        return hint ? `{{c${num}::${cloze}::${hint}}}` : `{{c${num}::${cloze}}}`;
    });
    // ==cloze== to {{c1::cloze}}
    result = result.replace(/==(\S[^=]+)==/g, (match, cloze) => {
        if (insideLatex || insideCode) {
            return match;
        }
        return `{{c1::${cloze}}}`;
    });
    return result;
}

// TODO: handle edge cases and possibly tag flashcards by link name
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

// TODO: execute inline on non blocks
function getCodeBlocks(content: string): {start: number, end: number}[] {
    // const blockRegex = /```(\w*)\s*?\n(?:([\s\S]*?)\r?\n)??\s*?```/g; // overly complex
    // const blockRegex = /```(\w*)[\s\S]*?```/g; // doesn't support escaped `
    const blockRegex = /```(?<!\\```)(\w*)[\s\S]*?```(?<!\\```)/g; // optimal

    const inlineRegex = /`(?<![`\\]`)[^`\r\n]*`(?!`)/g; // checks against being ``
    // const inlineRegex = /`(?<!\\`)[^`\r\n]*`/g; // optimal if checked outside of blocks

    const codeBlocks = [];
    for (const match of content.matchAll(blockRegex)) {
        codeBlocks.push({start: match.index, end: match.index + match[0].length});
    }
    for (const match of content.matchAll(inlineRegex)) {
        codeBlocks.push({start: match.index, end: match.index + match[0].length});
    }
    return codeBlocks;
}

// TODO: execute inline on non blocks
function getLatexBlocks(content: string): {start: number, end: number}[] {
    // const complexRegex = /^\$\$\s*?\n(?:([\s\S]*?)\r?\n)??\s*?\$\$$/g; // overly complex
    const blockRegex = /(?<!\\)\$\$[\s\S]*?\$\$(?<!\\\$\$)/g; // short and sweet

    //const inlineRegex = /(?<!\$)\$[^\$\r\n]*\$(?!\$)/g; //replace, doesnt support escaped $ 
    const inlineRegex = /\$(?<![\$\\]\$)(?!\$).*?\$(?<![\$\\]\$)(?!\$)/g; // handle escaped $ and reject $$ (slow but accurate)
    // const inlineRegex = /(?<!\\)\$\S(?:.*?\S)?\$(?<!\\\$)/g; // handle escaped $, execute only on non $$ blocks (optimal after checks, use this)

    const latexBlocks = [];
    for (const match of content.matchAll(blockRegex)) {
        latexBlocks.push({start: match.index, end: match.index + match[0].length});
    }
    for (const match of content.matchAll(inlineRegex)) {
        latexBlocks.push({start: match.index, end: match.index + match[0].length});
    }
    return latexBlocks;
}

function formatFlashcardField(content: string): string {
    // Get all special blocks
    const codeBlocks = getCodeBlocks(content);
    const latexBlocks = getLatexBlocks(content);
    const blockSequence = getBlockSequence(content, [codeBlocks, latexBlocks]);

    let result = '';

    for (const block of blockSequence) {
        let formatted = block.content;
        if (block.blockType == 0) {
            formatted = applyMarkdownFormatting(block.content);
            formatted = convertToAnkiCloze(formatted, false, false);
        } else if (block.blockType == 1) {
            formatted = applyBlockFormatting(block.content);
            formatted = convertToAnkiCloze(formatted, true, false);
        } else if (block.blockType == 2) {
            formatted = applyBlockFormatting(block.content);
            formatted = convertToAnkiCloze(formatted, false, true);
        }
        result += formatted;
    }
    // Convert newlines to <br> tags at the end to avoid interfering with block detection
    return result.trim().replace(/\r?\n/g, '<br>');
}

function applyMarkdownFormatting(text: string): string {
    return text
        .replace(/(\*\*|__)(.*?)\1/g, (match, bold, content) => `<b>${content}</b>`)
        .replace(/(\*|_)(.*?)\1/g, (match, italic, content) => `<i>${content}</i>`)
        .replace(/(\~\~)(.*?)\1/g, (match, strikethrough, content) => `<s>${content}</s>`)
}
function applyBlockFormatting(text: string): string {
    return text
        .replace(/^```(\w*)([\s\S]*)```$/g, (match, language, content) => `<pre><code>${content.trim()}</code></pre>`)
        .replace(/^`([\s\S]*)`$/g, (match, content) => `<code>${content.trim()}</code>`)
        .replace(/^\$\$([\s\S]*)\$\$$/g, (match, content) => `\\\[${content.trim()}\\\]`)
        .replace(/^\$([\s\S]*)\$$/g, (match, content) => `\\\(${content.trim()}\\\)`)
}

// Combines blocks, ensures no overlap, sorts them, notes their block type, and returns them
function getBlockSequence(content: string, blocks: {start: number, end: number}[][]): {content: string, blockType: number}[] {

    let allBlocks: {indices: {start: number, end: number}, blockType: number}[] = [];
    
    // Map each block array to include its type number and content
    blocks.forEach((blockArray, index) => {
        blockArray.forEach(indices => {
            allBlocks.push({
                indices: indices,
                blockType: index + 1
            });
        });
    });
    
    // Sort all blocks by start position
    allBlocks = allBlocks.sort((a, b) => a.indices.start - b.indices.start);

    // Ensure no blocks overlap
    const filteredBlocks: {indices: {start: number, end: number}, blockType: number}[] = [];
    for (const block of allBlocks) {
        if (filteredBlocks.length === 0 || block.indices.start >= filteredBlocks[filteredBlocks.length - 1].indices.end) {
            filteredBlocks.push(block);
        }
        // If there is overlap, we silently skip this block
    }

    let blockSequence: {content: string, blockType: number}[] = [];

    // Process content in segments, preserving special blocks
    let lastEnd = 0;

    for (const block of filteredBlocks) {
        // Append text before the block
        if (block.indices.start > lastEnd) {
            const textSegment = content.slice(lastEnd, block.indices.start);
            blockSequence.push({content: textSegment, blockType: 0});
        }
        // Append the block
        const blockSegment = content.slice(block.indices.start, block.indices.end);
        blockSequence.push({content: blockSegment, blockType: block.blockType});
        lastEnd = block.indices.end;
    }
    // Append any remaining text after the last block
    if (lastEnd < content.length) {
        const textSegment = content.slice(lastEnd);
        blockSequence.push({content: textSegment, blockType: 0});
    }

    return blockSequence;
}

function getHeadersForLine(content: string, line: number): {content: string, level: number, line: number}[] {
    const headerList = getHeaderList(content);
    const headers = [];
    let lastLevel = 10;
    for (let i = headerList.length - 1; i >= 0; i--) {
        if (headerList[i].line > line || headerList[i].level >= lastLevel) {
            continue;
        }
        headers.push(headerList[i]);
        lastLevel = headerList[i].level;
    }
    return headers;
}

function getHeaderList(content: string): {content: string, level: number, line: number}[] {
    const lines = content.split(/\r?\n/);
    const headerList = [];
    for (let i = 0; i < lines.length; i++) {
        const headerMatch = lines[i].match(/^(#+)\s+(.*)$/);
        if (headerMatch) {
            headerList.push({content: headerMatch[2], level: headerMatch[1].length, line: i});
        }
    }
    return headerList;
}


// function getFlascardBodiesViaRegex(content: string): {body: string, startLine: number, endLine: number}[] {
//     const regex = /^(?<!::\n)(?<!::\r\n)[ \t]*?delete\s*?\^(\d+)\s*?$/gmi;
//     const matches = content.matchAll(regex);
//     const flashcardBodies = [];
//     for (const match of matches) {
//         flashcardBodies.push({body: match[1], startLine: match.index, endLine: match.index + match[1].length});
//     }
//     return flashcardBodies;
// }