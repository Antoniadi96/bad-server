import { Request, Express } from 'express'
import multer, { FileFilterCallback } from 'multer'
import { join } from 'path'
import crypto from 'crypto'

type DestinationCallback = (error: Error | null, destination: string) => void
type FileNameCallback = (error: Error | null, filename: string) => void

const storage = multer.diskStorage({
    destination: (
        _req: Request,
        _file: Express.Multer.File,
        cb: DestinationCallback
    ) => {
        const tempPath = process.env.UPLOAD_PATH_TEMP || 'temp'
        cb(
            null,
            join(__dirname, `../public/${tempPath}`)
        )
    },

    filename: (
        _req: Request,
        file: Express.Multer.File,
        cb: FileNameCallback
    ) => {
        // Генерируем уникальное имя файла
        const uniqueSuffix = crypto.randomBytes(16).toString('hex')
        const extension = file.originalname.split('.').pop() || 'png'
        cb(null, `${uniqueSuffix}.${extension}`)
    },
})

const types = [
    'image/png',
    'image/jpg',
    'image/jpeg',
    'image/gif',
    'image/svg+xml',
    'image/webp'
]

const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
) => {
    if (!types.includes(file.mimetype)) {
        // Исправлено: передаем null вместо Error
        return cb(null, false)
    }
    return cb(null, true)
}

const upload = multer({ 
    storage, 
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
    }
})

export default upload