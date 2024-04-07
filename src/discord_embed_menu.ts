import { EventEmitter } from 'events';
import { TextChannel, User, Message, EmbedBuilder, PermissionsString, MessageReaction, ReactionCollector, Collection, ChannelType, ButtonBuilder, BaseInteraction, TextBasedChannel, CommandInteraction, InteractionResponse, ActionRowBuilder, ComponentType, InteractionCollector, ButtonInteraction, MessageComponentInteraction } from 'discord.js';

import { ButtonType, DiscordEmbedMenuPage } from './discord_embed_menu_page';

type DiscordEmbedMenuType = {
    name: string,
    content: EmbedBuilder,
    reactions: { [key: string]: string },
    buttons?: Record<string, ButtonType>
    index: number
}

type StartOptions = {
    send: boolean,
    followUp: boolean,
    reply: boolean
}

export class DiscordEmbedMenu extends EventEmitter {

    private static readonly REQUIRED_PERMS: PermissionsString[] = ['SendMessages', 'EmbedLinks', 'AddReactions', 'ManageMessages'];
    private static LOADING_MESSAGE: string = 'Carregando, por favor seja paciente...';

    public interaction: CommandInteraction;
    public channel: TextBasedChannel;
    public user: User;
    public pages: any[];
    public timeout: number;
    public deleteOnTimeout: boolean;
    public mention: boolean;
    public keepUserReactionOnStop: boolean;
    public loadingMessage: string;

    private isDM: boolean;
    private userTag: string;

    public currentPage: DiscordEmbedMenuPage;
    public pageIndex: number;

    public menu: Message | InteractionResponse | null = null;
    public reactionCollector: ReactionCollector | null = null;
    public componentCollector: MessageComponentInteraction | null = null;

    public data: any = {};

    public constructor(interaction: BaseInteraction, pages: (DiscordEmbedMenuType | DiscordEmbedMenuPage)[], timeout: number = 300000, deleteOnTimeout: boolean = true, mention: boolean = false, keepUserReactionOnStop: boolean = true, loadingMessage?: string) {
        super();
        this.interaction = interaction as CommandInteraction;
        this.channel = interaction.channel as TextBasedChannel;
        this.user = interaction.user;
        this.timeout = timeout;
        this.deleteOnTimeout = deleteOnTimeout;
        this.mention = mention;
        this.keepUserReactionOnStop = keepUserReactionOnStop;
        this.loadingMessage = loadingMessage || DiscordEmbedMenu.LOADING_MESSAGE;

        this.isDM = !this.channel || this.channel.isDMBased();
        this.userTag = '<@' + this.user.id + '>';

        this.pages = [];
        for (let i = 0, l = pages.length; i < l; i++) {
            let page = pages[i];
            this.pages.push(page instanceof DiscordEmbedMenuPage ? page : new DiscordEmbedMenuPage(page.name, page.content, page.reactions, i, page.buttons));
        }
        this.currentPage = this.pages[0];
        this.pageIndex = 0;
    }

    public async start(options: StartOptions): Promise<void> {
        return await this.setPage(0, options);
    }

    public async stop(): Promise<void | Message> {
        this.stopReactions(false);
        if (this.menu && this.keepUserReactionOnStop) {
            if (this.menu instanceof Message)
                this.menu.reactions.cache.forEach(async (reaction: MessageReaction) => {
                    if (this.menu && this.menu.client && this.menu.client.user) {
                        await reaction.users.remove(this.menu.client.user.id);
                    }
                });
        } else if (!this.isDM) {
            return await this.clearReactions();
        }
    }

    public async delete(): Promise<void | Message> {
        this.stopReactions(false);
        if (this.menu) {
            return await this.menu.delete();
        }
    }

    private async clearReactions(): Promise<void | Message> {
        if (this.menu && !this.isDM && this.menu instanceof Message) {
            return this.menu.reactions.removeAll();
        }
    }

    public async setPage(page: number | string = 0, options?: StartOptions): Promise<void> {

        if (typeof(page) === 'string') {
            let pageIndex = this.pages.findIndex(p => p.name === page);
            if (pageIndex != -1) {
                page = pageIndex;
            } else {
                throw new Error(`Page "${page}" not found!`);
            }
        }

        this.emit('page-changing', this.pageIndex, this.currentPage, page, this.pages[page]);

        this.pageIndex = page;
        this.currentPage = this.pages[this.pageIndex];

        let content = (!this.isDM && this.mention ? this.userTag : '');
        let loadingEmbed = new EmbedBuilder({
            title: this.currentPage.content.data.title as string,
            description: this.loadingMessage
        });

        if (this.isDM) {
            if (this.menu) {
                await this.menu.delete();
                this.menu = null;
            }
            if (this.channel) {
                this.menu = await this.channel.send({ content, embeds: [loadingEmbed] });
            } else {
                this.menu = await this.user.send({ content, embeds: [loadingEmbed] });
                this.channel = this.menu.channel as TextChannel;
            }
        } else {
            if (this.menu) {
                await this.menu.edit({ content, embeds: [loadingEmbed], components: [] });
            } else {
                if (options?.reply)
                    this.menu = await this.interaction.reply({ content, embeds: [loadingEmbed], components: [] });
                else if (options?.followUp)
                    this.menu = await this.interaction.followUp({ content, embeds: [loadingEmbed], components: [] });
                else this.menu = await this.channel.send({ content, embeds: [loadingEmbed], components: [] });
            }
        }

        if (this.currentPage.reactions) {
            this.stopReactions(true);
            await this.addReactions();
            this.awaitReactions();
        }

        const components: ActionRowBuilder<ButtonBuilder>[] = [];
        if (this.currentPage.buttons) {
            const buttons = this.currentPage.buttons as Record<string, ButtonType>
            for (let i = 0; i < Object.keys(buttons).length; i++)
                if (i % 5 == 0)
                    components.push(new ActionRowBuilder<ButtonBuilder>())
            for (const row of components) {
                for (const button of Object.values(buttons)) {
                    row.addComponents(button.button)
                }
            }
        }

        this.menu = await this.menu.edit({content, embeds: [this.currentPage.content], components });

        if (this.currentPage.buttons) {
            await this.awaitButtons()
        }

        this.emit('page-changed', this.pageIndex, this.currentPage);
    }

    private async addReactions(): Promise<MessageReaction[]> {
        let reactions: MessageReaction[] = [];
        if (this.menu && this.menu instanceof Message) {
            for (let reaction in this.currentPage.reactions) {
                reactions.push(await this.menu.react(reaction));
            }
        }
        return reactions;
    }

    private stopReactions(triggerEnd: boolean = true) {
        if (this.reactionCollector) {
            if (!triggerEnd) {
                this.reactionCollector.removeAllListeners();
            }
            this.reactionCollector.stop();
            this.reactionCollector = null;
        }
    }

    private async awaitButtons() {
        if (this.menu && this.menu instanceof Message) {
            const filter = (_interaction: any): boolean => {
                return _interaction.user.id === this.user.id
            }
            try {
                const component = await this.menu.awaitMessageComponent({ filter, time: this.timeout, componentType: ComponentType.Button })
                if (!component) return
                component.deferUpdate()

                const key = Object.prototype.hasOwnProperty.call(this.currentPage.buttons, component.customId as string)
                    ? component.customId
                    : Object.prototype.hasOwnProperty.call(this.currentPage.buttons, component.id as string) ? component.id : null;
                if (key && this.menu && this.menu instanceof Message) {
                    if (component.user.id !== this.user.id) return
                    if (!this.currentPage.buttons) return
                    if (typeof this.currentPage.buttons[key].action !== 'string') {
                        this.currentPage.buttons[key].action(this);
                    }
                    switch (this.currentPage.buttons[key].action) {
                        case "first":
                            this.setPage(0);
                            break
                        case "last":
                            this.setPage(this.pages.length - 1);
                            break
                        case 'previous': {
                            if (this.pageIndex > 0) {
                                this.setPage(this.pageIndex - 1);
                            }
                            break;
                        }
                        case 'next': {
                            if (this.pageIndex < this.pages.length - 1) {
                                this.setPage(this.pageIndex + 1);
                            }
                            break;
                        }
                        case 'delete': {
                            this.delete()
                            break
                        }
                        default: {
                            this.setPage(
                                this.pages.findIndex(p => this.currentPage.buttons &&  p.name === this.currentPage.buttons[key].action)
                            );
                            break;
                        }
                    }
                }
            } catch (error) {
                if (!this.isDM) {
                    if (this.deleteOnTimeout) {
                        this.delete();
                    } else {
                        await this.menu?.edit({ components: [] });
                    }
                }
            }
        }
    }

    private awaitReactions() {
        if (this.menu && this.menu instanceof Message) {
            const filter = (_reaction: MessageReaction, user: User): boolean => {
                return this.menu != null && this.menu.client != null && this.menu.client.user != null && user.id != this.menu.client.user.id;
            }
            this.reactionCollector = this.menu.createReactionCollector({ filter, time: this.timeout });
    
            let reactionsChanged: boolean;
            this.reactionCollector.on('end', (reactions: Collection<string, MessageReaction>) => {
                if (!this.isDM) {
                    if (reactions) {
                        if (reactionsChanged) {
                            return this.clearReactions();
                        } else if (this.menu) {
                            reactions.at(0)?.users.remove(this.menu.client.users.cache.get(this.user.id));
                        }
                    } else if (this.deleteOnTimeout) {
                        return this.delete();
                    } else {
                        return this.clearReactions();
                    }
                }
            })
    
            this.reactionCollector.on('collect', (reaction: MessageReaction, user: User) => {
                const reactionName = Object.prototype.hasOwnProperty.call(this.currentPage.reactions, reaction.emoji.name as string)
                    ? reaction.emoji.name
                    : Object.prototype.hasOwnProperty.call(this.currentPage.reactions, reaction.emoji.id as string) ? reaction.emoji.id : null;
    
                if (user.id !== this.user.id || !Object.keys(this.currentPage.reactions).includes(reactionName as string)) {
                    return reaction.users.remove(user);
                }
    
                if (reactionName && this.menu && this.menu instanceof Message) {
                    if (typeof this.currentPage.reactions[reactionName] === 'function') {
                        // this this flag is not true then the clearReaction() at ligne 188 will be never call when try to change page
                        // also test when no page change it works too
                        reactionsChanged=true;
                        return this.currentPage.reactions[reactionName](this);
                    }
    
                    switch (this.currentPage.reactions[reactionName]) {
                        case 'first': {
                            reactionsChanged = JSON.stringify(this.menu.reactions.cache.keys()) != JSON.stringify(Object.keys(this.pages[0].reactions));
                            this.setPage(0);
                            break;
                        }
                        case 'last': {
                            reactionsChanged = JSON.stringify(this.menu.reactions.cache.keys()) != JSON.stringify(Object.keys(this.pages[this.pages.length - 1].reactions));
                            this.setPage(this.pages.length - 1);
                            break;
                        }
                        case 'previous': {
                            if (this.pageIndex > 0) {
                                reactionsChanged = JSON.stringify(this.menu.reactions.cache.keys()) != JSON.stringify(Object.keys(this.pages[this.pageIndex - 1].reactions));
                                this.setPage(this.pageIndex - 1);
                            }
                            break;
                        }
                        case 'next': {
                            if (this.pageIndex < this.pages.length - 1) {
                                reactionsChanged = JSON.stringify(this.menu.reactions.cache.keys()) != JSON.stringify(Object.keys(this.pages[this.pageIndex + 1].reactions));
                                this.setPage(this.pageIndex + 1);
                            }
                            break;
                        }
                        case 'stop': {
                            this.stop();
                            break;
                        }
                        case 'delete': {
                            this.delete();
                            break;
                        }
                        default: {
                            reactionsChanged = JSON.stringify(this.menu.reactions.cache.keys()) != JSON.stringify(Object.keys(this.pages.find(p => p.name === this.currentPage.reactions[reactionName]).reactions));
                            this.setPage(this.pages.findIndex(p => p.name === this.currentPage.reactions[reactionName]));
                            break;
                        }
                    }
                }
            });
        }
        
    }

}
