import axios from 'axios';
import { getTranslations } from '../config/translations.js';

/**
 * AI Summary Service
 * Generates deep analysis of user's answers.
 * Supports Russian and Ukrainian languages.
 */
class SummaryService {
    constructor() {
        this.baseURL = 'https://openrouter.ai/api/v1';
        this.model = 'deepseek/deepseek-chat';
    }

    get apiKey() {
        return process.env.OPENROUTER_API_KEY;
    }

    /**
     * Generates a deep summary based on all user answers.
     * @param {Array} questionsAndAnswers - Array of {question, answer} objects
     * @param {string} lang - Language code ('ru' or 'uk')
     */
    async generateSummary(questionsAndAnswers, lang = 'ru') {
        console.log('🔍 AI: Starting summary generation...');
        console.log('🔍 AI: API Key present:', !!this.apiKey);
        console.log('🔍 AI: Number of Q&A pairs:', questionsAndAnswers.length);
        console.log('🔍 AI: Language:', lang);

        const t = getTranslations(lang);

        if (!this.apiKey) {
            console.log('❌ AI: No API key - returning fallback');
            return t.ai.fallback;
        }

        try {
            const qaText = questionsAndAnswers
                .map((qa, i) => `${t.ai.questionLabel(i + 1)} ${qa.question}\n${t.ai.answerLabel} ${qa.answer}`)
                .join('\n\n');

            console.log('🔍 AI: Making API request to:', this.baseURL);

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: t.ai.systemPrompt
                        },
                        {
                            role: 'user',
                            content: t.ai.userPrompt(qaText)
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1500
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 120000
                }
            );

            console.log('✅ AI: Response received successfully');
            let content = response.data.choices[0].message.content.trim();

            // Clean output: remove #, *, / characters
            content = content.replace(/[#*\/]/g, '');

            return content;

        } catch (error) {
            console.error('❌ AI Error:', error.message);
            if (error.response) {
                console.error('❌ AI Response Status:', error.response.status);
                console.error('❌ AI Response Data:', JSON.stringify(error.response.data, null, 2));
            }
            if (error.code) {
                console.error('❌ AI Error Code:', error.code);
            }
            return t.ai.fallback;
        }
    }
}

export default new SummaryService();
