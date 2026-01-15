import TelegramBot from 'node-telegram-bot-api';

/**
 * Telegram Bot Service
 */
class BotService {
    constructor() {
        this.bot = null;
    }

    initialize() {
        this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
        console.log('✅ Telegram bot initialized');
        return this.bot;
    }

    async sendMessage(chatId, text, options = {}) {
        try {
            return await this.bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                ...options
            });
        } catch (error) {
            console.error('Failed to send message:', error.message);
            return null;
        }
    }

    async sendDocument(chatId, filePath, caption = '') {
        try {
            return await this.bot.sendDocument(chatId, filePath, {
                caption
            });
        } catch (error) {
            console.error('Failed to send document:', error.message);
            return null;
        }
    }

    async sendTyping(chatId) {
        try {
            await this.bot.sendChatAction(chatId, 'typing');
        } catch (error) {
            // Ignore
        }
    }

    onMessage(callback) {
        this.bot.on('message', callback);
    }

    onText(regex, callback) {
        this.bot.on('message', (msg) => {
            if (msg.text && regex.test(msg.text)) {
                callback(msg);
            }
        });
    }
}

export default new BotService();
