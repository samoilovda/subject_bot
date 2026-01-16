import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import botService from './bot/service.js';
import summaryService from './ai/summary.js';
import { questions, introMessage, congratsMessage } from './config/questions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Question Flow Handler
 * Manages sequential questioning and summary generation.
 */

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_ANSWER_LENGTH = 4000;

class QuestionHandler {
    constructor() {
        // chatId -> { currentIndex, answers: [{question, answer}], lastActivity }
        this.sessions = new Map();

        // Cleanup stale sessions every 10 minutes
        setInterval(() => this.cleanupStaleSessions(), 10 * 60 * 1000);
    }

    getSession(chatId) {
        return this.sessions.get(chatId);
    }

    startSession(chatId) {
        this.sessions.set(chatId, {
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

    async handleStart(msg) {
        const chatId = msg.chat.id;
        this.startSession(chatId);

        await botService.sendMessage(chatId, introMessage);

        // Send menu with options
        await botService.bot.sendMessage(chatId, 'Выберите действие:', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Начать опрос', callback_data: 'start_questions' }
                ]]
            }
        });
    }

    async handleStartQuestions(chatId) {
        const session = this.getSession(chatId);
        if (!session) {
            this.startSession(chatId);
        }
        await this.sendNextQuestion(chatId);
    }

    async sendNextQuestion(chatId) {
        const session = this.getSession(chatId);
        if (!session) return;

        const index = session.currentIndex;

        if (index >= questions.length) {
            // All questions answered - generate summary
            await this.generateAndSendSummary(chatId);
            return;
        }

        const questionNumber = index + 1;
        const totalQuestions = questions.length;
        const progressText = `📝 *Вопрос ${questionNumber} из ${totalQuestions}*\n\n`;

        await botService.sendMessage(chatId, progressText + questions[index]);
    }

    async handleAnswer(chatId, text) {
        const session = this.getSession(chatId);
        if (!session) return;

        // Update last activity
        session.lastActivity = Date.now();

        // Validate input length
        if (text.length > MAX_ANSWER_LENGTH) {
            await botService.sendMessage(chatId, `⚠️ Ответ слишком длинный (максимум ${MAX_ANSWER_LENGTH} символов). Пожалуйста, сократите ответ.`);
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

        await botService.sendMessage(chatId, '⏳ *Анализирую ваши ответы...*\n\nЭто может занять минуту.');
        await botService.sendTyping(chatId);

        // Generate AI summary
        const summary = await summaryService.generateSummary(session.answers);
        session.summary = summary;

        // Send summary
        await botService.sendMessage(chatId, `📊 *Глубокий анализ*\n\n${summary}`);

        // Send congratulations
        await botService.sendMessage(chatId, congratsMessage);

        // Save button
        await botService.bot.sendMessage(chatId, 'Хотите сохранить результаты?', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '💾 Сохранить в .txt', callback_data: 'save_results' }
                ], [
                    { text: '🔄 Начать заново', callback_data: 'restart' }
                ]]
            }
        });
    }

    async saveResults(chatId, userName = 'user') {
        const session = this.getSession(chatId);
        if (!session) {
            await botService.sendMessage(chatId, '❌ Нет данных для сохранения. Начните заново с /start');
            return;
        }

        // Create exports directory
        const exportsDir = path.join(__dirname, '..', 'exports');
        if (!fs.existsSync(exportsDir)) {
            fs.mkdirSync(exportsDir, { recursive: true });
        }

        // Generate file content
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `results_${chatId}_${timestamp}.txt`;
        const filePath = path.join(exportsDir, fileName);

        let content = `═══════════════════════════════════════════\n`;
        content += `          РЕЗУЛЬТАТЫ ПЕРВОГО ЭТАПА\n`;
        content += `═══════════════════════════════════════════\n\n`;
        content += `Дата: ${new Date().toLocaleDateString('ru-RU')}\n`;
        content += `Время: ${new Date().toLocaleTimeString('ru-RU')}\n\n`;
        content += `───────────────────────────────────────────\n`;
        content += `                 ОТВЕТЫ\n`;
        content += `───────────────────────────────────────────\n\n`;

        session.answers.forEach((qa, i) => {
            content += `【Вопрос ${i + 1}】\n${qa.question}\n\n`;
            content += `Ответ:\n${qa.answer}\n\n`;
            content += `───────────────────────────────────────────\n\n`;
        });

        content += `\n═══════════════════════════════════════════\n`;
        content += `              ГЛУБОКИЙ АНАЛИЗ\n`;
        content += `═══════════════════════════════════════════\n\n`;
        content += session.summary || 'Анализ недоступен';
        content += `\n\n═══════════════════════════════════════════\n`;
        content += `    Поздравляем с завершением первого этапа!\n`;
        content += `═══════════════════════════════════════════\n`;

        // Write file
        fs.writeFileSync(filePath, content, 'utf8');

        // Send document
        await botService.sendDocument(chatId, filePath, '📄 Ваши результаты');
        await botService.sendMessage(chatId, '✅ Результаты сохранены и отправлены вам файлом.');
    }

    async handleRestart(chatId) {
        this.clearSession(chatId);
        await this.handleStart({ chat: { id: chatId } });
    }
}

export default new QuestionHandler();
