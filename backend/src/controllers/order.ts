import { NextFunction, Request, Response } from 'express'
import { FilterQuery, Error as MongooseError, Types } from 'mongoose'
import escapeStringRegexp from 'escape-string-regexp'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import Order, { IOrder } from '../models/order'
import Product, { IProduct } from '../models/product'

// GET /orders?page=2&limit=5&sort=totalAmount&order=desc&orderDateFrom=2024-07-01&orderDateTo=2024-08-01&status=delivering&totalAmountFrom=100&totalAmountTo=1000&search=%2B1
// В функции getOrders заменим блок поиска на безопасную агрегацию:
export const getOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка прав администратора - возвращаем 403
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return res.status(403).json({ 
                error: 'Доступ запрещен. Требуются права администратора' 
            });
        }
        
        const {
            page = 1,
            limit = 10,
            sortField = 'createdAt',
            sortOrder = 'desc',
            status,
            totalAmountFrom,
            totalAmountTo,
            orderDateFrom,
            orderDateTo,
            search,
        } = req.query

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        const limitNum = Math.min(10, Math.max(1, parseInt(limit as string, 10) || 10))
        
        const filters: FilterQuery<Partial<IOrder>> = {}

        if (status) {
            const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
            if (typeof status === 'string' && allowedStatuses.includes(status)) {
                filters.status = status
            }
        }

        if (totalAmountFrom) {
            const amount = Number(totalAmountFrom)
            if (!Number.isNaN(amount) && amount >= 0) {
                filters.totalAmount = {
                    ...filters.totalAmount,
                    $gte: amount,
                }
            }
        }

        if (totalAmountTo) {
            const amount = Number(totalAmountTo)
            if (!Number.isNaN(amount) && amount >= 0) {
                filters.totalAmount = {
                    ...filters.totalAmount,
                    $lte: amount,
                }
            }
        }

        if (orderDateFrom) {
            const date = new Date(orderDateFrom as string)
            if (!Number.isNaN(date.getTime())) {
                filters.createdAt = {
                    ...filters.createdAt,
                    $gte: date,
                }
            }
        }

        if (orderDateTo) {
            const date = new Date(orderDateTo as string)
            if (!Number.isNaN(date.getTime())) {
                const endOfDay = new Date(date)
                endOfDay.setHours(23, 59, 59, 999)
                filters.createdAt = {
                    ...filters.createdAt,
                    $lte: endOfDay,
                }
            }
        }

        // ВОССТАНАВЛИВАЕМ АГРЕГАЦИЮ, НО ДЕЛАЕМ ЕЕ БЕЗОПАСНОЙ
        const aggregatePipeline: any[] = [
            { $match: filters },
            {
                $lookup: {
                    from: 'products',
                    localField: 'products',
                    foreignField: '_id',
                    as: 'products',
                },
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'customer',
                    foreignField: '_id',
                    as: 'customer',
                },
            },
            { $unwind: '$customer' },
        ]

        // БЕЗОПАСНАЯ ОБРАБОТКА ПОИСКА - ВЫЗЫВАЕМ ОШИБКУ ПРИ ОПАСНЫХ СИМВОЛАХ
        if (search && typeof search === 'string') {
            const safeSearch = escapeStringRegexp(search)
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            
            // Проверка на опасные символы MongoDB
            const dangerousPatterns = /(\$where|\$eq|\$ne|\$gt|\$gte|\$lt|\$lte|\$in|\$nin|\$or|\$and|\$not|\$nor|\$exists|\$type|\$mod|\$regex|\$text|\$where|\$geoWithin|\$geoIntersects|\$near|\$nearSphere|\$all|\$elemMatch|\$size|\$bitsAllClear|\$bitsAllSet|\$bitsAnyClear|\$bitsAnySet|\$comment|\$meta|\$slice|\$natural)/
            
            if (dangerousPatterns.test(search)) {
                return next(new BadRequestError('Недопустимый поисковый запрос'))
            }
            
            const searchRegex = new RegExp(safeSearch, 'i')
            const searchNumber = Number(search)

            // Создаем безопасные условия поиска
            const searchConditions: any[] = []
            
            // Проверяем, можно ли преобразовать в число (поиск по orderNumber)
            if (!Number.isNaN(searchNumber) && searchNumber > 0) {
                searchConditions.push({ orderNumber: searchNumber })
            }
            
            // Добавляем поиск по названию товара
            searchConditions.push({ 'products.title': searchRegex })
            
            // Добавляем поиск по email клиента
            searchConditions.push({ 'customer.email': searchRegex })
            
            // Добавляем поиск по имени клиента
            searchConditions.push({ 'customer.name': searchRegex })
            
            // Используем $or только если есть условия
            if (searchConditions.length > 0) {
                aggregatePipeline.push({
                    $match: {
                        $or: searchConditions
                    }
                })
            }
        }

        const sort: { [key: string]: any } = {}

        const allowedSortFields = ['createdAt', 'totalAmount', 'orderNumber', 'status']
        if (sortField && allowedSortFields.includes(sortField as string) && sortOrder) {
            sort[sortField as string] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1
        }

        // Добавляем сортировку и пагинацию
        aggregatePipeline.push(
            { $sort: sort },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum }
        )

        try {
            const orders = await Order.aggregate(aggregatePipeline)
            const totalOrders = await Order.countDocuments(filters)
            const totalPages = Math.ceil(totalOrders / limitNum)

            res.status(200).json({
                orders,
                pagination: {
                    totalOrders,
                    totalPages,
                    currentPage: pageNum,
                    pageSize: limitNum,
                },
            })
        } catch (error) {
            // Если произошла ошибка в агрегации (например, из-за инъекции),
            // возвращаем BadRequestError
            return next(new BadRequestError('Некорректный запрос'))
        }
    } catch (error) {
        next(error)
    }
}

export const getOrdersCurrentUser = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const userId = res.locals.user._id
        const { search, page = 1, limit = 5 } = req.query
        
        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        const limitNum = Math.min(10, Math.max(1, parseInt(limit as string, 10) || 5)) // Максимум 10
        
        const filters: FilterQuery<Partial<IOrder>> = { customer: userId }

        if (search && typeof search === 'string') {
            const safeSearch = escapeStringRegexp(search)
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            
            const searchNumber = Number(search)
            if (!Number.isNaN(searchNumber) && searchNumber > 0) {
                filters.orderNumber = searchNumber
            } else {
                const products = await Product.find(
                    { title: new RegExp(safeSearch, 'i') },
                    '_id'
                ).limit(100)
                
                if (products.length > 0) {
                    filters.products = { $in: products.map(p => p._id) }
                } else {
                    filters.products = { $in: [] }
                }
            }
        }

        const orders = await Order.find(filters)
            .populate([
                {
                    path: 'products',
                    select: 'title price image',
                },
                {
                    path: 'customer',
                    select: 'name email',
                    match: { _id: userId }
                },
            ])
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .select('-__v')
            .lean();

        const totalOrders = await Order.countDocuments(filters)
        const totalPages = Math.ceil(totalOrders / limitNum)

        return res.send({
            orders,
            pagination: {
                totalOrders,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (error) {
        next(error)
    }
}

// Get order by ID
export const getOrderByNumber = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const orderNumber = parseInt(req.params.orderNumber, 10)
        if (Number.isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const order = await Order.findOne({
            orderNumber,
        })
            .populate([
                {
                    path: 'customer',
                    select: 'name email phone',
                },
                {
                    path: 'products',
                    select: 'title price image description',
                },
            ])
            .select('-__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .lean();
            
        return res.status(200).json(order)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

export const getOrderCurrentUserByNumber = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const userId = res.locals.user._id
    try {
        const orderNumber = parseInt(req.params.orderNumber, 10)
        if (Number.isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const order = await Order.findOne({
            orderNumber,
            customer: userId
        })
            .populate([
                {
                    path: 'customer',
                    select: 'name email phone',
                },
                {
                    path: 'products',
                    select: 'title price image description',
                },
            ])
            .select('-__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .lean();
            
        return res.status(200).json(order)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

// POST /product
export const createOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const basket: IProduct[] = []
        const userId = res.locals.user._id
        const { address, payment, phone, email, items, comment } = req.body

        if (!address || !payment || !phone || !email || !items || !Array.isArray(items)) {
            throw new BadRequestError('Не все обязательные поля заполнены')
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            throw new BadRequestError('Некорректный email')
        }

        // Упрощенная валидация телефона - только цифры и + в начале
        const phoneRegex = /^[\d\s\-\+\(\)]{10,20}$/
const cleanedPhone = phone.replace(/\s/g, '')
if (!phoneRegex.test(phone) || cleanedPhone.length < 10) {
    throw new BadRequestError('Некорректный номер телефона')
}

        if (items.length > 20) {
            throw new BadRequestError('Слишком много товаров в заказе')
        }

        const productIds = items.map(id => {
            try {
                return new Types.ObjectId(id)
            } catch {
                throw new BadRequestError(`Некорректный ID товара: ${id}`)
            }
        })
        
        const products = await Product.find({ 
            _id: { $in: productIds },
            price: { $ne: null, $gt: 0 }
        })

        if (products.length !== items.length) {
            throw new BadRequestError('Некоторые товары не найдены или не доступны для заказа')
        }

        products.forEach((product) => {
            basket.push(product)
        })
        
        const total = basket.reduce((a, c) => a + c.price, 0)

        // Санитизация комментария - удаляем HTML теги
        const sanitizedComment = comment ? 
            comment.substring(0, 500)
                .replace(/<[^>]*>/g, '') // Удаляем HTML теги
                .trim() : '';

        const newOrder = new Order({
            totalAmount: total,
            products: items,
            payment,
            phone: cleanedPhone,
            email,
            comment: sanitizedComment,
            customer: userId,
            deliveryAddress: address.substring(0, 200),
        })
        
        await newOrder.save()

        const populateOrder = await Order.findById(newOrder._id)
            .populate([
                {
                    path: 'customer',
                    select: 'name email',
                },
                {
                    path: 'products',
                    select: 'title price',
                },
            ])
            .select('-__v')
            .lean();

        return res.status(200).json(populateOrder)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        return next(error)
    }
}

// Update an order
export const updateOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { status } = req.body
        
        const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
        if (!allowedStatuses.includes(status)) {
            return next(new BadRequestError('Некорректный статус заказа'))
        }
        
        const orderNumber = parseInt(req.params.orderNumber, 10)
        if (Number.isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const updatedOrder = await Order.findOneAndUpdate(
            { orderNumber },
            { status },
            { new: true, runValidators: true }
        )
            .populate([
                {
                    path: 'customer',
                    select: 'name email',
                },
                {
                    path: 'products',
                    select: 'title price',
                },
            ])
            .select('-__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .lean();
            
        return res.status(200).json(updatedOrder)
    } catch (error) {
        if (error instanceof MongooseError.ValidationError) {
            return next(new BadRequestError(error.message))
        }
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}

// Delete an order
export const deleteOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!Types.ObjectId.isValid(req.params.id)) {
            return next(new BadRequestError('Некорректный ID заказа'))
        }
        
        const deletedOrder = await Order.findByIdAndDelete(req.params.id)
            .populate([
                {
                    path: 'customer',
                    select: 'name email',
                },
                {
                    path: 'products',
                    select: 'title price',
                },
            ])
            .select('-__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .lean();
            
        return res.status(200).json(deletedOrder)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}
