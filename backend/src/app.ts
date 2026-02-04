import { errors } from 'celebrate'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import csurf from 'csurf'
import 'dotenv/config'
import express, { json, urlencoded } from 'express'
import helmet from 'helmet'
import mongoose from 'mongoose'
import path from 'path'
import rateLimit from 'express-rate-limit'
import { DB_ADDRESS, ORIGIN_ALLOW } from './config'
import errorHandler from './middlewares/error-handler'
import serveStatic from './middlewares/serverStatic'
import routes from './routes'


const { PORT = 3000 } = process.env
const app = express()

// Настройки безопасности Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}))

// Rate limiting для защиты от DDoS
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 5, // максимум 5 запросов с одного IP (для теста)
  message: 'Слишком много запросов с этого IP, попробуйте позже',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter)

app.use(cookieParser())

// Защита от CSRF (исключая GET, HEAD, OPTIONS запросы)
const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  }
})

app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Настройка CORS с ограничениями
const corsOptions = {
  origin: process.env.ORIGIN_ALLOW || 'http://localhost:5173',
  credentials: true,
  optionsSuccessStatus: 200,
}

app.use(cors(corsOptions))

// Статические файлы с ограничениями
app.use(serveStatic(path.join(__dirname, 'public')))

// Ограничение размера тела запроса для защиты от переполнения
app.use(urlencoded({ 
  extended: true,
  limit: '10mb' // Ограничение 10MB
}))
app.use(json({ 
  limit: '10mb' // Ограничение 10MB
}))

// OPTIONS запросы для CORS
app.options('*', cors(corsOptions))

// CSRF middleware для всех POST, PUT, DELETE запросов
app.use((req, res, next) => {
  // Исключаем auth endpoints из CSRF защиты
  if (req.path.startsWith('/auth/')) {
    return next();
  }
  
  // Для остальных POST/PUT/DELETE применяем CSRF
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    csrfProtection(req, res, next);
  } else {
    next();
  }
})

app.use(routes)
app.use(errors())
app.use(errorHandler)

const bootstrap = async () => {
    try {
        // Подключение к MongoDB с обработкой ошибок
        await mongoose.connect(DB_ADDRESS, {
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        })
        console.log('✅ MongoDB подключена успешно')
        
        await app.listen(PORT, () => {
          console.log(`✅ Сервер запущен на порту ${PORT}`)
          console.log(`🌐 CORS разрешен для: ${ORIGIN_ALLOW}`)
        })
    } catch (error) {
        console.error('❌ Ошибка при запуске сервера:', error)
        process.exit(1)
    }
}

bootstrap()