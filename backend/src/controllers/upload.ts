import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import path from 'path'
import mime from 'mime-types'
import BadRequestError from '../errors/bad-request-error'
import fs from 'fs'

export const uploadFile = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Файл не загружен' });
    }
    
    try {
        // Проверка MIME типа
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        const fileMimeType = mime.lookup(req.file.originalname) || req.file.mimetype
        
        if (!fileMimeType || !allowedMimeTypes.includes(fileMimeType.toString())) {
            // Удаляем файл при ошибке
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Недопустимый тип файла' })
        }
        
        // Проверка расширения
        const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        const fileExtension = path.extname(req.file.originalname).toLowerCase()
        if (!allowedExtensions.includes(fileExtension)) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Недопустимое расширение файла' })
        }
        
        // Проверка размера файла - МИНИМУМ 2KB, МАКСИМУМ 5MB
        const maxFileSize = 5 * 1024 * 1024 // 5MB
        const minFileSize = 2 * 1024 // 2KB
        
        if (req.file.size < minFileSize) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Файл слишком маленький. Минимум 2KB' })
        }
        
        if (req.file.size > maxFileSize) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Файл слишком большой. Максимум 5MB' })
        }
        
        // Проверка, что имя файла отличается от оригинального
        const safeFileName = req.file.filename;
        const originalName = path.basename(req.file.originalname);
        
        if (safeFileName === originalName) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Имя файла должно быть изменено' })
        }
        
        // Проверка, что файл действительно изображение
        if (!req.file.mimetype.startsWith('image/')) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Файл должен быть изображением' })
        }
        
        const fileName = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${safeFileName}`
            : `/${safeFileName}`
            
        return res.status(201).send({
            fileName,
            originalName: originalName,
            size: req.file.size,
            mimetype: fileMimeType,
        })
    } catch (error) {
        // Удаляем файл при любой ошибке
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        return next(error)
    }
}