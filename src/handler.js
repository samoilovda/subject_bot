import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import botService from './bot/service.js';
import summaryService from './ai/summary.js';
import { getTranslations, getQuestions } from './config/translations.js';

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
        setInterval(() => this.cleanupStaleSessions(), 10 * 60 * 1000);
    }

    getSession(chatId) {
        return this.sessions.get(chatId);
    }

    startSession(chatId, lang = 'ru') {
        this.sessions.set(chatId, {
            lang,
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
                    { text: '🇺🇦 Українська', callback_data: 'lang_uk' }
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

        await botService.sendMessage(chatId, t.introMessage);

        // Send menu with options
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
        const questions = getQuestions(session.lang);
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
        if (!session) return;

        const t = getTranslations(session.lang);
        const questions = getQuestions(session.lang);

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
        const summary = await summaryService.generateSummary(session.answers, session.lang);
        session.summary = summary;

        // Send summary
        await botService.sendMessage(chatId, t.ui.deepAnalysis(summary));

        // Send congratulations
        await botService.sendMessage(chatId, t.congratsMessage);

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

        const locale = session.lang === 'uk' ? 'uk-UA' : 'ru-RU';

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
        return getQuestions(session?.lang || 'ru');
    }
}

export default new QuestionHandler();
