import { NextFunction, Request, Response } from 'express'
import jwt, { JwtPayload } from 'jsonwebtoken'
import { Types } from 'mongoose'
import { ACCESS_TOKEN, JWT_SECRET } from '../config'
import ForbiddenError from '../errors/forbidden-error'
import UnauthorizedError from '../errors/unauthorized-error'
import UserModel, { Role } from '../models/user'

const auth = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.header('Authorization')
        if (!authHeader?.startsWith('Bearer ')) {
            throw new UnauthorizedError('Невалидный токен')
        }
        
        const aTkn = authHeader.split(' ')[1]
        const payload = jwt.verify(aTkn, ACCESS_TOKEN.secret || JWT_SECRET) as JwtPayload

        const user = await UserModel.findOne(
            {
                _id: new Types.ObjectId(payload.sub),
            },
            { password: 0, salt: 0 }
        )

        if (!user) {
            throw new ForbiddenError('Нет доступа')
        }
        
        res.locals.user = user
        return next()
    } catch (error) {
        if (error instanceof Error && error.name === 'TokenExpiredError') {
            return next(new UnauthorizedError('Истек срок действия токена'))
        }
        if (error instanceof Error && error.name === 'JsonWebTokenError') {
            return next(new UnauthorizedError('Невалидный токен'))
        }
        return next(error)
    }
}

export function roleGuardMiddleware(...roles: Role[]) {
    return (_req: Request, res: Response, next: NextFunction) => {
        if (!res.locals.user) {
            return next(new UnauthorizedError('Необходима авторизация'))
        }

        const hasAccess = roles.some((role) =>
            res.locals.user.roles.includes(role)
        )

        if (!hasAccess) {
            return next(new ForbiddenError('Доступ запрещен'))
        }

        return next()
    }
}

export default auth