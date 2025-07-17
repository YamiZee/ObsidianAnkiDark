import { App } from 'obsidian';

const css = `
.card {
    font-family: arial;
    font-size: 20px;
    text-align: center;
}
pre code {
  background-color: #eee;
  border: 2px solid #ddd;
  display: block;
  padding: 20px 30px;
}
.nightMode pre code {
  background-color: #333;
  border: 1px solid #333;
}
`;

export const ObsidianBasicModel = {
    modelName: 'ObsidianBasic',
    inOrderFields: ['Front', 'Back', 'Source'],
    cardTemplates: [
        {
            Name: 'Card 1',
            Front: '{{Front}}',
            Back: '{{Front}}<hr id=answer>{{Back}}<br>{{Source}}'
        }
    ],
    css: css,
};

export const ObsidianBasicReversedModel = {
    modelName: 'ObsidianReversed',
    inOrderFields: ['Front', 'Back', 'Source'],
    cardTemplates: [
        {
            Name: 'Card 1',
            Front: '{{Front}}',
            Back: '{{Front}}<hr id=answer>{{Back}}<br>{{Source}}'
        },
        {
            Name: 'Card 2',
            Front: '{{Back}}',
            Back: '{{Back}}<hr id=answer>{{Front}}<br>{{Source}}'
        }
    ],
    css: css,
};

export const ObsidianClozeModel = {
    modelName: 'ObsidianCloze',
    inOrderFields: ['Text', 'Back Extra', 'Source'],
    cardTemplates: [
        {
            Name: 'Cloze',
            Front: '{{cloze:Text}}',
            Back: '{{cloze:Text}}<br>{{Back Extra}}<br>{{Source}}'
        }
    ],
    isCloze: true,
    css: css,
};

export class Flashcard {
    id?: number;
    deckName: string;
    type: FlashcardType;
    fields: Record<string, string>;
    tags: string[];
    modelName: string;

    constructor({ id, deckName, type, fields, tags, modelName }: {
        id?: number;
        deckName: string;
        type: FlashcardType;
        fields: Record<string, string>;
        tags?: string[];
        modelName?: string;
    }) {
        this.id = id;
        this.deckName = deckName;
        this.type = type;
        this.fields = fields;
        this.tags = tags || [];
        this.modelName = modelName || (type === FlashcardType.Cloze ? 'ObsidianCloze' : type === FlashcardType.Reversed ? 'ObsidianReversed' : 'ObsidianBasic');
    }
} 

export enum FlashcardType {
    Basic = 'Basic',
    Cloze = 'Cloze',
    Reversed = 'Reversed'
}
