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

// Секретные ключи
export const JWT_SECRET = process.env.JWT_SECRET || 'development-secret-key-change-in-production'
const AUTH_ACCESS_TOKEN_SECRET = process.env.AUTH_ACCESS_TOKEN_SECRET || JWT_SECRET
const AUTH_REFRESH_TOKEN_SECRET = process.env.AUTH_REFRESH_TOKEN_SECRET || JWT_SECRET

// Токены доступа
export const ACCESS_TOKEN = {
    secret: AUTH_ACCESS_TOKEN_SECRET,
    expiry: process.env.AUTH_ACCESS_TOKEN_EXPIRY || '15m',
}

// Refresh токены
export const REFRESH_TOKEN = {
    secret: AUTH_REFRESH_TOKEN_SECRET,
    expiry: process.env.AUTH_REFRESH_TOKEN_EXPIRY || '7d',
    cookie: {
        name: 'refreshToken',
        options: {
            httpOnly: true,
            sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax',
            secure: process.env.NODE_ENV === 'production',
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
        maxAge: 3600
    }
}

// Rate limiting настройки
export const RATE_LIMIT_CONFIG = {
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: 'Слишком много запросов. Попробуйте позже.'
}