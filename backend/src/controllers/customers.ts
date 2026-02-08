import { NextFunction, Request, Response } from 'express'
import { FilterQuery } from 'mongoose'
import escapeStringRegexp from 'escape-string-regexp'
import BadRequestError from '../errors/bad-request-error'
import NotFoundError from '../errors/not-found-error'
import ForbiddenError from '../errors/forbidden-error'
import User, { IUser } from '../models/user'

export const getCustomers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        // Проверка роли администратора
        if (!res.locals.user || !res.locals.user.roles.includes('admin')) {
            return next(new ForbiddenError('Доступ запрещен. Требуются права администратора'))
        }
        
        const {
            page = 1,
            limit = 10,
            search,
        } = req.query

        // Нормализация лимита - МАКСИМУМ 10
        const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
        const limitNum = Math.min(10, Math.max(1, parseInt(limit as string, 10) || 10))
        
        const filters: FilterQuery<Partial<IUser>> = {}

        // Экранирование поиска
        if (search && typeof search === 'string') {
            const safeSearch = escapeStringRegexp(search)
            if (safeSearch.length > 100) {
                return next(new BadRequestError('Слишком длинный поисковый запрос'))
            }
            
            const searchRegex = new RegExp(safeSearch, 'i')
            filters.$or = [
                { name: searchRegex },
                { email: searchRegex },
            ]
        }

        const users = await User.find(filters, '-password -__v')
            .sort({ createdAt: -1 })
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
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
            return next(new ForbiddenError('Доступ запрещен. Требуются права администратора'))
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
            .lean()
            
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
            return next(new ForbiddenError('Доступ запрещен. Требуются права администратора'))
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
            .lean()
            
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
            return next(new ForbiddenError('Доступ запрещен. Требуются права администратора'))
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
            .lean()
            
        res.status(200).json(deletedUser)
    } catch (error) {
        next(error)
    }
}