const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

// PostgreSQL Connection (Render DATABASE_URL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Auto-initialize database tables if not existing
async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.log('Aviso: DATABASE_URL não definida. O modo base de dados está em espera.');
        return;
    }
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                firebase_uid VARCHAR(128) UNIQUE NOT NULL,
                email VARCHAR(255),
                display_name VARCHAR(100) DEFAULT 'Leonor',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(128),
                subject_id VARCHAR(50) NOT NULL,
                sender VARCHAR(20) NOT NULL,
                message TEXT NOT NULL,
                mode VARCHAR(30) NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS quiz_results (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(128),
                subject_id VARCHAR(50) NOT NULL,
                score INT NOT NULL,
                total_questions INT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✅ Base de dados PostgreSQL inicializada com sucesso!');
    } catch (err) {
        console.error('Erro ao verificar/criar tabelas na base de dados:', err);
    }
}
initDatabase();

// Initialize Gemini AI API
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Load curriculum knowledge base for a subject
function getSubjectKnowledge(subjectId) {
    try {
        const filePath = path.join(__dirname, 'knowledge', `${subjectId}.txt`);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (e) {
        console.error('Erro ao carregar conhecimento da disciplina:', e);
    }
    return "Conteúdos curriculares gerais do 7.º ano em Portugal (Aprendizagens Essenciais).";
}

// Health check endpoint for Render
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Tutor 7.º Ano API (Render)',
        curriculum: 'Aprendizagens Essenciais - Portugal',
        student: 'Leonor'
    });
});

// Chat Endpoint with RAG / Curriculum Context
app.post('/api/chat', async (req, res) => {
    try {
        const { userId = 'leonor_default', subjectName, subjectId = 'matematica', mode, message, history = [], imageBase64 } = req.body;

        if (!message && !imageBase64) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios em falta (message ou imageBase64).' });
        }

        const curriculumContent = getSubjectKnowledge(subjectId);

        if (!geminiApiKey) {
            return res.json({
                reply: `Olá, Leonor! Como a chave da API Gemini não está configurada no servidor do Render, estou em modo de apoio inteligente para ${subjectName} 🌟\n\n` +
                       `Base curricular carregada (${subjectName}). Vamos pensar passo a passo sobre esta questão de ${mode}: qual é o primeiro dado que o enunciado te dá?`
            });
        }

        // System prompt incorporating 7th grade Portugal curriculum (Aprendizagens Essenciais) & PDF/Text Knowledge Base
        const systemInstruction = `
            És o "Tutor 7.º Ano", um assistente pedagógico amigável, empático, encorajador e dinâmico, criado para ajudar a Leonor (uma estudante de 12 anos a frequentar o 7.º ano em Portugal) a estudar, seguindo estritamente as Aprendizagens Essenciais (AE) e os manuais escolares portugueses.
            
            DISCIPLINA ATUAL: ${subjectName} (${subjectId})
            MODO ATIVO: ${mode} (pode ser "explicador", "tpc" ou "quiz").

            PROGRAMA / CONTEÚDOS CURRICULARES DESTA DISCIPLINA (BASE DE CONHECIMENTO):
            ${curriculumContent}

            REGRAS OBRIGATÓRIAS:
            1. Utiliza EXCLUSIVAMENTE Português de Portugal (PT-PT) correto e natural.
            2. Continuidade de Conversa: Analisa SEMPRE o histórico da conversa. Lembra-te exatamente do exercício, problema ou tema que estavam a debater nas mensagens anteriores. Se a aluna der um número ou uma resposta, assume que é a resposta à pergunta que lhe fizeste no passo anterior, mantendo a linha de raciocínio sem nunca perguntar do nada "porque deste esse número?".
            3. Método Socrático: NUNCA dês a resposta direta. Orienta o raciocínio passo a passo com perguntas simples e calorosas.
            4. Formatação Limpa (Sem símbolos LaTeX ou códigos estranhos): NUNCA uses símbolos de formatação LaTeX (como \\frac, \\int, \\sum, $$, ou barras invertidas \\). Escreve expressões matemáticas em texto simples e legível (ex: escreve frações como "1/2" ou "um meio", multiplicações como "x" ou "*"), adequado para leitura fácil num telemóvel por uma jovem de 12 anos.
            5. Celebra o progresso com entusiasmo, emojis (✨, 📚, 💡) e reforço positivo.
        `;

        // Format history for chat
        const chatHistory = history.map(h => ({
            role: h.sender === 'student' ? 'user' : 'model',
            parts: [{ text: h.message }]
        }));

        let userContent = message || "Podes analisar este exercício?";
        if (imageBase64) {
            userContent = [
                message || "Podes analisar este exercício?",
                {
                    inlineData: {
                        data: imageBase64,
                        mimeType: 'image/jpeg'
                    }
                }
            ];
        }

        let responseText;
        try {
            // Tentativa 1: gemini-3.5-flash-lite (Modelo super leve, rápido e com ótimas quotas estáveis)
            const model = genAI.getGenerativeModel({
                model: 'gemini-3.5-flash-lite',
                systemInstruction: systemInstruction
            });
            const chat = model.startChat({ history: chatHistory });
            const result = await chat.sendMessage(userContent);
            responseText = result.response.text();
        } catch (err1) {
            console.warn('⚠️ gemini-3.5-flash-lite indisponível ou quota excedida. A tentar gemini-3.5-flash...', err1.message);
            try {
                // Tentativa 2: gemini-3.5-flash
                const model35 = genAI.getGenerativeModel({
                    model: 'gemini-3.5-flash',
                    systemInstruction: systemInstruction
                });
                const chat35 = model35.startChat({ history: chatHistory });
                const result35 = await chat35.sendMessage(userContent);
                responseText = result35.response.text();
            } catch (err2) {
                console.error('❌ Ambos os modelos falharam devido a limites de quota:', err2.message);
                
                // Fallback amigável e pedagógico para a Leonor nunca ver uma mensagem de erro crua
                responseText = `Olá, Leonor! O nosso servidor de inteligência artificial está temporariamente a descansar devido a um limite de tráfego (limite de quota diária atingido) 🌟\n\n` +
                               `But não te preocupes! Eu continuo aqui para te apoiar em **${subjectName}** (${mode}).\n` +
                               `Como estamos a analisar esta questão de forma autónoma, diz-me:\n` +
                               `1. Qual é o problema ou exercício de ${subjectName} que estás a tentar resolver?\n` +
                               `2. Que dados é que o enunciado já te dá?\n\n` +
                               `Escreve a tua ideia aqui e vamos decifrar este enigma passo a passo! 💪✨`;
            }
        }

        const storedMessage = imageBase64 ? (message ? `${message} 📸 [Foto anexada]` : '📸 [Foto do exercício anexada]') : message;

        // Save message to PostgreSQL
        await pool.query(
            'INSERT INTO chat_messages (user_id, subject_id, sender, message, mode) VALUES ($1, $2, $3, $4, $5)',
            [userId, subjectId || 'geral', 'student', storedMessage, mode]
        );
        await pool.query(
            'INSERT INTO chat_messages (user_id, subject_id, sender, message, mode) VALUES ($1, $2, $3, $4, $5)',
            [userId, subjectId || 'geral', 'tutor', responseText, mode]
        );

        res.json({ reply: responseText });
    } catch (error) {
        console.error('Erro na API de Chat:', error);
        res.status(500).json({
            error: 'Erro interno ao processar a resposta da IA.',
            reply: 'Olá, Leonor! Tivemos um pequeno soluço a comunicar com os servidores da IA. Podes repetir a tua dúvida? 💡'
        });
    }
});

// Save Quiz Result Endpoint
app.post('/api/quiz/result', async (req, res) => {
    try {
        const { userId = 'leonor_default', subjectId, score, totalQuestions } = req.body;
        await pool.query(
            'INSERT INTO quiz_results (user_id, subject_id, score, total_questions) VALUES ($1, $2, $3, $4)',
            [userId, subjectId, score, totalQuestions]
        );
        res.json({ success: true, message: 'Resultado guardado com sucesso!' });
    } catch (error) {
        console.error('Erro ao guardar resultado de quiz:', error);
        res.status(500).json({ error: 'Erro ao guardar resultado.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor do Tutor 7.º Ano a correr na porta ${PORT}`);
});
