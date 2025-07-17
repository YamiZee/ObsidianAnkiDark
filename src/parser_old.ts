import { App, MarkdownView } from 'obsidian';
import * as yaml from 'js-yaml';
import { Flashcard, addNoteToAnki, updateNoteInAnki, ankiConnectRequest } from './ankiconnect';

export async function ankify(app: App): Promise<{ cardsAdded?: number, cardsUpdated?: number }> {
    // Get the active markdown view's content
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) {
        console.log('No active markdown file found');
        return {};
    }
    const content = activeView.editor.getValue();

    let cardsAdded = 0;
    let cardsUpdated = 0;

    // Extract YAML frontmatter
    const { deck, tags: globalTags } = extractYamlProperties(content);

    // Iterate over content
    const lines = content.split(/\r?\n/);
    let currentCard: string[] = [];
    let inCodeBlock = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        currentCard.push(line);

        if (line.trim().startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        }
        if (line.trim().endsWith('::') || inCodeBlock ||
            (i + 1 < lines.length && (lines[i+1].trim().startsWith('::') || lines[i+1].trim().startsWith('^')))) {
            continue;
        }
    
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

        // Extract ID if present
        const idMatch = card.match(/(?:\s|\n)\^(\d+)(?:\s|$)/);
        if (idMatch) {
            id = Number(idMatch[1]);
            card = card.replace(/(?:\s|\n)\^(\d+)(?:\s|$)/, '');
        }

        // Extract tags
        const tagMatches = card.match(/#[\w-]+/g);
        if (tagMatches) {
            tags = tagMatches;
            // Remove tags from card
            card = card.replace(/#[\w-]+/g, '').trim();
        }
        // Append global tags to card tags
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
        console.log(flashcard);

        // Check if note id exists in Anki
        let noteExists = false;
        if (id) {
            const findRes = await ankiConnectRequest('notesInfo', { notes: [id] });
            console.log('findRes:', findRes);
            if (findRes && findRes.result) {
                console.log('findRes.result:', findRes.result);
            }
            if (
                findRes &&
                Array.isArray(findRes.result) &&
                findRes.result.length > 0 &&
                findRes.result[0].noteId !== undefined
            ) {
                noteExists = true;
            }
        }

        console.log('noteExists:', noteExists);
        console.log('id:', id);
        if (noteExists) {
            const updated = await updateNoteInAnki(flashcard);
            if (updated) cardsUpdated++;
        } else {
            console.log('Adding new card');
            // Add new card
            const newId = await addNoteToAnki(flashcard);
            console.log('newId:', newId);
            if (newId) {
                const footnote = `^${newId}\n`;
                i++;
                cardsAdded++;
                if (id === undefined) {
                    // Insert footnote into the markdown file
                    activeView.editor.replaceRange(footnote, { line: i + 1, ch: 0 });
                } else {
                    // Replace the old (bad) footnote with the new one
                    const newLine = line.replace(id.toString(), newId.toString());
                    activeView.editor.replaceRange(
                        newLine,
                        { line: i + 1, ch: 0 },
                        { line: i + 1, ch: line.length }
                    );
                    console.log(`Bad id! Replaced ${id} with ${newId} at line ${i + 1}`);
                }
            }
        }

        currentCard = [];
    }
    
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

function convertToAnkiCloze(content: string): string {
    let result = content;

    // Match {cloze::hint} / {{{cloze::hint}}} and set the cloze number to the number of braces
    result = result.replace(/(\{+)(?!c\d+::)([^\{\}\n\r:]+)(?:::([^\{\}\n\r:]+))?(\}+)/g, (match, openBraces, cloze, hint, closeBraces) => {
        const openCount = openBraces.length;
        const closeCount = closeBraces.length;
        const clozeNum = Math.min(openCount, closeCount);
        return hint ? `{{c${clozeNum}::${cloze}::${hint}}}` : `{{c${clozeNum}::${cloze}}}`;
    });

    // ==cloze== to {{c1::cloze}}
    result = result.replace(/==([^=]+)==/g, '{{c1::$1}}');

    return result;
}
function handleBrackets(content: string): string {
    let result = content;
    let bracketContent = '';
    result = result.replace(/\[\[([^\[\]\n]+)\]\]/g, (match, link) => {
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
