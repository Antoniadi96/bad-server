import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import path from 'path'
import mime from 'mime-types'
import BadRequestError from '../errors/bad-request-error'

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' })
    }
    
    try {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        const fileMimeType = mime.lookup(req.file.originalname) || req.file.mimetype
        
        if (!fileMimeType || !allowedMimeTypes.includes(fileMimeType.toString())) {
            return res.status(400).json({ error: 'Недопустимый тип файла' })
        }
        
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        const fileExtension = path.extname(req.file.originalname).toLowerCase()
        if (!allowedExtensions.includes(fileExtension)) {
            return res.status(400).json({ error: 'Недопустимое расширение файла' })
        }
        
        const maxFileSize = 5 * 1024 * 1024
        const minFileSize = 2 * 1024
        
        if (req.file.size < minFileSize) {
            return res.status(400).json({ error: 'Файл слишком маленький. Минимум 2KB' })
        }
        
        if (req.file.size > maxFileSize) {
            return res.status(400).json({ error: 'Файл слишком большой. Максимум 5MB' })
        }
        
        // Проверяем, что имя файла безопасно (не содержит пути)
        const safeFileName = req.file.filename
        if (safeFileName.includes('/') || safeFileName.includes('\\')) {
            return res.status(400).json({ error: 'Недопустимое имя файла' })
        }
        
        const fileName = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${safeFileName}`
            : `/${safeFileName}`
            
        return res.status(constants.HTTP_STATUS_CREATED).send({
            fileName,
            originalName: path.basename(req.file.originalname),
            size: req.file.size,
            mimetype: fileMimeType,
        })
    } catch (error) {
        return next(error)
    }
}