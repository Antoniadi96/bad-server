import { CookieOptions } from 'express'
import ms from 'ms'

// Базовые конфигурации
export const PORT = process.env.PORT || '3000'
export const DB_ADDRESS = process.env.DB_ADDRESS || 'mongodb://127.0.0.1:27017/weblarek'
export const ORIGIN_ALLOW = process.env.ORIGIN_ALLOW || 'http://localhost:5173'

// Валидация и логирование отсутствующих переменных окружения
const requiredEnvVars = ['DB_ADDRESS', 'JWT_SECRET']
requiredEnvVars.forEach(envVar => {
  if (!process.env[envVar] && process.env.NODE_ENV === 'production') {
    console.warn(`⚠️  Внимание: ${envVar} не установлен, используется значение по умолчанию`)
  }
})

// Секретные ключи (в production должны быть установлены через переменные окружения)
const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-key-change-in-production'
const AUTH_ACCESS_TOKEN_SECRET = process.env.AUTH_ACCESS_TOKEN_SECRET || 'access-token-secret-dev'
const AUTH_REFRESH_TOKEN_SECRET = process.env.AUTH_REFRESH_TOKEN_SECRET || 'refresh-token-secret-dev'

// Токены доступа
export const ACCESS_TOKEN = {
    secret: AUTH_ACCESS_TOKEN_SECRET,
    expiry: process.env.AUTH_ACCESS_TOKEN_EXPIRY || '15m', // Короткое время жизни
}

// Refresh токены
export const REFRESH_TOKEN = {
    secret: AUTH_REFRESH_TOKEN_SECRET,
    expiry: process.env.AUTH_REFRESH_TOKEN_EXPIRY || '7d',
    cookie: {
        name: 'refreshToken',
        options: {
            httpOnly: true, // Недоступен через JavaScript
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            secure: process.env.NODE_ENV === 'production', // Только HTTPS в production
            maxAge: ms(process.env.AUTH_REFRESH_TOKEN_EXPIRY || '7d'),
            path: '/',
            domain: process.env.NODE_ENV === 'production' ? 'yourdomain.com' : undefined,
        } as CookieOptions,
    },
}

// CSRF настройки
export const CSRF_CONFIG = {
    cookie: {
        key: '_csrf',
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        maxAge: 3600 // 1 час
    }
}

// Rate limiting настройки
export const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов с одного IP
    message: 'Слишком много запросов. Попробуйте позже.'
}

// Экспорт JWT секрета для использования в других местах
export { JWT_SECRET }