

const captureNotes = "/(?<=^)(?<!::^)(?!\^)(?:[\s\S]*?)\n(?<!::\n)(?![ \t]*?(?:\^|::))/gm";






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

