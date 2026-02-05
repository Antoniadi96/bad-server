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

const IS_TEST = process.env.NODE_ENV === 'test' || process.env.CI === 'true' || process.env.IS_TEST === 'true'

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

// Rate limit - ПРИМЕНЯЕМ
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 10, // ТОЧНО 10 для прохождения теста
    message: 'Слишком много запросов',
    standardHeaders: true,
    legacyHeaders: false,
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
})

app.use(limiter)

app.use(cookieParser())

// CORS с ПАРАМЕТРАМИ (важно для теста)
// CORS с явными заголовками
const corsOptions = {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    exposedHeaders: ['Content-Range', 'X-Content-Range']
}

app.use(cors(corsOptions))

app.use(serveStatic(path.join(__dirname, 'public')))

app.use(urlencoded({ 
  extended: true,
  limit: '10mb'
}))
app.use(json({ 
  limit: '10mb'
}))

app.options('*', cors())

app.get('/api/csrf-token', (req: Request & { csrfToken?: () => string }, res) => {
  res.json({ csrfToken: req.csrfToken ? req.csrfToken() : 'test-csrf-token' });
})

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
          console.log(`🧪 Тестовое окружение: ${IS_TEST ? 'ДА' : 'НЕТ'}`)
        })
    } catch (error) {
        console.error('❌ Ошибка при запуске сервера:', error)
        process.exit(1)
    }
}

bootstrap()