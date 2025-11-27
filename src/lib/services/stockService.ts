import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    addDoc,
    query,
    orderBy,
    getDocs,
    updateDoc
} from 'firebase/firestore';
import { logAction } from '$lib/logger';
import { generateNextCode } from '$lib/utils';
import type { User } from 'firebase/auth';

export interface StockItem {
    id: string;
    code: string;
    name: string;
    currentStock: number;
    actualStock: number;
    difference: number;
    unit?: string;
    // For Assets
    quantity?: { total: number; good: number; broken: number; lost: number };
    actualGood?: number;
    actualBroken?: number;
    actualLost?: number;
}

export const stockService = {
    async fetchIngredients() {
        const q = query(collection(db, 'ingredients'), orderBy('code'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            actualStock: doc.data().currentStock || 0
        } as StockItem));
    },

    async fetchAssets() {
        const q = query(collection(db, 'assets'), orderBy('code'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                actualGood: data.quantity?.good || 0,
                actualBroken: data.quantity?.broken || 0,
                actualLost: data.quantity?.lost || 0,
                actualStock: data.quantity?.total || 0 // derived for simple view if needed
            } as StockItem;
        });
    },

    async adjustIngredientStock(user: User, item: StockItem) {
        if (item.actualStock === item.currentStock) return;
        const diff = item.actualStock - item.currentStock;

        await runTransaction(db, async (transaction) => {
            const ref = doc(db, 'ingredients', item.id);
            transaction.update(ref, { currentStock: item.actualStock });

            // Create Adjustment Log
            // Could move this to a dedicated collection if needed, but for now simple log
            const logRef = doc(collection(db, 'stock_adjustments'));
            transaction.set(logRef, {
                itemId: item.id,
                itemType: 'ingredient',
                itemName: item.name,
                oldStock: item.currentStock,
                newStock: item.actualStock,
                difference: diff,
                reason: 'Stocktake adjustment',
                createdBy: user.email,
                createdAt: serverTimestamp()
            });
        });

        await logAction(user, 'UPDATE', 'ingredients', `Kiểm kê ${item.code}: ${item.currentStock} -> ${item.actualStock}`);
    },

    async adjustAssetStock(user: User, item: StockItem) {
        // Calculate total
        const newTotal = (item.actualGood || 0) + (item.actualBroken || 0) + (item.actualLost || 0);
        const oldTotal = item.quantity?.total || 0;

        if (
            item.actualGood === item.quantity?.good &&
            item.actualBroken === item.quantity?.broken &&
            item.actualLost === item.quantity?.lost
        ) return;

        await updateDoc(doc(db, 'assets', item.id), {
            quantity: {
                total: newTotal,
                good: item.actualGood || 0,
                broken: item.actualBroken || 0,
                lost: item.actualLost || 0
            },
            updatedAt: serverTimestamp()
        });

        await logAction(user, 'UPDATE', 'assets',
            `Kiểm kê ${item.code}: Tốt(${item.actualGood}), Hỏng(${item.actualBroken}), Mất(${item.actualLost})`
        );
    }
};
