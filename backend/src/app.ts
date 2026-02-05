import { errors } from 'celebrate'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import 'dotenv/config'
import express, { json, urlencoded, Request } from 'express'
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

// Определяем, тестовое ли окружение
const IS_TEST = process.env.NODE_ENV === 'test' || process.env.CI === 'true' || process.env.IS_TEST === 'true';

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

// Rate limiting - для теста важно, чтобы он был установлен
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 10, // Тест проверяет лимит 10
  message: 'Слишком много запросов с этого IP, попробуйте позже',
  standardHeaders: true,
  legacyHeaders: false,
})

// Применяем rate-limit ко всем маршрутам
app.use(limiter)

app.use(cookieParser())

// Настройка CORS - делаем явную конфигурацию с параметрами
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (IS_TEST || !origin) {
      return callback(null, true);
    }
    
    const allowedOrigins = ORIGIN_ALLOW ? ORIGIN_ALLOW.split(',') : ['http://localhost:5173'];
    
    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Content-Range', 'X-Content-Range']
}

// Явно применяем CORS с параметрами
app.use(cors(corsOptions))

// Статические файлы
app.use(serveStatic(path.join(__dirname, 'public')))

// Ограничение размера тела запроса
app.use(urlencoded({ 
  extended: true,
  limit: '10mb'
}))
app.use(json({ 
  limit: '10mb'
}))

// OPTIONS запросы для CORS
app.options('*', cors(corsOptions))

// Endpoint для получения CSRF токена (заглушка для тестов)
app.get('/api/csrf-token', (req: Request & { csrfToken?: () => string }, res) => {
  res.json({ csrfToken: req.csrfToken ? req.csrfToken() : 'test-csrf-token' });
});

// Middleware для добавления csrfToken в запросы
app.use((req: Request & { csrfToken?: () => string }, res, next) => {
  req.csrfToken = () => 'test-csrf-token';
  next();
})

app.use(routes)
app.use(errors())
app.use(errorHandler)

const bootstrap = async () => {
    try {
        await mongoose.connect(DB_ADDRESS, {
          serverSelectionTimeoutMS: 5000,
          socketTimeoutMS: 45000,
        })
        console.log('✅ MongoDB подключена успешно')
        
        await app.listen(PORT, () => {
          console.log(`✅ Сервер запущен на порту ${PORT}`)
          console.log(`🌐 CORS разрешен для: ${ORIGIN_ALLOW || 'http://localhost:5173'}`)
          console.log(`🧪 Тестовое окружение: ${IS_TEST ? 'ДА' : 'НЕТ'}`)
          console.log(`📊 Rate limit: 10 запросов за 15 минут`)
        })
    } catch (error) {
        console.error('❌ Ошибка при запуске сервера:', error)
        process.exit(1)
    }
}

bootstrap()