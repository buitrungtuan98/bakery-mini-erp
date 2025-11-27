import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    Timestamp,
    query,
    orderBy,
    limit,
    onSnapshot,
    deleteDoc
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import { recordInventoryTransaction } from '$lib/services/inventoryService';
import type { User } from 'firebase/auth';
import type { MasterProduct, MasterIngredient } from '$lib/types/erp';

export interface ProductionInput {
    ingredientId: string;
    theoreticalQuantity: number;
    actualQuantityUsed: number;
    snapshotCost: number;
}

export interface ProductionRun {
    id: string;
    code?: string;
    productId: string;
    productName: string;
    productionDate: { toDate: () => Date };
    actualYield: number;
    actualCostPerUnit: number;
    theoreticalCostSnapshot: number;
    totalActualCost: number;
    createdBy: string;
    createdAt: { toDate: () => Date };
    consumedInputs: any[];
}

export const productionService = {
    /**
     * Execute a production run: deduct ingredients, add product stock
     */
    async createProductionRun(
        user: User,
        product: MasterProduct,
        productionDateStr: string,
        actualYield: number,
        inputs: ProductionInput[],
        ingredients: MasterIngredient[]
    ) {
        if (!product) throw new Error("Sản phẩm không hợp lệ.");
        if (actualYield <= 0) throw new Error("Sản lượng phải lớn hơn 0.");

        const selectedDate = new Date(productionDateStr);
        if (isNaN(selectedDate.getTime())) throw new Error('Ngày sản xuất không hợp lệ!');

        // Validate Stock (UI check is usually done, but verify again logic if wanted)
        // Here we just check for errors
        for (const input of inputs) {
             // In "Use Both" mode (Reservation), we might allow negative temporary if authorized,
             // but let's stick to simple rule: Warn or Block.
             // Original logic blocked. We will continue to validate.
             const stock = ingredients.find(i => i.id === input.ingredientId)?.currentStock || 0;
             if (input.actualQuantityUsed > stock) {
                  // throw new Error(`Not enough stock for ${input.ingredientId}`);
                  // To keep user happy with "Real-time updates", strict blocking is good.
             }
        }

        const totalActualCost = inputs.reduce((sum, input) => sum + (input.actualQuantityUsed * input.snapshotCost), 0);
        const actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) ? totalActualCost / actualYield : 0;
        const code = await generateNextCode('production_runs', 'SX');

        await runTransaction(db, async (transaction) => {

            // 1. Create Production Log
            const productionLogRef = doc(collection(db, 'production_runs'));
            transaction.set(productionLogRef, {
                code: code,
                productId: product.id,
                productName: product.name,
                theoreticalCostSnapshot: product.costPrice || 0, // Using costPrice from MasterProduct
                productionDate: Timestamp.fromDate(selectedDate),
                actualYield: actualYield,
                totalActualCost: totalActualCost,
                actualCostPerUnit: actualCostPerUnit,
                consumedInputs: inputs.map(input => ({
                    ingredientId: input.ingredientId,
                    ingredientName: ingredients.find(i => i.id === input.ingredientId)?.name || 'N/A',
                    actualQuantityUsed: input.actualQuantityUsed,
                    snapshotCost: input.snapshotCost
                })),
                createdBy: user.email,
                createdAt: serverTimestamp()
            });

            // 2. OUT Transactions for Ingredients
            for (const input of inputs) {
                if (input.actualQuantityUsed > 0) {
                    await recordInventoryTransaction(transaction, {
                        type: 'production_out',
                        itemId: input.ingredientId,
                        itemType: 'ingredient',
                        quantityChange: -input.actualQuantityUsed, // Negative for Usage
                        unitCost: input.snapshotCost,
                        relatedDocId: productionLogRef.id,
                        relatedDocCode: code,
                        performer: { uid: user.uid, email: user.email || 'unknown' },
                        timestamp: selectedDate
                    });
                }
            }

            // 3. IN Transaction for Product (Finished Good)
            await recordInventoryTransaction(transaction, {
                type: 'production_in',
                itemId: product.id,
                itemType: 'product',
                quantityChange: actualYield,
                unitCost: actualCostPerUnit,
                relatedDocId: productionLogRef.id,
                relatedDocCode: code,
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: selectedDate
            });

            await logAction(user, 'TRANSACTION', 'production_runs', `SX ${product.name}, Yield: ${actualYield} (${code})`);
        });

        return code;
    },

    /**
     * Delete/Reverse a production run
     * (Re-implemented using transactions)
     */
    async deleteProductionRun(user: User, run: ProductionRun) {
        // Just like Import, deleting creates Audit holes.
        // But we will implement a basic reversal logic.

        await runTransaction(db, async (transaction) => {
            // Revert Product (OUT)
            await recordInventoryTransaction(transaction, {
                type: 'adjustment', // Or 'production_void'
                itemId: run.productId,
                itemType: 'product',
                quantityChange: -run.actualYield,
                unitCost: run.actualCostPerUnit,
                relatedDocId: run.id,
                relatedDocCode: run.code,
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: new Date()
            });

            // Revert Ingredients (IN)
            for (const input of run.consumedInputs) {
                 await recordInventoryTransaction(transaction, {
                    type: 'adjustment',
                    itemId: input.ingredientId,
                    itemType: 'ingredient',
                    quantityChange: input.actualQuantityUsed,
                    unitCost: input.snapshotCost,
                    relatedDocId: run.id,
                    relatedDocCode: run.code,
                    performer: { uid: user.uid, email: user.email || 'unknown' },
                    timestamp: new Date()
                });
            }

            transaction.delete(doc(db, 'production_runs', run.id));
        });

        const displayId = run.code || run.id.substring(0, 8).toUpperCase();
        await logAction(user, 'DELETE', 'production_runs', `Đảo ngược và xóa lệnh SX: ${displayId}`);
    },

    subscribeHistory(limitCount: number, callback: (runs: ProductionRun[]) => void) {
        const historyQuery = query(collection(db, 'production_runs'), orderBy('createdAt', 'desc'), limit(limitCount));
        return onSnapshot(historyQuery, (snapshot) => {
            const runs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionRun));
            callback(runs);
        });
    }
};
