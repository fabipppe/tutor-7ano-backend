-- PostgreSQL Database Schema para Tutor 7.º Ano (Render)

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
    sender VARCHAR(20) NOT NULL, -- 'student' ou 'tutor'
    message TEXT NOT NULL,
    mode VARCHAR(30) NOT NULL, -- 'explicador', 'tpc', 'quiz'
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
