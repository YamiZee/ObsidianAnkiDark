import { App } from 'obsidian';

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
    css: `
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
`
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
    css: `
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
`
};

export class Flashcard {
    id?: number;
    deckName: string;
    isCloze: boolean;
    fields: Record<string, string>;
    tags: string[];
    modelName: string;

    constructor({ id, deckName, isCloze, fields, tags, modelName }: {
        id?: number;
        deckName: string;
        isCloze: boolean;
        fields: Record<string, string>;
        tags?: string[];
        modelName?: string;
    }) {
        this.deckName = deckName;
        this.isCloze = isCloze;
        this.fields = fields;
        this.id = id;
        this.tags = tags || [];
        this.modelName = modelName || (isCloze ? ObsidianClozeModel.modelName : ObsidianBasicModel.modelName);
    }
} 