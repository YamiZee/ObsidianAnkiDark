// ankiconnect.ts
import { App } from 'obsidian';
import { Flashcard, ObsidianBasicModel, ObsidianBasicReversedModel, ObsidianClozeModel } from './models';

export async function ankiConnectRequest(action: string, params: any = {}): Promise<any> {
    const response = await fetch('http://127.0.0.1:8765', {
        method: 'POST',
        body: JSON.stringify({
            action,
            version: 6,
            params
        }),
        headers: {
            'Content-Type': 'application/json'
        }
    });
    return response.json();
}

export async function checkAnkiConnect(): Promise<boolean> {
    try {
        const result = await ankiConnectRequest('version');
        if (result && typeof result.result === 'number') {
            console.log('AnkiConnect connection successful. Version:', result.result);
            return true;
        } else {
            console.error('AnkiConnect connection failed. Unexpected response:', result);
            return false;
        }
    } catch (e) {
        console.error('AnkiConnect connection failed:', e);
        return false;
    }
}

export async function addNotesToAnki(flashcards: Flashcard[]): Promise<(number | null)[]> {
    if (flashcards.length === 0) return [];
    
    const notes = flashcards.map(flashcard => ({
        deckName: sanitizeDeckName(flashcard.deckName),
        modelName: flashcard.modelName,
        fields: flashcard.fields,
        tags: flashcard.tags,
        options: {
            allowDuplicate: true
        }
    }));
    
    const result = await ankiConnectRequest('addNotes', { notes });
    console.log('addNotesToAnki result:', result);
    if (result && Array.isArray(result.result)) {
        console.log('Notes added to Anki:', result.result);
        return result.result; // array of note ids
    }
    return [];
}

export async function updateNotesInAnki(flashcards: Flashcard[]): Promise<any> {
    if (flashcards.length === 0) return [];

    try {
        const result = await changeDeck(flashcards, flashcards[0].deckName);

        const actions = flashcards.map(flashcard => ({
            action: 'updateNote',
            params: {
                note: {
                    id: flashcard.id,
                    fields: flashcard.fields,
                    tags: flashcard.tags
                }
            }
        }));

        // Send batch request
        const batchResults = await ankiConnectRequest('multi', { actions });
        return {changeDeckResult: result, updateResults: batchResults};

    } catch (error) {
        console.error('Error updating notes:', error);
        return error;
    }
}

export async function ensureDeckExists(deckName: string): Promise<boolean> { // try without fetching decknames
    deckName = sanitizeDeckName(deckName);
    try {
        // Get all deck names
        const result = await ankiConnectRequest('deckNames');
        if (result && Array.isArray(result.result)) {
            if (result.result.includes(deckName)) {
                // console.log(`Deck "${deckName}" exists.`);
                return true;
            } else {
                // Create the deck
                const createResult = await ankiConnectRequest('createDeck', { deck: deckName });
                if (createResult && createResult.result) {
                    console.log(`Created deck: "${deckName}"`);
                    return true;
                } else {
                    console.error(`Failed to create deck "${deckName}"`);
                    return false;
                }
            }
        } else {
            console.error('Failed to get deck names');
            return false;
        }
    } catch (e) {
        console.error(`Error ensuring deck "${deckName}" exists:`, e);
        return false;
    }
}

export async function changeDeck(flashcards: Flashcard[], deckName: string): Promise<any> {
    deckName = sanitizeDeckName(deckName);
    try {
        const noteIds = flashcards.map(flashcard => flashcard.id!);
        const noteInfo = await ankiConnectRequest('notesInfo', { notes: noteIds });
        // console.log('noteInfo:', noteInfo);
        
        const cardIds = noteInfo.result.flatMap((note: any) => note.cards);
        
        const result = await ankiConnectRequest('changeDeck', {
            cards: cardIds,
            deck: deckName
        });
        return result;
    } catch (error) {
        console.error('Error changing deck:', error);
        return error;
    }
}

export function sanitizeDeckName(deckName: string): string {
    return deckName.replace(/[\\/]/g, '::');
}

export async function ensureDefaultModelsExist(): Promise<boolean> {
    try {
        const models = await ankiConnectRequest('modelNames');
        if (!models.result.includes(ObsidianBasicModel.modelName)) {
            await ankiConnectRequest('createModel', ObsidianBasicModel);
            console.log('Created model:', ObsidianBasicModel.modelName);
        }
        if (!models.result.includes(ObsidianClozeModel.modelName)) {
            await ankiConnectRequest('createModel', ObsidianClozeModel);
            console.log('Created model:', ObsidianClozeModel.modelName);
        }
        if (!models.result.includes(ObsidianBasicReversedModel.modelName)) {
            await ankiConnectRequest('createModel', ObsidianBasicReversedModel);
            console.log('Created model:', ObsidianBasicReversedModel.modelName);
        }
        return true;
    } catch (e) {
        console.error('Error ensuring default models exist:', e);
        return false;
    }
}

export async function uploadMediaFile(filePath: string, fileName: string, app: App): Promise<boolean> {
    // Check if file already exists in anki
    const result = await ankiConnectRequest('getMediaFilesNames', {
        pattern: fileName
    });
    if (result?.result?.length > 0) {
        return true;
    }
    // Upload file
    try {
        console.log('uploadMediaFile filePath:', filePath);
        const fileBuffer = await app.vault.adapter.readBinary(filePath);
        const base64FileBuffer = Buffer.from(fileBuffer).toString('base64');
        
        const result = await ankiConnectRequest('storeMediaFile', {
            filename: fileName,
            data: base64FileBuffer
        });

        console.log('Uploaded media file:', fileName);
        return result?.result === true;
    } catch (error) {
        console.error(`Error uploading media file ${fileName}:`, error);
        return false;
    }
}

export async function processImagesForAnki(content: string, vaultPath: string, app: App): Promise<string> {
    // Convert markdown image syntax to HTML
    // ![[path]]
    const imageFilenames: string[] = [];
    content = content.replace(/!\[\[([^\[\]\n]+)\]\]/g, (match, imagePath) => {
        imageFilenames.push(imagePath);
        return `<img src="${imagePath}">`;
    });
    // ![alt](path)
    content = content.replace(/!\[([^\[\]\n]+)\]\(([^\(\)\n]+)\)/g, (match, altText, imagePath) => {
        imageFilenames.push(imagePath);
        return `<img src="${imagePath}" alt="${altText}">`;
    });

    if (imageFilenames.length > 0) {
        console.log('Processing images:', imageFilenames);
    }
    
    for (const filename of imageFilenames) {
        // Check if url
        if (filename.startsWith('http://') || filename.startsWith('https://')) {
            continue;
        }
        // Try to find the actual file in the vault
        let filePath = '';
        
        // First try the filename as-is (in case it's in root)
        if (await app.vault.adapter.exists(filename)) {
            filePath = filename; // vault-relative
        } else {
            // Search for the file in the vault
            const files = app.vault.getFiles();
            const matchingFile = files.find(file => file.name === filename);
            if (matchingFile) {
                filePath = matchingFile.path; // vault-relative
            } else {
                console.warn(`Could not find image file: ${filename}`);
                continue;
            }
        }
        // possible duplicate within obsidian, store/image.jpg -> store_image.jpg
        content = content.replace(/<img src="(.*)"/g, (match, imagePath) => {
            imagePath = imagePath.replace(/[\\\/]/g, '_');
            return `<img src="${imagePath}"`;
        });

        await uploadMediaFile(filePath, filename, app);
    }
    return content;
}