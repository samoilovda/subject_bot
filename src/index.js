import dotenv from 'dotenv';
dotenv.config();

import botService from './bot/service.js';
import questionHandler from './handler.js';
import { questions } from './config/questions.js';

async function start() {
    try {
        console.log('🎓 Starting Subject Bot...');
        console.log('==========================');

        if (!process.env.TELEGRAM_BOT_TOKEN) {
            throw new Error('TELEGRAM_BOT_TOKEN is required in .env');
        }

        // Initialize bot
        botService.initialize();

        // Handle /start command
        botService.onText(/^\/start/, (msg) => {
            questionHandler.handleStart(msg);
        });

        // Handle callback queries (buttons)
        botService.bot.on('callback_query', async (query) => {
            const chatId = query.message.chat.id;
            const data = query.data;

            // Acknowledge the button press
            await botService.bot.answerCallbackQuery(query.id);

            switch (data) {
                case 'start_questions':
                    await questionHandler.handleStartQuestions(chatId);
                    break;
                case 'save_results':
                    await questionHandler.saveResults(chatId, query.from.first_name);
                    break;
                case 'restart':
                    await questionHandler.handleRestart(chatId);
                    break;
                case 'upload_txt':
                    await botService.sendMessage(chatId, '📤 Отправьте мне файл .txt с вашими ответами.\n\nФормат файла:\n```\n【Вопрос 1】\nТекст вопроса...\n\nОтвет:\nВаш ответ здесь\n```');
                    break;
            }
        });

        // Handle document uploads (.txt files) - must be before general message handler
        botService.bot.on('document', async (msg) => {
            console.log('📎 Document received:', msg.document.file_name);
            const chatId = msg.chat.id;
            const doc = msg.document;

            if (doc.file_name && doc.file_name.endsWith('.txt')) {
                await questionHandler.handleUploadedFile(chatId, doc.file_id, doc.file_name);
            } else {
                await botService.sendMessage(chatId, '📄 Пожалуйста, загрузите файл в формате .txt');
            }
        });

        // Handle text messages (answers)
        botService.onMessage((msg) => {
            // Skip if it's a document message
            if (msg.document) return;

            if (msg.text && !msg.text.startsWith('/')) {
                const session = questionHandler.getSession(msg.chat.id);
                if (session && session.currentIndex < questions.length) { // Only if in questioning phase
                    questionHandler.handleAnswer(msg.chat.id, msg.text);
                }
            }
        });

        console.log('✅ Subject Bot is running');
        console.log('📱 Send /start to begin');

        process.stdin.resume();

    } catch (error) {
        console.error('❌ Failed to start:', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down...');
    process.exit(0);
});

start();
