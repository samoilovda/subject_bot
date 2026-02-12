import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import botService from './bot/service.js';
import summaryService from './ai/summary.js';
import { getTranslations, getQuestions, getChainConfig } from './config/translations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Question Flow Handler
 * Manages sequential questioning and summary generation.
 * Supports Russian and Ukrainian languages.
 */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ANSWER_LENGTH = 4000;

class QuestionHandler {
    constructor() {
        // chatId -> { lang, currentIndex, answers: [{question, answer}], lastActivity }
        this.sessions = new Map();

        // Cleanup stale sessions every 10 minutes
        this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 10 * 60 * 1000);
    }

    /**
     * Cleanup resources (call on shutdown)
     */
    cleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.sessions.clear();
    }

    /**
     * Escape markdown special characters
     */
    escapeMarkdown(text) {
        if (!text) return '';
        // Legacy Markdown (V1) supports very few escapes.
        // It's safer to not escape punctuation like . - ! as it creates literal backslashes.
        // We will try to preserve bolding by ensuring ** becomes * (if V1 requires * for bold).

        let safe = text;

        // Convert **bold** (AI style) to *bold* (Telegram V1 style)
        safe = safe.replace(/\*\*(.*?)\*\*/g, '*$1*');

        // Escape specific characters if we want them literal, but for AI text we usually want formatting.
        // If we strictly want to avoid bugs, we should perhaps just NOT escape . - !
        // We only escape characters that would break the parsing structure if unpaired.
        // safe = safe.replace(/([_`\[])/g, '\\$1'); // Minimal escaping

        // Currently, removing the aggressive escaping logic entirely is the safest fix for the user's issue.
        return safe;
    }

    getSession(chatId) {
        return this.sessions.get(chatId);
    }

    startSession(chatId, lang = 'ru', chain = 1) {
        this.sessions.set(chatId, {
            lang,
            chain,
            currentIndex: 0,
            answers: [],
            summary: null,
            lastActivity: Date.now()
        });
    }

    cleanupStaleSessions() {
        const now = Date.now();
        for (const [chatId, session] of this.sessions) {
            if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
                this.sessions.delete(chatId);
                console.log(`🧹 Cleaned up stale session for chat ${chatId}`);
            }
        }
    }

    clearSession(chatId) {
        this.sessions.delete(chatId);
    }

    /**
     * Handle /start command - show language selection
     */
    async handleStart(msg) {
        const chatId = msg.chat.id;

        // Show language selection first
        await botService.bot.sendMessage(chatId, '🌐 Виберіть мову / Выберите язык:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🇷🇺 Русский', callback_data: 'lang_ru' },
                    { text: '🇺🇦 Українська', callback_data: 'lang_uk' },
                    { text: '🇬🇧 English', callback_data: 'lang_en' }
                ]]
            }
        });
    }

    /**
     * Handle language selection
     */
    async handleLanguageSelect(chatId, lang) {
        this.startSession(chatId, lang);
        const t = getTranslations(lang);

        // Show lesson selection
        await botService.bot.sendMessage(chatId, t.ui.chooseAction, {
            reply_markup: {
                inline_keyboard: [[
                    { text: t.ui.lesson1, callback_data: 'start_chain_1' },
                    { text: t.ui.lesson2, callback_data: 'start_chain_2' },
                    { text: t.ui.lesson3, callback_data: 'start_chain_3' }
                ]]
            }
        });
    }

    /**
     * Handle chain (lesson) selection
     */
    async handleChainSelect(chatId, chainId) {
        let session = this.getSession(chatId);
        if (!session) {
            this.startSession(chatId, 'ru', chainId);
            session = this.getSession(chatId);
        } else {
            // Update chain and reset keys
            session.chain = chainId;
            session.currentIndex = 0;
            session.answers = [];
            session.summary = null;
        }

        const config = getChainConfig(session.lang, chainId);
        const t = getTranslations(session.lang);

        await botService.sendMessage(chatId, config.introMessage);

        // Send menu with options to start
        await botService.bot.sendMessage(chatId, t.ui.chooseAction, {
            reply_markup: {
                inline_keyboard: [[
                    { text: t.ui.startQuestions, callback_data: 'start_questions' }
                ]]
            }
        });
    }

    async handleStartQuestions(chatId) {
        const session = this.getSession(chatId);
        if (!session) {
            // Fallback: start with Russian if no session
            this.startSession(chatId, 'ru');
        }
        await this.sendNextQuestion(chatId);
    }

    async sendNextQuestion(chatId) {
        const session = this.getSession(chatId);
        if (!session) return;

        const t = getTranslations(session.lang);
        const config = getChainConfig(session.lang, session.chain);
        const questions = config.questions;
        const index = session.currentIndex;

        if (index >= questions.length) {
            // All questions answered - generate summary
            await this.generateAndSendSummary(chatId);
            return;
        }

        const questionNumber = index + 1;
        const totalQuestions = questions.length;
        const progressText = t.ui.questionProgress(questionNumber, totalQuestions);

        await botService.sendMessage(chatId, progressText + questions[index]);
    }

    async handleAnswer(chatId, text) {
        const session = this.getSession(chatId);
        if (!session) {
            // Inform user if session is expired/missing (unless it's a command)
            if (!text.startsWith('/')) {
                await botService.sendMessage(chatId, '⌛ Сессия истекла. Пожалуйста, введите /start, чтобы начать заново.');
            }
            return;
        }

        const t = getTranslations(session.lang);
        const config = getChainConfig(session.lang, session.chain);
        const questions = config.questions;

        // Update last activity
        session.lastActivity = Date.now();

        // Validate input length
        if (text.length > MAX_ANSWER_LENGTH) {
            await botService.sendMessage(chatId, t.ui.answerTooLong(MAX_ANSWER_LENGTH));
            return;
        }

        // Save the answer
        session.answers.push({
            question: questions[session.currentIndex],
            answer: text.trim()
        });

        // Move to next question
        session.currentIndex++;

        // Small delay for natural feel
        await new Promise(r => setTimeout(r, 500));

        // Send next question or finish
        await this.sendNextQuestion(chatId);
    }

    async generateAndSendSummary(chatId) {
        const session = this.getSession(chatId);
        if (!session) return;

        const t = getTranslations(session.lang);

        await botService.sendMessage(chatId, t.ui.analyzing);
        await botService.sendTyping(chatId);

        // Generate AI summary with language
        const summary = await summaryService.generateSummary(session.answers, session.lang, session.chain);
        session.summary = summary;

        // Send summary (escape markdown in AI response to avoid formatting errors)
        const safeSummary = this.escapeMarkdown(summary);
        const config = getChainConfig(session.lang, session.chain);

        await botService.sendMessage(chatId, t.ui.deepAnalysis(safeSummary));

        // Send congratulations
        await botService.sendMessage(chatId, config.congratsMessage);

        // Save button
        await botService.bot.sendMessage(chatId, t.ui.savePrompt, {
            reply_markup: {
                inline_keyboard: [[
                    { text: t.ui.saveButton, callback_data: 'save_results' }
                ], [
                    { text: t.ui.restartButton, callback_data: 'restart' }
                ]]
            }
        });
    }

    async saveResults(chatId, userName = 'user') {
        const session = this.getSession(chatId);
        if (!session) {
            const t = getTranslations('ru');
            await botService.sendMessage(chatId, t.ui.noDataToSave);
            return;
        }

        const t = getTranslations(session.lang);
        const exp = t.export;

        // Create exports directory
        const exportsDir = path.join(__dirname, '..', 'exports');
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }

        // Generate file content
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `results_${chatId}_${timestamp}.txt`;
        const filePath = path.join(exportsDir, fileName);

        const locale = session.lang === 'uk' ? 'uk-UA' : (session.lang === 'en' ? 'en-US' : 'ru-RU');

        let content = `═══════════════════════════════════════════\n`;
        content += `          ${exp.header}\n`;
        content += `═══════════════════════════════════════════\n\n`;
        content += `${exp.date} ${new Date().toLocaleDateString(locale)}\n`;
        content += `${exp.time} ${new Date().toLocaleTimeString(locale)}\n\n`;
        content += `───────────────────────────────────────────\n`;
        content += `                 ${exp.answers}\n`;
        content += `───────────────────────────────────────────\n\n`;

        session.answers.forEach((qa, i) => {
            content += `${exp.questionLabel(i + 1)}\n${qa.question}\n\n`;
            content += `${exp.answerLabel}\n${qa.answer}\n\n`;
            content += `───────────────────────────────────────────\n\n`;
        });

        content += `\n═══════════════════════════════════════════\n`;
        content += `              ${exp.analysisHeader}\n`;
        content += `═══════════════════════════════════════════\n\n`;
        content += session.summary || exp.analysisUnavailable;
        content += `\n\n═══════════════════════════════════════════\n`;
        content += `    ${exp.congratsFooter}\n`;
        content += `═══════════════════════════════════════════\n`;

        // Write file
        fs.writeFileSync(filePath, content, 'utf8');

        // Send document
        await botService.sendDocument(chatId, filePath, t.ui.resultsCaption);

        // Delete file after sending to avoid disk bloat
        try {
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error('Failed to delete export file:', err.message);
        }
        await botService.sendMessage(chatId, t.ui.resultsSaved);
    }

    async handleRestart(chatId) {
        this.clearSession(chatId);
        await this.handleStart({ chat: { id: chatId } });
    }

    /**
     * Get questions for current session language
     */
    getSessionQuestions(chatId) {
        const session = this.getSession(chatId);
        const config = getChainConfig(session?.lang || 'ru', session?.chain || 1);
        return config.questions;
    }
}

export default new QuestionHandler();
