import axios from 'axios';

/**
 * AI Summary Service
 * Generates deep analysis of user's answers.
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
     */
    async generateSummary(questionsAndAnswers) {
        console.log('🔍 AI: Starting summary generation...');
        console.log('🔍 AI: API Key present:', !!this.apiKey);
        console.log('🔍 AI: Number of Q&A pairs:', questionsAndAnswers.length);

        if (!this.apiKey) {
            console.log('❌ AI: No API key - returning fallback');
            return this.getFallbackSummary();
        }

        try {
            const qaText = questionsAndAnswers
                .map((qa, i) => `Вопрос ${i + 1}: ${qa.question}\nОтвет: ${qa.answer}`)
                .join('\n\n');

            console.log('🔍 AI: Making API request to:', this.baseURL);

            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: this.model,
                    messages: [
                        {
                            role: 'system',
                            content: `Ты — глубокий психологический аналитик. Твоя задача — создать глубокий, развёрнутый анализ ответов человека.

ФОРМАТ ОТВЕТА:
1. **Общий портрет** — кто этот человек на основе его ответов (2-3 предложения)
2. **Ключевые паттерны** — какие повторяющиеся темы, убеждения или тенденции заметны
3. **Сильные стороны** — что проявляется как ресурс
4. **Зоны роста** — над чем стоит поработать
5. **Главный инсайт** — одно ключевое наблюдение

Пиши на русском языке. Будь глубоким, но конкретным. Избегай общих фраз.`
                        },
                        {
                            role: 'user',
                            content: `Вот ответы человека на вопросы:\n\n${qaText}\n\nСоздай глубокий анализ.`
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
            return response.data.choices[0].message.content.trim();

        } catch (error) {
            console.error('❌ AI Error:', error.message);
            if (error.response) {
                console.error('❌ AI Response Status:', error.response.status);
                console.error('❌ AI Response Data:', JSON.stringify(error.response.data, null, 2));
            }
            if (error.code) {
                console.error('❌ AI Error Code:', error.code);
            }
            return this.getFallbackSummary();
        }
    }

    getFallbackSummary() {
        return `📊 *Ваш анализ*

К сожалению, AI-анализ временно недоступен. Ваши ответы сохранены и будут проанализированы позже.

Пожалуйста, попробуйте снова через некоторое время.`;
    }
}

export default new SummaryService();
