import { EmbedBuilder } from 'discord.js';

export class DiscordEmbedMenuPage {

    public name: string;
    public content: EmbedBuilder;
    public reactions: any;
    public index: number;

    public constructor(name: string, content: EmbedBuilder, reactions: any, index: number) {
        this.name = name;
        this.content = content;
        this.reactions = reactions;
        this.index = index;
    }

}
