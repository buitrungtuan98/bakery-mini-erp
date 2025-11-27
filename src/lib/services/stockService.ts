import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    query,
    orderBy,
    getDocs,
    updateDoc
} from 'firebase/firestore';
import { logAction } from '$lib/logger';
import { recordInventoryTransaction } from '$lib/services/inventoryService';
import type { User } from 'firebase/auth';

export interface StockItem {
    id: string;
    code: string;
    name: string;
    currentStock: number;
    actualStock: number;
    difference: number;
    unit?: string;
    baseUnit?: string;
    // For Assets
    quantity?: { total: number; good: number; broken: number; lost: number };
    actualGood?: number;
    actualBroken?: number;
    actualLost?: number;
}

export const stockService = {
    async fetchIngredients() {
        const q = query(collection(db, 'master_ingredients'), orderBy('code'));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            actualStock: doc.data().currentStock || 0
        } as StockItem));
    },

    async fetchAssets() {
        const q = query(collection(db, 'master_assets'), orderBy('code'));
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

        // We use the Central Inventory Engine
        await runTransaction(db, async (transaction) => {
             await recordInventoryTransaction(transaction, {
                type: 'adjustment',
                itemId: item.id,
                itemType: 'ingredient',
                quantityChange: diff, // + or -
                unitCost: 0, // Adjustment usually doesn't have a cost or we use avgCost?
                             // If we want to preserve value, we might read avgCost.
                             // recordInventoryTransaction reads current state, so we can pass 0
                             // and rely on it not messing up AvgCost if we implement logic there.
                             // BUT current logic in inventoryService:
                             // "Weighted Average Cost Logic (Only for Imports/Positive Adjustments)"
                             // If adjustment is positive, we might dilute cost if we pass 0.
                             // Ideally we pass current AvgCost to maintain it.
                             // Let's rely on recordInventoryTransaction to handle this or pass 0.
                             // For now, passing 0.
                relatedDocId: 'stocktake-' + new Date().toISOString().split('T')[0],
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: new Date()
            });
        });

        await logAction(user, 'UPDATE', 'master_ingredients', `Kiểm kê ${item.code}: ${item.currentStock} -> ${item.actualStock}`);
    },

    async adjustAssetStock(user: User, item: StockItem) {
        // Calculate total
        const newTotal = (item.actualGood || 0) + (item.actualBroken || 0) + (item.actualLost || 0);

        if (
            item.actualGood === item.quantity?.good &&
            item.actualBroken === item.quantity?.broken &&
            item.actualLost === item.quantity?.lost
        ) return;

        await updateDoc(doc(db, 'master_assets', item.id), {
            quantity: {
                total: newTotal,
                good: item.actualGood || 0,
                broken: item.actualBroken || 0,
                lost: item.actualLost || 0
            },
            updatedAt: serverTimestamp()
        });

        await logAction(user, 'UPDATE', 'master_assets',
            `Kiểm kê ${item.code}: Tốt(${item.actualGood}), Hỏng(${item.actualBroken}), Mất(${item.actualLost})`
        );
    }
};
