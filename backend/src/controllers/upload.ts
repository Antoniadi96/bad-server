import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import path from 'path'
import mime from 'mime-types'
import fs from 'fs'
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
        // Проверка MIME типа
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        const fileMimeType = mime.lookup(req.file.originalname) || req.file.mimetype
        
        if (!fileMimeType || !allowedMimeTypes.includes(fileMimeType.toString())) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ error: 'Недопустимый тип файла' })
        }
        
        // Проверка размера файла - МИНИМУМ 2KB, МАКСИМУМ 10MB
        const maxFileSize = 10 * 1024 * 1024 // 10MB
        const minFileSize = 2 * 1024 // 2KB
        
        if (req.file.size < minFileSize) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ error: 'Файл слишком маленький. Минимум 2KB' })
        }
        
        if (req.file.size > maxFileSize) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ error: 'Файл слишком большой. Максимум 10MB' })
        }
        
        // Проверка, что имя файла отличается от оригинального
        const safeFileName = req.file.filename
        const originalName = path.basename(req.file.originalname)
        
        if (safeFileName === originalName) {
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path)
            }
            return res.status(400).json({ error: 'Имя файла должно быть изменено' })
        }
        
        const fileName = process.env.UPLOAD_PATH
            ? `/${process.env.UPLOAD_PATH}/${safeFileName}`
            : `/${safeFileName}`
            
        return res.status(201).json({
            fileName,
            originalName,
            size: req.file.size,
            mimetype: fileMimeType,
        })
    } catch (error) {
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path)
        }
        return next(error)
    }
}