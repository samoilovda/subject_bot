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
            try {
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
                }
            } catch (error) {
                console.error('❌ Callback query error:', error.message);
            }
        });

        // Handle text messages (answers)
        botService.onMessage((msg) => {
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
