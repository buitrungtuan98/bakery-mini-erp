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
    where
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';

export interface Category {
    id: string;
    name: string;
}
export interface Partner {
    id: string;
    name: string;
}
export interface ExpenseLog {
    id: string;
    code?: string;
    date: { toDate: () => Date };
    categoryName: string;
    amount: number;
    description: string;
    supplier: string;
    supplierId: string;
    createdAt: { toDate: () => Date };
}

export const expenseService = {
    async addCategory(user: User, name: string) {
        if (!name.trim()) throw new Error('Tên danh mục không được để trống.');

        await addDoc(collection(db, 'expense_categories'), {
            name: name.trim(),
            createdAt: serverTimestamp()
        });
        await logAction(user, 'CREATE', 'expense_categories', `Thêm mới danh mục: ${name}`);
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
        const code = await generateNextCode('expenses_log', 'CP');

        await addDoc(collection(db, 'expenses_log'), {
            code: code,
            date: Timestamp.fromDate(selectedDate),
            categoryId: data.categoryId,
            categoryName: category?.name || 'N/A',
            amount: Number(data.amount),
            description: data.description || 'Không mô tả',
            supplierId: data.selectedSupplierId,
            supplier: supplier?.name || 'N/A',
            createdBy: user.email,
            createdAt: serverTimestamp()
        });

        if (isAssetPurchase) {
            const assetCode = await generateNextCode('assets', 'TS');
            await addDoc(collection(db, 'assets'), {
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
           await logAction(user, 'CREATE', 'assets', `Tự động tạo tài sản từ chi phí: ${data.description} (${assetCode})`);
       }

       await logAction(user, 'TRANSACTION', 'expenses_log',
           `Chi tiền: ${category?.name}, ${data.amount.toLocaleString()} đ từ NCC ${supplier?.name || 'N/A'} (${code})`
       );

       return code;
    },

    subscribeCategories(callback: (categories: Category[]) => void) {
        const catQuery = query(collection(db, 'expense_categories'), orderBy('name'));
        return onSnapshot(catQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
        });
    },

    subscribeSuppliers(callback: (suppliers: Partner[]) => void) {
        const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
        return onSnapshot(supplierQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner)));
        });
    },

    subscribeHistory(limitCount: number, callback: (logs: ExpenseLog[]) => void) {
        const logQuery = query(collection(db, 'expenses_log'), orderBy('date', 'desc'), limit(limitCount));
        return onSnapshot(logQuery, (snapshot) => {
            callback(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ExpenseLog)));
        });
    }
};
