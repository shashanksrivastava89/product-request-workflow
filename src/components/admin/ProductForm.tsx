/**
 * Product Form Component
 * Create/Edit product form
 */

import { useState } from 'react';
import { AdminProduct, CreateProductData } from '../../services/api.service';
import { toNonNegativeInt, blockNegativeAndDecimal, normalizeNonNegativeInt } from '../../utils/numericInput';
import { extractApiError, mapApiFieldErrors } from '../../utils/apiError';

interface ProductFormProps {
    product?: AdminProduct | null;
    onSubmit: (data: CreateProductData) => Promise<void>;
    onCancel: () => void;
    isLoading?: boolean;
    onNotify?: (message: string, type: 'success' | 'error') => void;
}

export default function ProductForm({ product, onSubmit, onCancel, isLoading = false, onNotify }: ProductFormProps) {
    const [formData, setFormData] = useState<CreateProductData>({
        businessGroup: (product?.businessGroup === 'LSG' ? 'LSG' : 'CDG') as 'CDG' | 'LSG',
        code: product?.code || '',
        sapCode: product?.sapCode || '',
        name: product?.name || '',
        productNameLocal: product?.productNameLocal || '',
        price: normalizeNonNegativeInt(product?.price),
        listPrice: normalizeNonNegativeInt(product?.listPrice),
        division: product?.division || '',
        statisticsGroup: product?.statisticsGroup || '',
        priceGroup: product?.priceGroup || '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    const clearSubmitError = () => {
        if (submitError) setSubmitError(null);
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.code || formData.code.trim() === '') {
            newErrors.code = 'Product code is required';
        }

        // SAP code is required for CDG
        if (formData.businessGroup === 'CDG' && (!formData.sapCode || formData.sapCode.trim() === '')) {
            newErrors.sapCode = 'SAP code is required for CDG products';
        }

        if (!formData.name || formData.name.trim() === '') {
            newErrors.name = 'Product name is required';
        }

        if (!formData.productNameLocal || formData.productNameLocal.trim() === '') {
            newErrors.productNameLocal = 'Product name (Japanese) is required';
        }

        if (formData.price < 0) {
            newErrors.price = 'Price must be >= 0';
        }

        if (formData.listPrice < 0) {
            newErrors.listPrice = 'List price must be >= 0';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);
        if (!validate()) {
            const msg = 'Please fix the highlighted fields before saving.';
            setSubmitError(msg);
            onNotify?.(msg, 'error');
            return;
        }
        try {
            const payload: CreateProductData = {
                ...formData,
                price: normalizeNonNegativeInt(formData.price),
                listPrice: normalizeNonNegativeInt(formData.listPrice),
            };
            await onSubmit(payload);
        } catch (err: unknown) {
            const msg = extractApiError(err, product ? 'Failed to update product.' : 'Failed to create product.');
            setSubmitError(msg);
            onNotify?.(msg, 'error');
            const serverFields = mapApiFieldErrors(err);
            if (Object.keys(serverFields).length > 0) {
                setErrors((prev) => ({ ...prev, ...serverFields }));
            }
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {submitError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
                    {submitError}
                </div>
            )}
            <div className="grid grid-cols-2 gap-4">
                {/* Business Group */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Business Group <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.businessGroup}
                        onChange={(e) => {
                            clearSubmitError();
                            setFormData({ ...formData, businessGroup: e.target.value as 'CDG' | 'LSG' });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        required
                    >
                        <option value="CDG">CDG</option>
                        <option value="LSG">LSG</option>
                    </select>
                </div>

                {/* Product Code */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product Code <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => {
                            clearSubmitError();
                            setFormData({ ...formData, code: e.target.value });
                        }}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.code ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.code && <p className="mt-1 text-sm text-red-600">{errors.code}</p>}
                </div>

                {/* SAP Code */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        SAP Code {formData.businessGroup === 'CDG' && <span className="text-red-500">*</span>}
                        {formData.businessGroup === 'LSG' && <span className="text-gray-500 text-xs">(Optional)</span>}
                    </label>
                    <input
                        type="text"
                        value={formData.sapCode}
                        onChange={(e) => setFormData({ ...formData, sapCode: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.sapCode ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required={formData.businessGroup === 'CDG'}
                    />
                    {errors.sapCode && <p className="mt-1 text-sm text-red-600">{errors.sapCode}</p>}
                </div>

                {/* Product Name (English) */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product Name (English) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.name ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.name && <p className="mt-1 text-sm text-red-600">{errors.name}</p>}
                </div>

                {/* Product Name (Japanese) */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product Name (Japanese) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.productNameLocal}
                        onChange={(e) => setFormData({ ...formData, productNameLocal: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.productNameLocal ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.productNameLocal && <p className="mt-1 text-sm text-red-600">{errors.productNameLocal}</p>}
                </div>

                {/* Price */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Price (Contract Price) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={String(formData.price)}
                        onKeyDown={blockNegativeAndDecimal}
                        onChange={(e) => setFormData({ ...formData, price: toNonNegativeInt(e.target.value) })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.price ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.price && <p className="mt-1 text-sm text-red-600">{errors.price}</p>}
                </div>

                {/* List Price */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        List Price <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={String(formData.listPrice)}
                        onKeyDown={blockNegativeAndDecimal}
                        onChange={(e) => setFormData({ ...formData, listPrice: toNonNegativeInt(e.target.value) })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.listPrice ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.listPrice && <p className="mt-1 text-sm text-red-600">{errors.listPrice}</p>}
                </div>

                {/* Division (CDG only) */}
                {formData.businessGroup === 'CDG' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Division</label>
                        <input
                            type="text"
                            value={formData.division}
                            onChange={(e) => setFormData({ ...formData, division: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                )}

                {/* Statistics Group (CDG only) */}
                {formData.businessGroup === 'CDG' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Statistics Group</label>
                        <input
                            type="text"
                            value={formData.statisticsGroup}
                            onChange={(e) => setFormData({ ...formData, statisticsGroup: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                )}

                {/* Price Group (LSG only) */}
                {formData.businessGroup === 'LSG' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Price Group</label>
                        <input
                            type="text"
                            value={formData.priceGroup}
                            onChange={(e) => setFormData({ ...formData, priceGroup: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        />
                    </div>
                )}
            </div>

            {/* Form Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                    disabled={isLoading}
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 text-sm font-medium text-white bg-[#00A651] rounded-md hover:bg-[#008A44] focus:outline-none focus:ring-2 focus:ring-[#00A651] disabled:opacity-50"
                    disabled={isLoading}
                >
                    {isLoading ? 'Saving…' : product ? 'Update product' : 'Create product'}
                </button>
            </div>
        </form>
    );
}
