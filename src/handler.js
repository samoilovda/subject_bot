import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
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
                ], [
                    { text: '📄 Загрузить .txt', callback_data: 'upload_txt' }
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

    /**
     * Handle uploaded .txt file with pre-answered questions
     */
    async handleUploadedFile(chatId, fileId, fileName) {
        try {
            // Download file from Telegram
            const fileLink = await botService.bot.getFileLink(fileId);
            const response = await axios.get(fileLink, { responseType: 'text' });
            const content = response.data;

            // Parse Q&A pairs from content
            const qaPairs = this.parseQAFromText(content);

            if (qaPairs.length === 0) {
                await botService.sendMessage(chatId, '❌ Не удалось найти ответы в файле. Убедитесь, что файл содержит вопросы и ответы.');
                return;
            }

            // Create session with parsed answers
            this.sessions.set(chatId, {
                currentIndex: qaPairs.length,
                answers: qaPairs,
                summary: null,
                lastActivity: Date.now()
            });

            await botService.sendMessage(chatId, `📄 Файл получен: *${fileName}*\n\n✅ Найдено ${qaPairs.length} ответов.\n\n⏳ Генерирую анализ...`);
            await botService.sendTyping(chatId);

            // Generate summary directly
            await this.generateAndSendSummary(chatId);

        } catch (error) {
            console.error('File upload error:', error.message);
            await botService.sendMessage(chatId, '❌ Ошибка при обработке файла. Попробуйте снова.');
        }
    }

    /**
     * Parse Q&A pairs from text content
     */
    parseQAFromText(content) {
        const qaPairs = [];
        const lines = content.split('\n');

        let currentQuestion = null;
        let currentAnswer = [];
        let inAnswer = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Check for question markers
            if (trimmed.match(/^【?Вопрос\s*\d+】?[:.]?/i) || trimmed.match(/^\d+[\.\)]/)) {
                // Save previous Q&A if exists
                if (currentQuestion && currentAnswer.length > 0) {
                    qaPairs.push({
                        question: currentQuestion,
                        answer: currentAnswer.join('\n').trim()
                    });
                }
                currentQuestion = trimmed.replace(/^【?Вопрос\s*\d+】?[:.]?\s*/i, '').replace(/^\d+[\.\)]\s*/, '');
                currentAnswer = [];
                inAnswer = false;
            }
            // Check for answer marker
            else if (trimmed.match(/^Ответ[:.]?/i)) {
                inAnswer = true;
            }
            // Collect answer lines
            else if (inAnswer && trimmed) {
                currentAnswer.push(trimmed);
            }
            // If no markers, treat non-empty lines after question as answer
            else if (currentQuestion && trimmed && !trimmed.match(/^[─═]+$/)) {
                currentAnswer.push(trimmed);
            }
        }

        // Don't forget the last Q&A
        if (currentQuestion && currentAnswer.length > 0) {
            qaPairs.push({
                question: currentQuestion,
                answer: currentAnswer.join('\n').trim()
            });
        }

        return qaPairs;
    }
}

export default new QuestionHandler();
