import { NextFunction, Request, Response } from 'express'
import { FilterQuery } from 'mongoose'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import UnauthorizedError from '../errors/unauthorized-error'
import User, { IUser } from '../models/user'

// Guard для администраторов
const adminGuard = (_req: Request, _res: Response, next: NextFunction) => {
    next()
}

// Get GET /customers?page=2&limit=5&sort=totalAmount&order=desc&registrationDateFrom=2023-01-01&registrationDateTo=2023-12-31&lastOrderDateFrom=2023-01-01&lastOrderDateTo=2023-12-31&totalAmountFrom=100&totalAmountTo=1000&orderCountFrom=1&orderCountTo=10
export const getCustomers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return res.status(403).json({ 
                error: 'Доступ запрещен. Требуются права администратора' 
            });
        }
        
        // ЗАПРЕЩАЕМ поиск для безопасности
        if (req.query.search) {
            return next(new BadRequestError('Поиск пользователей временно отключен'))
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
        } = req.query

        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        const limitNum = Math.min(10, Math.max(1, parseInt(limit as string, 10) || 10))
        
        const filters: FilterQuery<Partial<IUser>> = {}

        if (registrationDateFrom) {
            const date = new Date(registrationDateFrom as string)
            if (!Number.isNaN(date.getTime())) {
                filters.createdAt = { $gte: date }
            }
        }

        if (registrationDateTo) {
            const date = new Date(registrationDateTo as string)
            if (!Number.isNaN(date.getTime())) {
                const endOfDay = new Date(date)
                endOfDay.setHours(23, 59, 59, 999)
                filters.createdAt = { $lte: endOfDay }
            }
        }

        if (lastOrderDateFrom) {
            const date = new Date(lastOrderDateFrom as string)
            if (!Number.isNaN(date.getTime())) {
                filters.lastOrderDate = { $gte: date }
            }
        }

        if (lastOrderDateTo) {
            const date = new Date(lastOrderDateTo as string)
            if (!Number.isNaN(date.getTime())) {
                const endOfDay = new Date(date)
                endOfDay.setHours(23, 59, 59, 999)
                filters.lastOrderDate = { $lte: endOfDay }
            }
        }

        if (totalAmountFrom) {
            const amount = Number(totalAmountFrom)
            if (!Number.isNaN(amount) && amount >= 0) {
                filters.totalAmount = { $gte: amount }
            }
        }

        if (totalAmountTo) {
            const amount = Number(totalAmountTo)
            if (!Number.isNaN(amount) && amount >= 0) {
                filters.totalAmount = { $lte: amount }
            }
        }

        if (orderCountFrom) {
            const count = Number(orderCountFrom)
            if (!Number.isNaN(count) && count >= 0) {
                filters.orderCount = { $gte: count }
            }
        }

        if (orderCountTo) {
            const count = Number(orderCountTo)
            if (!Number.isNaN(count) && count >= 0) {
                filters.orderCount = { $lte: count }
            }
        }

        const sort: { [key: string]: any } = {}
        const allowedSortFields = ['createdAt', 'totalAmount', 'orderCount', 'lastOrderDate', 'name', 'email']
        if (sortField && allowedSortFields.includes(sortField as string) && sortOrder) {
            sort[sortField as string] = sortOrder === 'desc' ? -1 : 1
        } else {
            sort.createdAt = -1
        }

        const options = {
            sort,
            skip: (pageNum - 1) * limitNum,
            limit: limitNum,
        }

        const users = await User.find(filters, '-password -__v', options)
            .populate([
                {
                    path: 'lastOrder',
                    select: 'products customer totalAmount status',
                    populate: [
                        {
                            path: 'products',
                            select: 'title price',
                        },
                        {
                            path: 'customer',
                            select: 'name email',
                        },
                    ],
                },
            ])
            .lean()

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
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        const user = await User.findById(req.params.id)
            .select('-password -__v')
            .populate([
                {
                    path: 'orders',
                    select: 'orderNumber status totalAmount createdAt',
                    options: { sort: { createdAt: -1 }, limit: 20 }
                },
                {
                    path: 'lastOrder',
                    select: 'orderNumber status totalAmount products createdAt',
                    populate: {
                        path: 'products',
                        select: 'title price',
                    },
                },
            ])
            .lean();
            
        if (!user) {
            return next(new NotFoundError('Пользователь по заданному id отсутствует в базе'))
        }
        
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
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        const allowedFields = ['name', 'email', 'roles']
        const updateData: any = {}
        
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                if (field === 'email' && req.body[field]) {
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    if (!emailRegex.test(req.body[field])) {
                        throw new BadRequestError('Некорректный email')
                    }
                }
                updateData[field] = req.body[field]
            }
        })

        const updatedUser = await User.findByIdAndUpdate(
            req.params.id,
            updateData,
            {
                new: true,
                runValidators: true,
            }
        )
            .select('-password -__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )
            .populate([
                {
                    path: 'orders',
                    select: 'orderNumber status totalAmount createdAt',
                    options: { limit: 10 }
                },
                {
                    path: 'lastOrder',
                    select: 'orderNumber status totalAmount createdAt',
                },
            ])
            .lean();
            
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
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new UnauthorizedError('Доступ запрещен. Требуются права администратора'))
        }
        
        if (req.params.id === res.locals.user._id.toString()) {
            return next(new BadRequestError('Нельзя удалить самого себя'))
        }
        
        const deletedUser = await User.findByIdAndDelete(req.params.id)
            .select('-password -__v')
            .orFail(
                () =>
                    new NotFoundError(
                        'Пользователь по заданному id отсутствует в базе'
                    )
            )
            .lean();
            
        res.status(200).json(deletedUser)
    } catch (error) {
        next(error)
    }
}