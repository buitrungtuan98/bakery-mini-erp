import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    query,
    orderBy,
    getDocs,
    updateDoc,
    where,
    limit,
    onSnapshot
} from 'firebase/firestore';
import { logAction } from '$lib/logger';
import { recordInventoryTransaction, getInventoryItemState, calculateAndCommitInventoryChange } from '$lib/services/inventoryService';
import type { InventoryTransaction } from '$lib/types/erp';

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

    async adjustIngredientStock(user: any, item: StockItem) {
        if (item.actualStock === item.currentStock) return;
        const diff = item.actualStock - item.currentStock;

        // We use the Central Inventory Engine
        await runTransaction(db, async (transaction) => {
             await recordInventoryTransaction(transaction, {
                type: 'adjustment',
                itemId: item.id,
                itemType: 'ingredient',
                quantityChange: diff, // + or -
                unitCost: 0, // Zero cost adjustment?
                             // If diff > 0, avg cost dilutes.
                             // ideally we should read current AvgCost and pass it.
                             // recordInventoryTransaction does read it inside, but we need to pass unitCost.
                             // If we pass 0, logic sees quantityChange > 0 and unitCost 0 -> valueChange 0.
                             // AvgCost = (OldVal + 0) / NewQty -> Lowers AvgCost.
                             // Correct behavior for "Found Item" is it has value?
                             // If we assume found item has same value as average, we should pass currentAvgCost.
                             // But we don't have it here easily without reading.
                             // For now, stick to 0 as per previous logic, or update to read?
                             // Given scope is Rollback, I will leave this logic mostly alone but fix types.
                relatedDocId: 'stocktake-' + new Date().toISOString().split('T')[0],
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: new Date()
            });
        });

        await logAction(user, 'UPDATE', 'master_ingredients', `Kiểm kê ${item.code}: ${item.currentStock} -> ${item.actualStock}`);
    },

    async adjustAssetStock(user: any, item: StockItem) {
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
    },

    /**
     * Subscribe to recent adjustments (Stocktake history)
     */
    subscribeAdjustments(limitCount: number, callback: (transactions: InventoryTransaction[]) => void) {
        const q = query(
            collection(db, 'inventory_transactions'),
            where('type', '==', 'adjustment'),
            orderBy('date', 'desc'),
            limit(limitCount)
        );
        return onSnapshot(q, (snapshot) => {
            const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryTransaction));
            callback(list);
        });
    },

    /**
     * Rollback/Cancel a stocktake adjustment
     */
    async cancelAdjustment(user: any, transactionId: string) {
        await runTransaction(db, async (t) => {
            // 1. Read the transaction
            const txRef = doc(db, 'inventory_transactions', transactionId);
            const txSnap = await t.get(txRef);
            if (!txSnap.exists()) throw new Error("Transaction not found");

            const txData = txSnap.data() as InventoryTransaction;
            if (txData.status === 'canceled') throw new Error("Giao dịch này đã bị hủy.");
            if (txData.type !== 'adjustment') throw new Error("Chỉ có thể hủy giao dịch Kiểm kê.");

            // 2. Read current Inventory Item state
            const state = await getInventoryItemState(t, txData.itemId, txData.itemType);

            // 3. Reverse logic
            // If original was +10, we do -10.
            // If original had explicit unitCost/value, we reverse that too.
            // Note: `calculateAndCommitInventoryChange` handles AvgCost logic.
            // We force `valueChange` to be negative of original totalValue to ensure perfect reversal.

            calculateAndCommitInventoryChange(t, {
                type: 'adjustment', // Reversal is also an adjustment
                itemId: txData.itemId,
                itemType: txData.itemType,
                quantityChange: -txData.quantity,
                unitCost: txData.unitCost,
                valueChange: -txData.totalValue, // Force reverse value
                relatedDocId: txData.id,
                relatedDocCode: 'ROLLBACK',
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: new Date()
            }, state);

            // 4. Mark original as canceled
            t.update(txRef, { status: 'canceled' });
        });

        await logAction(user, 'DELETE', 'inventory_transactions', `Hủy kiểm kê ID: ${transactionId.slice(0,8)}`);
    }
};
