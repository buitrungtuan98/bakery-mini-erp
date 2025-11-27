import { db } from '$lib/firebase';
import {
    collection,
    addDoc,
    query,
    orderBy,
    onSnapshot,
    serverTimestamp,
    Timestamp,
    limit,
    where,
    doc
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';
import type { FinanceLedger, MasterPartner } from '$lib/types/erp';

export interface Category {
    id: string;
    name: string;
}

// Alias for UI compatibility
export type Partner = MasterPartner;
export type ExpenseLog = FinanceLedger;

export const expenseService = {
    async addCategory(user: User, name: string) {
        if (!name.trim()) throw new Error('Tên danh mục không được để trống.');

        await addDoc(collection(db, 'master_expense_categories'), {
            name: name.trim(),
            createdAt: serverTimestamp()
        });
        await logAction(user, 'CREATE', 'master_expense_categories', `Thêm mới danh mục: ${name}`);
    },

    async createExpense(
        user: User,
        data: {
            date: string;
            categoryId: string;
            amount: number;
            description: string;
            selectedSupplierId: string;
        },
        categories: Category[],
        suppliers: Partner[],
        isAssetPurchase: boolean = false
    ) {
        if (!data.categoryId) throw new Error("Vui lòng chọn danh mục chi phí.");
        if (!data.selectedSupplierId) throw new Error("Vui lòng chọn Nhà cung cấp/Người bán.");
        if (data.amount <= 0) throw new Error("Số tiền phải lớn hơn 0.");

        const selectedDate = new Date(data.date);
        const category = categories.find(c => c.id === data.categoryId);
        const supplier = suppliers.find(s => s.id === data.selectedSupplierId);

        // Generate a CP code for reference, even though ID is auto-gen
        const code = await generateNextCode('finance_ledger', 'CP');
        // Note: finance_ledger might store mixed types, so prefixing code is important.
        // Or we can just use ID. But for UI consistency, a short code is nice.

        // We write to 'finance_ledger'
        const ledgerRef = await addDoc(collection(db, 'finance_ledger'), {
            date: Timestamp.fromDate(selectedDate),
            type: 'expense',
            category: category?.name || 'N/A', // Store snapshot name
            amount: Number(data.amount),
            description: data.description || 'Không mô tả',
            relatedDocId: data.selectedSupplierId, // Store Supplier ID here or in description?
            // The FinanceLedger type has 'relatedDocId'.
            // We should probably store extra metadata if possible, but Firestore is flexible.
            // Let's stick to the interface defined in erp.ts as much as possible,
            // but add custom fields if needed for "Supplier" tracking in Expenses.
            supplierId: data.selectedSupplierId,
            supplierName: supplier?.name || 'N/A',
            code: code, // Add code field

            recordedBy: user.email,
            createdAt: serverTimestamp()
        });

        if (isAssetPurchase) {
            const assetCode = await generateNextCode('assets', 'TS');
            // 'assets' can be 'master_assets' if we want. Keeping 'assets' for now as it wasn't strictly Master Data in user list but looks like it.
            // Let's use 'master_assets' to be consistent with "Fresh Start".
            await addDoc(collection(db, 'master_assets'), {
               code: assetCode,
               name: data.description,
               category: category?.name || 'Tài sản chung',
               status: 'Đang dùng',
               originalPrice: Number(data.amount),
               quantity: { total: 1, good: 1, broken: 0, lost: 0 },
               purchaseDate: Timestamp.fromDate(selectedDate),
               createdBy: user.email,
               createdAt: serverTimestamp()
           });
           await logAction(user, 'CREATE', 'master_assets', `Tự động tạo tài sản từ chi phí: ${data.description} (${assetCode})`);
       }

       await logAction(user, 'TRANSACTION', 'finance_ledger',
           `Chi tiền: ${category?.name}, ${data.amount.toLocaleString()} đ từ NCC ${supplier?.name || 'N/A'} (${code})`
       );

       return code;
    },

    subscribeCategories(callback: (categories: Category[]) => void) {
        const catQuery = query(collection(db, 'master_expense_categories'), orderBy('name'));
        return onSnapshot(catQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
        });
    },

    subscribeSuppliers(callback: (suppliers: Partner[]) => void) {
        const supplierQuery = query(collection(db, 'master_partners'), where('type', '==', 'supplier'), orderBy('name'));
        return onSnapshot(supplierQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner)));
        });
    },

    subscribeHistory(limitCount: number, callback: (logs: FinanceLedger[]) => void) {
        // Filter by type 'expense'
        const logQuery = query(
            collection(db, 'finance_ledger'),
            where('type', '==', 'expense'),
            orderBy('date', 'desc'),
            limit(limitCount)
        );
        return onSnapshot(logQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceLedger)));
        });
    }
};
