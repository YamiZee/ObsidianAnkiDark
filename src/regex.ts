

const captureNotes = "/(?<=^)(?<!::^)(?!\^)(?:[\s\S]*?)\n(?<!::\r?\n)(?![ \t]*?(?:\^|::))/gm";


const line ="/(?<=^|\n)[\s\S]*?(?:$|\r?\n)/g";

// xxxx::\nxxxx
const ccEnd = "/(?<=^|\n)[^\n]*?::[ \t]*\r?\n[^\n]*(?:$|\n)/g";
// xxxx\n::xxxx
const ccStart = "/(?<=^|\n)[^\n]*\n[ \t]*::[^\n]*(?:$|\n)/g";
// xxxx\n^1 xxxx
const footnoteStart = "/(?<=^|\n)[^\n]*\n[ \t]*\^\d+[ \t]*(?:$|\r?\n)/g";

//(?<=^|\n)[ \t]*?[^\n]*?(?:$|\r?\n)

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

