import { Request, Response, NextFunction } from 'express';
import { db, ChannelPartner, EndUser, User } from '../services/db.service';
import * as productService from '../services/product.service';

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search } = req.query;

        let products = search
            ? await productService.searchProducts(search as string)
            : await productService.getAllProducts();

        res.json({
            success: true,
            data: products,
            count: products.length
        });
    } catch (error) {
        next(error);
    }
};

export const getProductByCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { code } = req.params;
        const product = await productService.getProductByCode(code);

        if (!product) {
            return res.status(404).json({
                success: false,
                error: 'Product not found'
            });
        }

        return res.json({
            success: true,
            data: product
        });
    } catch (error) {
        return next(error);
    }
};

export const getChannelPartners = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search } = req.query;

        let partners = db.findMany<ChannelPartner>('channelPartners', { isActive: true });

        if (search) {
            const searchLower = (search as string).toLowerCase();
            partners = partners.filter(p =>
                p.code.toLowerCase().includes(searchLower) ||
                p.name.toLowerCase().includes(searchLower)
            );
        }

        res.json({ partners });
    } catch (error) {
        next(error);
    }
};

export const getEndUsers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { search } = req.query;

        let endUsers = db.findMany<EndUser>('endUsers', { isActive: true });

        if (search) {
            const searchLower = (search as string).toLowerCase();
            endUsers = endUsers.filter(u =>
                u.code.toLowerCase().includes(searchLower) ||
                u.name.toLowerCase().includes(searchLower)
            );
        }

        res.json({ endUsers });
    } catch (error) {
        next(error);
    }
};

export const getSalesReps = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { businessUnit, requesterGroup } = req.query;

        let salesReps = db.findMany<User>('users', {
            isActive: true,
            role: 'REQUESTER'
        });

        if (businessUnit) {
            salesReps = salesReps.filter(u => u.businessUnit === businessUnit);
        }

        if (requesterGroup) {
            salesReps = salesReps.filter(u => u.requesterGroupId === requesterGroup);
        }

        // Remove password from response
        const salesRepsWithoutPassword = salesReps.map(({ password, ...user }) => user);

        res.json({ salesReps: salesRepsWithoutPassword });
    } catch (error) {
        next(error);
    }
};
