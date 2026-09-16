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
        const { userId = 'leonor_default', subjectName, subjectId = 'matematica', mode, message, history = [] } = req.body;

        if (!message || !subjectName) {
            return res.status(400).json({ error: 'Parâmetros obrigatórios em falta (message, subjectName).' });
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
            1. Utiliza EXCLUSIVAMENTE Português de Portugal (PT-PT) correto (ex: "trabalhos de casa", "fichas", "matéria", "professores", "teste").
            2. Método Socrático: NUNCA dês a resposta direta a exercícios ou trabalhos de casa. Explica os conceitos usando analogias do dia a dia e faz perguntas de acompanhamento passo a passo para orientar o raciocínio da Leonor, baseando-te nos tópicos curriculares acima.
            3. Celebra o progresso com entusiasmo e reforço positivo quando ela demonstrar entendimento.
            4. Sê claro, caloroso, motivador e usa formatação simples com emojis (✨, 📚, 💡) para tornar a explicação cativante.
        `;

        const model = genAI.getGenerativeModel({
            model: 'gemini-2.5-flash',
            systemInstruction: systemInstruction
        });

        // Format history for chat
        const chatHistory = history.map(h => ({
            role: h.sender === 'student' ? 'user' : 'model',
            parts: [{ text: h.message }]
        }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

        // Save message to PostgreSQL
        await pool.query(
            'INSERT INTO chat_messages (user_id, subject_id, sender, message, mode) VALUES ($1, $2, $3, $4, $5)',
            [userId, subjectId || 'geral', 'student', message, mode]
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
