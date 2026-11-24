/**
 * Customer Form Component
 * Create/Edit customer form
 */

import { useState } from 'react';
import { AdminCustomer, CreateCustomerData } from '../../services/api.service';
import { extractApiError, mapApiFieldErrors } from '../../utils/apiError';

interface CustomerFormProps {
    customer?: AdminCustomer | null;
    onSubmit: (data: CreateCustomerData) => Promise<void>;
    onCancel: () => void;
    isLoading?: boolean;
    onNotify?: (message: string, type: 'success' | 'error') => void;
}

export default function CustomerForm({ customer, onSubmit, onCancel, isLoading = false, onNotify }: CustomerFormProps) {
    const [formData, setFormData] = useState<CreateCustomerData>({
        businessGroup: (customer?.businessGroup === 'LSG' ? 'LSG' : 'CDG') as 'CDG' | 'LSG',
        firstDigit: (customer?.firstDigit === '2' ? '2' : customer?.firstDigit === '8' ? '8' : '1') as '1' | '2' | '8',
        code: customer?.code || '',
        sapCode: customer?.sapCode || '',
        nameJp: customer?.nameJp || '',
        nameEn: customer?.nameEn || '',
        postalCode: customer?.postalCode || '',
        prefecture: customer?.prefecture || '',
        address: customer?.address || '',
        phone: customer?.phone || '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);

    const clearSubmitError = () => {
        if (submitError) setSubmitError(null);
    };

    const validate = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.code || formData.code.length !== 7 || !/^\d+$/.test(formData.code)) {
            newErrors.code = 'Code must be exactly 7 digits';
        }

        if (!formData.sapCode || formData.sapCode.trim() === '') {
            newErrors.sapCode = 'SAP Code is required';
        }

        if (!formData.nameJp || formData.nameJp.trim() === '') {
            newErrors.nameJp = 'Japanese name is required';
        }

        if (!formData.nameEn || formData.nameEn.trim() === '') {
            newErrors.nameEn = 'English name is required';
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
            await onSubmit(formData);
        } catch (err: unknown) {
            const msg = extractApiError(err, customer ? 'Failed to update customer.' : 'Failed to create customer.');
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

                {/* Customer Type */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Customer Type <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={formData.firstDigit}
                        onChange={(e) => {
                            clearSubmitError();
                            setFormData({ ...formData, firstDigit: e.target.value as '1' | '2' | '8' });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                        required
                    >
                        <option value="1">SOLD-TO (Channel Partner)</option>
                        <option value="2">Direct Delivery</option>
                        <option value="8">End User</option>
                    </select>
                </div>

                {/* Code */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Code (7 digits) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.code}
                        onChange={(e) => {
                            clearSubmitError();
                            setFormData({ ...formData, code: e.target.value.replace(/\D/g, '').slice(0, 7) });
                        }}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.code ? 'border-red-500' : 'border-gray-300'
                        }`}
                        placeholder="1234567"
                        maxLength={7}
                        required
                    />
                    {errors.code && <p className="mt-1 text-sm text-red-600">{errors.code}</p>}
                </div>

                {/* SAP Code */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        SAP Code <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.sapCode}
                        onChange={(e) => setFormData({ ...formData, sapCode: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.sapCode ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.sapCode && <p className="mt-1 text-sm text-red-600">{errors.sapCode}</p>}
                </div>

                {/* Name (Japanese) */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name (Japanese) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.nameJp}
                        onChange={(e) => setFormData({ ...formData, nameJp: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.nameJp ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.nameJp && <p className="mt-1 text-sm text-red-600">{errors.nameJp}</p>}
                </div>

                {/* Name (English) */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name (English) <span className="text-red-500">*</span>
                    </label>
                    <input
                        type="text"
                        value={formData.nameEn}
                        onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                        className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651] ${
                            errors.nameEn ? 'border-red-500' : 'border-gray-300'
                        }`}
                        required
                    />
                    {errors.nameEn && <p className="mt-1 text-sm text-red-600">{errors.nameEn}</p>}
                </div>

                {/* Postal Code */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                    <input
                        type="text"
                        value={formData.postalCode}
                        onChange={(e) => setFormData({ ...formData, postalCode: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                    />
                </div>

                {/* Prefecture */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Prefecture</label>
                    <input
                        type="text"
                        value={formData.prefecture}
                        onChange={(e) => setFormData({ ...formData, prefecture: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                    />
                </div>

                {/* Address */}
                <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <textarea
                        value={formData.address}
                        onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                        rows={2}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                    />
                </div>

                {/* Phone */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input
                        type="text"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#00A651]"
                    />
                </div>
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
                    {isLoading ? 'Saving…' : customer ? 'Update customer' : 'Create customer'}
                </button>
            </div>
        </form>
    );
}
