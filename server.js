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

// Inicialização automática das tabelas na Base de Dados
async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        console.log('DATABASE_URL não definida.');
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
        console.log('✅ Base de dados PostgreSQL inicializada com sucesso (tabelas criadas)!');
    } catch (err) {
        console.error('Erro ao verificar tabelas:', err);
    }
}
initDatabase();

// Initialize Gemini AI API
const geminiApiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(geminiApiKey);

// Carregar programa oficial do 7.º ano
function getSubjectKnowledge(subjectId) {
    try {
        const filePath = path.join(__dirname, 'knowledge', `${subjectId}.txt`);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (e) {
        console.error('Erro ao carregar conhecimento:', e);
    }
    return "Conteúdos curriculares gerais do 7.º ano em Portugal (Aprendizagens Essenciais).";
}

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'Tutor 7.º Ano API (Render)',
        curriculum: 'Aprendizagens Essenciais - Portugal',
        student: 'Leonor'
    });
});

app.post('/api/chat', async (req, res) => {
    try {
        const { userId = 'leonor_default', subjectName, subjectId = 'matematica', mode, message, history = [] } = req.body;

        if (!message || !subjectName) {
            return res.status(400).json({ error: 'Parâmetros em falta.' });
        }

        const curriculumContent = getSubjectKnowledge(subjectId);

        if (!geminiApiKey) {
            return res.json({
                reply: `Olá, Leonor! Como a chave da API Gemini não está configurada no servidor, estou em modo de apoio inteligente para ${subjectName} 🌟\n\n` +
                       `Vamos pensar passo a passo sobre esta questão de ${mode}: qual é o primeiro dado que o problema te dá?`
            });
        }

        const systemInstruction = `
            És o "Tutor 7.º Ano", um assistente pedagógico amigável, encorajador e dinâmico, criado para ajudar a Leonor (estudante de 12 anos no 7.º ano em Portugal) a estudar, seguindo as Aprendizagens Essenciais (AE).
            DISCIPLINA: ${subjectName} (${subjectId}) | MODO: ${mode}.
            PROGRAMA DESTA DISCIPLINA:
            ${curriculumContent}

            REGRAS OBRIGATÓRIAS:
            1. Português de Portugal (PT-PT) exclusivo.
            2. Método Socrático: NUNCA dês a resposta direta. Explica os conceitos e faz perguntas passo a passo para guiar o raciocínio da Leonor.
            3. Reforço positivo, emojis (✨, 📚, 💡) e explicações claras.
        `;

        const model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash',
            systemInstruction: systemInstruction
        });

        const chatHistory = history.map(h => ({
            role: h.sender === 'student' ? 'user' : 'model',
            parts: [{ text: h.message }]
        }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(message);
        const responseText = result.response.text();

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
            reply: 'Olá, Leonor! Tivemos um pequeno soluço a comunicar com os servidores da IA. Podes repetir a tua dúvida? 💡'
        });
    }
});

app.post('/api/quiz/result', async (req, res) => {
    try {
        const { userId = 'leonor_default', subjectId, score, totalQuestions } = req.body;
        await pool.query(
            'INSERT INTO quiz_results (user_id, subject_id, score, total_questions) VALUES ($1, $2, $3, $4)',
            [userId, subjectId, score, totalQuestions]
        );
        res.json({ success: true, message: 'Resultado guardado com sucesso!' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao guardar resultado.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor do Tutor 7.º Ano a correr na porta ${PORT}`);
});
