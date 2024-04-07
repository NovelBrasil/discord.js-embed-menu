import { ButtonBuilder, EmbedBuilder } from 'discord.js';
import { DiscordEmbedMenu } from './discord_embed_menu';

export type ButtonType = {
    action: ((v: DiscordEmbedMenu) => void) | string
    button: ButtonBuilder
}

export class DiscordEmbedMenuPage {

    public name: string;
    public content: EmbedBuilder;
    public reactions: any;
    public buttons: Record<string, ButtonType> | undefined;
    public index: number;

    public constructor(name: string, content: EmbedBuilder, reactions: any, index: number, buttons?: Record<string, ButtonType>) {
        this.name = name;
        this.content = content;
        this.reactions = reactions;
        this.buttons = buttons;
        this.index = index;
    }

}
