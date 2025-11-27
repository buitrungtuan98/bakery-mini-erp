import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    Timestamp,
    query,
    orderBy,
    onSnapshot,
    deleteDoc,
    getDocs,
    where
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import type { User } from 'firebase/auth';

export interface Partner { id: string; name: string; taxId?: string; }
export interface Ingredient { id: string; name: string; code: string; baseUnit: string; avgCost: number; currentStock: number; }
export interface ImportItem { ingredientId: string; quantity: number; price: number; tempIngredient?: Ingredient; }
export interface ImportReceipt {
    id: string;
    code?: string;
    supplierName: string;
    totalAmount: number;
    createdAt: { toDate: () => Date };
    importDate: { toDate: () => Date };
    items: any[];
}

export const inventoryService = {
    /**
     * Create Import Receipt and Update Stock (Weighted Average Cost)
     */
    async createImportReceipt(
        user: User,
        supplierId: string,
        importDateStr: string,
        items: ImportItem[],
        suppliers: Partner[],
        ingredients: Ingredient[]
    ) {
        if (!supplierId) throw new Error('Chưa chọn Nhà cung cấp');
        const validItems = items.filter(i => i.ingredientId && i.quantity > 0);
        if (validItems.length === 0) throw new Error('Chưa có dòng hàng nào hợp lệ');

        const selectedDate = new Date(importDateStr);
        if (isNaN(selectedDate.getTime())) throw new Error('Ngày nhập không hợp lệ!');

        const totalAmount = validItems.reduce((sum, item) => sum + (item.price || 0), 0);
        const code = await generateNextCode('imports', 'NK');

        await runTransaction(db, async (transaction) => {
            const supplierSnapshot = suppliers.find(s => s.id === supplierId);
            const ingRefs = validItems.map(item => ({
                ref: doc(db, 'ingredients', item.ingredientId),
                itemData: item
            }));
            const ingSnaps = await Promise.all(ingRefs.map(ir => transaction.get(ir.ref)));

            ingSnaps.forEach((snap, idx) => {
                if (!snap.exists()) throw new Error("Nguyên liệu không tồn tại!");
                const currentData = snap.data();
                const inputItem = ingRefs[idx].itemData;

                const currentStock = Number(currentData.currentStock || 0);
                const currentAvgCost = Number(currentData.avgCost || 0);

                // Calculate Weighted Average Cost
                const oldValue = currentStock * currentAvgCost;
                const newValue = inputItem.price;
                const newStock = currentStock + inputItem.quantity;
                const newAvgCost = newStock > 0 ? (oldValue + newValue) / newStock : 0;

                transaction.update(ingRefs[idx].ref, {
                    currentStock: newStock,
                    avgCost: Math.round(newAvgCost)
                });
            });

            const importRef = doc(collection(db, 'imports'));
            transaction.set(importRef, {
                code: code,
                supplierId: supplierId,
                supplierName: supplierSnapshot?.name || 'N/A',
                importDate: Timestamp.fromDate(selectedDate),
                items: validItems.map(i => ({
                    ingredientId: i.ingredientId,
                    ingredientCode: ingredients.find(x=>x.id === i.ingredientId)?.code,
                    ingredientName: ingredients.find(x=>x.id === i.ingredientId)?.name,
                    quantity: i.quantity,
                    totalPrice: i.price
                })),
                totalAmount: totalAmount,
                createdBy: user.email,
                createdAt: serverTimestamp()
            });

            await logAction(user, 'TRANSACTION', 'imports', `Tạo phiếu nhập ${code}`);
        });

        return code;
    },

    async deleteImportReceipt(user: User, id: string) {
        await deleteDoc(doc(db, 'imports', id));
        await logAction(user, 'DELETE', 'imports', `Xóa phiếu nhập ID: ${id}`);
    },

    subscribeHistory(callback: (receipts: ImportReceipt[]) => void) {
        const q = query(collection(db, 'imports'), orderBy('createdAt', 'desc'));
        return onSnapshot(q, (snapshot) => {
            const receipts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportReceipt));
            callback(receipts);
        });
    },

    async fetchSuppliers() {
        const supplierQuery = query(collection(db, 'partners'), where('type', '==', 'supplier'), orderBy('name'));
        const supplierSnap = await getDocs(supplierQuery);
        return supplierSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Partner));
    },

    async fetchIngredients() {
        const ingSnap = await getDocs(query(collection(db, 'ingredients'), orderBy('code')));
        return ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Ingredient));
    }
};
