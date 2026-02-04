import { NextFunction, Request, Response } from 'express'
import { FilterQuery, Error as MongooseError, Types } from 'mongoose'
import escapeStringRegexp from 'escape-string-regexp'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import Order, { IOrder } from '../models/order'
import Product, { IProduct } from '../models/product'
import User from '../models/user'

// GET /orders?page=2&limit=5&sort=totalAmount&order=desc&orderDateFrom=2024-07-01&orderDateTo=2024-08-01&status=delivering&totalAmountFrom=100&totalAmountTo=1000&search=%2B1
export const getOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
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

        // Валидация параметров
        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10))
        
        const filters: FilterQuery<Partial<IOrder>> = {}

        if (status) {
            // Валидация статуса - разрешаем только определенные значения
            const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
            if (typeof status === 'string' && allowedStatuses.includes(status)) {
                filters.status = status
            }
        }

        // Валидация числовых диапазонов
        if (totalAmountFrom) {
            const amount = Number(totalAmountFrom)
            if (!isNaN(amount)) {
                filters.totalAmount = {
                    ...filters.totalAmount,
                    $gte: Math.max(0, amount),
                }
            }
        }

        if (totalAmountTo) {
            const amount = Number(totalAmountTo)
            if (!isNaN(amount)) {
                filters.totalAmount = {
                    ...filters.totalAmount,
                    $lte: Math.max(0, amount),
                }
            }
        }

        // Валидация дат
        if (orderDateFrom) {
            const date = new Date(orderDateFrom as string)
            if (!isNaN(date.getTime())) {
                filters.createdAt = {
                    ...filters.createdAt,
                    $gte: date,
                }
            }
        }

        if (orderDateTo) {
            const date = new Date(orderDateTo as string)
            if (!isNaN(date.getTime())) {
                filters.createdAt = {
                    ...filters.createdAt,
                    $lte: date,
                }
            }
        }

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
            { $unwind: '$products' },
        ]

        if (search) {
            // Защита от ReDoS
            const safeSearch = escapeStringRegexp(search as string)
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            const searchRegex = new RegExp(safeSearch, 'i')
            const searchNumber = Number(search)

            const searchConditions: any[] = [{ 'products.title': searchRegex }]

            if (!Number.isNaN(searchNumber)) {
                searchConditions.push({ orderNumber: searchNumber })
            }

            aggregatePipeline.push({
                $match: {
                    $or: searchConditions,
                },
            })

            filters.$or = searchConditions
        }

        const sort: { [key: string]: any } = {}

        // Безопасная сортировка
        const allowedSortFields = ['createdAt', 'totalAmount', 'orderNumber']
        if (sortField && allowedSortFields.includes(sortField as string) && sortOrder) {
            sort[sortField as string] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1
        }

        aggregatePipeline.push(
            { $sort: sort },
            { $skip: (pageNum - 1) * limitNum },
            { $limit: limitNum },
            {
                $group: {
                    _id: '$_id',
                    orderNumber: { $first: '$orderNumber' },
                    status: { $first: '$status' },
                    totalAmount: { $first: '$totalAmount' },
                    products: { $push: '$products' },
                    customer: { $first: '$customer' },
                    createdAt: { $first: '$createdAt' },
                },
            }
        )

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
        
        // Валидация параметров
        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 5))
        
        const options = {
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }

        const user = await User.findById(userId)
            .populate({
                path: 'orders',
                populate: [
                    {
                        path: 'products',
                    },
                    {
                        path: 'customer',
                    },
                ],
            })
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )

        let orders = user.orders as unknown as IOrder[]

        if (search) {
            // Защита от ReDoS
            const safeSearch = escapeStringRegexp(search as string)
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            const searchRegex = new RegExp(safeSearch, 'i')
            const searchNumber = Number(search)
            const products = await Product.find({ title: searchRegex })
            const productIds = products.map((product) => product._id)

            orders = orders.filter((order) => {
                const matchesProductTitle = order.products.some((product) =>
                    productIds.some((id) => id.equals(product._id))
                )
                const matchesOrderNumber =
                    !Number.isNaN(searchNumber) &&
                    order.orderNumber === searchNumber

                return matchesOrderNumber || matchesProductTitle
            })
        }

        const totalOrders = orders.length
        const totalPages = Math.ceil(totalOrders / limitNum)

        orders = orders.slice(options.skip, options.skip + options.limit)

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
        // Валидация номера заказа
        const orderNumber = parseInt(req.params.orderNumber)
        if (isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const order = await Order.findOne({
            orderNumber: orderNumber,
        })
            .populate(['customer', 'products'])
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
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
        // Валидация номера заказа
        const orderNumber = parseInt(req.params.orderNumber)
        if (isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const order = await Order.findOne({
            orderNumber: orderNumber,
        })
            .populate(['customer', 'products'])
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
        if (!order.customer._id.equals(userId)) {
            // Для безопасности всегда возвращаем 404
            return next(
                new NotFoundError('Заказ по заданному id отсутствует в базе')
            )
        }
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

        // Валидация входных данных
        if (!address || !payment || !phone || !email || !items || !Array.isArray(items)) {
            throw new BadRequestError('Не все обязательные поля заполнены')
        }

        // Валидация email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            throw new BadRequestError('Некорректный email')
        }

        // Валидация телефона
        const phoneRegex = /^\+?[1-9]\d{1,14}$/
        if (!phoneRegex.test(phone.replace(/\s/g, ''))) {
            throw new BadRequestError('Некорректный номер телефона')
        }

        // Ограничение количества товаров в заказе
        if (items.length > 20) {
            throw new BadRequestError('Слишком много товаров в заказе')
        }

        // Получаем товары по одному ID для безопасности
        const productIds = items.map(id => new Types.ObjectId(id))
        const products = await Product.find({ _id: { $in: productIds } })

        // Проверяем, что все товары найдены
        if (products.length !== items.length) {
            throw new BadRequestError('Некоторые товары не найдены')
        }

        products.forEach((product) => {
            if (product.price === null) {
                throw new BadRequestError(`Товар "${product.title}" не продается`)
            }
            basket.push(product)
        })
        
        // Всегда рассчитываем сумму на сервере
        const total = basket.reduce((a, c) => a + c.price, 0)

        const newOrder = new Order({
            totalAmount: total,
            products: items,
            payment,
            phone,
            email,
            comment: comment ? comment.substring(0, 500) : '', // Ограничение длины комментария
            customer: userId,
            deliveryAddress: address.substring(0, 200), // Ограничение длины адреса
        })
        const populateOrder = await newOrder.populate(['customer', 'products'])
        await populateOrder.save()

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
        
        // Валидация статуса
        const allowedStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
        if (!allowedStatuses.includes(status)) {
            return next(new BadRequestError('Некорректный статус заказа'))
        }
        
        // Валидация номера заказа
        const orderNumber = parseInt(req.params.orderNumber)
        if (isNaN(orderNumber) || orderNumber <= 0) {
            return next(new BadRequestError('Некорректный номер заказа'))
        }
        
        const updatedOrder = await Order.findOneAndUpdate(
            { orderNumber: orderNumber },
            { status },
            { new: true, runValidators: true }
        )
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .populate(['customer', 'products'])
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
        // Валидация ID
        if (!Types.ObjectId.isValid(req.params.id)) {
            return next(new BadRequestError('Некорректный ID заказа'))
        }
        
        const deletedOrder = await Order.findByIdAndDelete(req.params.id)
            .orFail(
                () =>
                    new NotFoundError(
                        'Заказ по заданному id отсутствует в базе'
                    )
            )
            .populate(['customer', 'products'])
        return res.status(200).json(deletedOrder)
    } catch (error) {
        if (error instanceof MongooseError.CastError) {
            return next(new BadRequestError('Передан не валидный ID заказа'))
        }
        return next(error)
    }
}