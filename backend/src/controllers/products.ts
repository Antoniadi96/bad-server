import { NextFunction, Request, Response } from 'express'
import { constants } from 'http2'
import { Error as MongooseError } from 'mongoose'
import { join, basename, normalize } from 'path'
import validator from 'validator'
import BadRequestError from '../errors/bad-request-error'
import ConflictError from '../errors/conflict-error'
import NotFoundError from '../errors/not-found-error'
import UnauthorizedError from '../errors/unauthorized-error'
import Product from '../models/product'
import movingFile from '../utils/movingFile'

// Guard для администраторов
const adminGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
        return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
    }
    next()
}

// Безопасная функция для перемещения файлов
const safeMovingFile = (fileName: string, sourceDir: string, destDir: string) => {
    // Защита от Path Traversal: берем только имя файла
    const safeFileName = basename(fileName)
    
    // Нормализуем пути и проверяем, что они остаются в пределах разрешенных директорий
    const sourcePath = normalize(join(sourceDir, safeFileName))
    const destPath = normalize(join(destDir, safeFileName))
    
    const normalizedSourceDir = normalize(sourceDir)
    const normalizedDestDir = normalize(destDir)
    
    // Проверяем, что результирующий путь не выходит за пределы исходной директории
    if (!sourcePath.startsWith(normalizedSourceDir) || !destPath.startsWith(normalizedDestDir)) {
        throw new Error('Недопустимый путь к файлу')
    }
    
    return movingFile(safeFileName, sourceDir, destDir)
}

// GET /product
const getProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { page = 1, limit = 5 } = req.query
        
        // Валидация параметров пагинации
        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 5))
        
        const options = {
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }
        const products = await Product.find({}, null, options)
        const totalProducts = await Product.countDocuments({})
        const totalPages = Math.ceil(totalProducts / limitNum)
        return res.send({
            items: products,
            pagination: {
                totalProducts,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (err) {
        return next(err)
    }
}

// POST /product
const createProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        adminGuard(req, res, () => {})
        
        const { description, category, price, title, image } = req.body

        // Валидация обязательных полей
        if (!title || !category) {
            throw new BadRequestError('Название и категория обязательны')
        }

        // Валидация и санитизация строк
        const sanitizedTitle = validator.escape(title).trim().substring(0, 200)
        const sanitizedCategory = validator.escape(category).trim().substring(0, 50)
        const sanitizedDescription = description ? 
            validator.escape(description).trim().substring(0, 1000) : ''

        // Валидация цены
        const validatedPrice = price !== undefined && price !== null ? 
            Math.max(0, parseFloat(price)) : null

        // Переносим картинку из временной папки
        if (image && image.fileName) {
            safeMovingFile(
                image.fileName,
                join(__dirname, `../public/${process.env.UPLOAD_PATH_TEMP}`),
                join(__dirname, `../public/${process.env.UPLOAD_PATH}`)
            )
        }

        const product = await Product.create({
            description: sanitizedDescription,
            image,
            category: sanitizedCategory,
            price: validatedPrice,
            title: sanitizedTitle,
        })
        return res.status(constants.HTTP_STATUS_CREATED).send(product)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof Error && error.message.includes('E11000')) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// PUT /product
const updateProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        adminGuard(req, res, () => {})
        
        const { productId } = req.params
        const { image } = req.body

        // Валидация ID
        if (!validator.isMongoId(productId)) {
            return next(new BadRequestError('Некорректный ID товара'))
        }

        // Подготавливаем данные для обновления
        const updateData: any = {}
        
        // Санитизация полей
        if (req.body.title !== undefined) {
            updateData.title = validator.escape(req.body.title).trim().substring(0, 200)
        }
        if (req.body.category !== undefined) {
            updateData.category = validator.escape(req.body.category).trim().substring(0, 50)
        }
        if (req.body.description !== undefined) {
            updateData.description = validator.escape(req.body.description).trim().substring(0, 1000)
        }
        if (req.body.price !== undefined) {
            updateData.price = req.body.price !== null ? 
                Math.max(0, parseFloat(req.body.price)) : null
        }

        // Переносим картинку из временной папки
        if (image && image.fileName) {
            safeMovingFile(
                image.fileName,
                join(__dirname, `../public/${process.env.UPLOAD_PATH_TEMP}`),
                join(__dirname, `../public/${process.env.UPLOAD_PATH}`)
            )
            updateData.image = image
        }

        const product = await Product.findByIdAndUpdate(
            productId,
            { $set: updateData },
            { runValidators: true, new: true }
        ).orFail(() => new NotFoundError('Нет товара по заданному id'))
        return res.send(product)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        if (error instanceof Error && error.message.includes('E11000')) {
            return next(
                new ConflictError('Товар с таким заголовком уже существует')
            )
        }
        return next(error)
    }
}

// DELETE /product
const deleteProduct = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        adminGuard(req, res, () => {})
        
        const { productId } = req.params
        
        // Валидация ID
        if (!validator.isMongoId(productId)) {
            return next(new BadRequestError('Некорректный ID товара'))
        }
        
        const product = await Product.findByIdAndDelete(productId).orFail(
            () => new NotFoundError('Нет товара по заданному id')
        )
        return res.send(product)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID товара'))
        }
        return next(error)
    }
}

export { createProduct, deleteProduct, getProducts, updateProduct }