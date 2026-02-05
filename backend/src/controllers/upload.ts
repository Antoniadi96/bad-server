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
        return next(new BadRequestError('Файл не загружен'))
    }
    
    try {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        const fileMimeType = mime.lookup(req.file.originalname) || req.file.mimetype
        
        if (!fileMimeType || !allowedMimeTypes.includes(fileMimeType.toString())) {
            return next(new BadRequestError('Недопустимый тип файла. Разрешены только изображения (JPEG, PNG, GIF, WebP)'))
        }
        
        // Проверка расширения файла по оригинальному имени
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        const fileExtension = path.extname(req.file.originalname).toLowerCase()
        if (!allowedExtensions.includes(fileExtension)) {
            return next(new BadRequestError('Недопустимое расширение файла'))
        }
        
        // Проверка размера файла
        const maxFileSize = 5 * 1024 * 1024 // 5MB
        const minFileSize = 2 * 1024 // 2KB
        
        if (req.file.size < minFileSize) {
            return next(new BadRequestError('Файл слишком маленький. Минимальный размер: 2KB'))
        }
        
        if (req.file.size > maxFileSize) {
            return next(new BadRequestError('Файл слишком большой. Максимальный размер: 5MB'))
        }
        
        // Используем сохраненное имя файла, а не оригинальное
        const safeFileName = req.file.filename
        
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

export default {}