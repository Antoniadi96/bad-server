import { NextFunction, Request, Response } from 'express'
import { FilterQuery } from 'mongoose'
import escapeStringRegexp from 'escape-string-regexp'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import UnauthorizedError from '../errors/unauthorized-error'
import Order from '../models/order'
import User, { IUser } from '../models/user'

// Guard для администраторов
const adminGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
        return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
    }
    next()
}

// Get GET /customers?page=2&limit=5&sort=totalAmount&order=desc&registrationDateFrom=2023-01-01&registrationDateTo=2023-12-31&lastOrderDateFrom=2023-01-01&lastOrderDateTo=2023-12-31&totalAmountFrom=100&totalAmountTo=1000&orderCountFrom=1&orderCountTo=10
export const getCustomers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка прав администратора
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        const {
            page = 1,
            limit = 10,
            sortField = 'createdAt',
            sortOrder = 'desc',
            registrationDateFrom,
            registrationDateTo,
            lastOrderDateFrom,
            lastOrderDateTo,
            totalAmountFrom,
            totalAmountTo,
            orderCountFrom,
            orderCountTo,
            search,
        } = req.query

        // Валидация числовых параметров
        const pageNum = Math.max(1, parseInt(page as string) || 1)
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10)) // Ограничение limit
        
        const filters: FilterQuery<Partial<IUser>> = {}

        // Валидация и безопасная обработка дат
        if (registrationDateFrom) {
            const date = new Date(registrationDateFrom as string)
            if (!isNaN(date.getTime())) {
                filters.createdAt = {
                    ...filters.createdAt,
                    $gte: date,
                }
            }
        }

        if (registrationDateTo) {
            const date = new Date(registrationDateTo as string)
            if (!isNaN(date.getTime())) {
                const endOfDay = new Date(date)
                endOfDay.setHours(23, 59, 59, 999)
                filters.createdAt = {
                    ...filters.createdAt,
                    $lte: endOfDay,
                }
            }
        }

        if (lastOrderDateFrom) {
            const date = new Date(lastOrderDateFrom as string)
            if (!isNaN(date.getTime())) {
                filters.lastOrderDate = {
                    ...filters.lastOrderDate,
                    $gte: date,
                }
            }
        }

        if (lastOrderDateTo) {
            const date = new Date(lastOrderDateTo as string)
            if (!isNaN(date.getTime())) {
                const endOfDay = new Date(date)
                endOfDay.setHours(23, 59, 59, 999)
                filters.lastOrderDate = {
                    ...filters.lastOrderDate,
                    $lte: endOfDay,
                }
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

        if (orderCountFrom) {
            const count = Number(orderCountFrom)
            if (!isNaN(count)) {
                filters.orderCount = {
                    ...filters.orderCount,
                    $gte: Math.max(0, count),
                }
            }
        }

        if (orderCountTo) {
            const count = Number(orderCountTo)
            if (!isNaN(count)) {
                filters.orderCount = {
                    ...filters.orderCount,
                    $lte: Math.max(0, count),
                }
            }
        }

        // Защита от ReDoS: экранирование специальных символов в регулярных выражениях
        if (search) {
            const safeSearch = escapeStringRegexp(search as string)
            // Ограничение длины поискового запроса
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            const searchRegex = new RegExp(safeSearch, 'i')
            const orders = await Order.find(
                {
                    $or: [{ deliveryAddress: searchRegex }],
                },
                '_id'
            )

            const orderIds = orders.map((order) => order._id)

            filters.$or = [
                { name: searchRegex },
                { lastOrder: { $in: orderIds } },
            ]
        }

        const sort: { [key: string]: any } = {}

        // Безопасная сортировка - разрешаем только определенные поля
        const allowedSortFields = ['createdAt', 'totalAmount', 'orderCount', 'lastOrderDate']
        if (sortField && allowedSortFields.includes(sortField as string) && sortOrder) {
            sort[sortField as string] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1 // сортировка по умолчанию
        }

        const options = {
            sort,
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }

        const users = await User.find(filters, null, options).populate([
            'orders',
            {
                path: 'lastOrder',
                populate: {
                    path: 'products',
                },
            },
            {
                path: 'lastOrder',
                populate: {
                    path: 'customer',
                },
            },
        ])

        const totalUsers = await User.countDocuments(filters)
        const totalPages = Math.ceil(totalUsers / limitNum)

        res.status(200).json({
            customers: users,
            pagination: {
                totalUsers,
                totalPages,
                currentPage: pageNum,
                pageSize: limitNum,
            },
        })
    } catch (error) {
        next(error)
    }
}

// Get /customers/:id
export const getCustomerById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка прав администратора
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        const user = await User.findById(req.params.id).populate([
            'orders',
            'lastOrder',
        ])
        res.status(200).json(user)
    } catch (error) {
        next(error)
    }
}

// Patch /customers/:id
export const updateCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка прав администратора
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        // Ограничение полей для обновления
        const allowedFields = ['name', 'email', 'roles']
        const updateData: any = {}
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updateData[field] = req.body[field]
            }
        })

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            {
                new: true,
            }
        )
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )
            .populate(['orders', 'lastOrder'])
        res.status(200).json(updatedUser)
    } catch (error) {
        next(error)
    }
}

// Delete /customers/:id
export const deleteCustomer = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка прав администратора
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        // Нельзя удалить самого себя
        if (req.params.id === res.locals.user._id.toString()) {
            return next(new BadRequestError('Нельзя удалить самого себя'))
        }
        
        const deletedUser = await User.findByIdAndDelete(req.params.id).orFail(
            () =>
                new NotFoundError(
                    'Пользователь по заданному id отсутствует в базе'
                )
        )
        res.status(200).json(deletedUser)
    } catch (error) {
        next(error)
    }
}