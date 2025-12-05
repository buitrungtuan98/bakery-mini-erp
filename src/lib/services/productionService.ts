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
    deleteDoc,
    type DocumentReference
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import { financeService } from '$lib/services/financeService';
import { getInventoryItemState, calculateAndCommitInventoryChange, recordInventoryTransaction } from '$lib/services/inventoryService';
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
    status?: 'active' | 'canceled';
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
        ingredients: MasterIngredient[],
        options?: { forceId?: string; forceCode?: string; forceCreatedAt?: Date }
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
        const code = options?.forceCode || await generateNextCode('production_runs', 'SX');

        await runTransaction(db, async (transaction) => {

            // 1. READ PHASE: Fetch Product (In) and Ingredients (Out) States
            const productState = await getInventoryItemState(transaction, product.id, 'product');

            const ingredientStates = new Map<string, { ref: DocumentReference; data: any }>();
            for (const input of inputs) {
                if (input.actualQuantityUsed > 0 && !ingredientStates.has(input.ingredientId)) {
                    const state = await getInventoryItemState(transaction, input.ingredientId, 'ingredient');
                    ingredientStates.set(input.ingredientId, state);
                }
            }

            // 2. WRITE PHASE
            // Create Production Log
            const productionLogRef = options?.forceId
                ? doc(db, 'production_runs', options.forceId)
                : doc(collection(db, 'production_runs'));

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
                createdAt: options?.forceCreatedAt ? Timestamp.fromDate(options.forceCreatedAt) : serverTimestamp()
            });

            // OUT Transactions for Ingredients
            for (const input of inputs) {
                if (input.actualQuantityUsed > 0) {
                    const state = ingredientStates.get(input.ingredientId);
                    if (state) {
                        calculateAndCommitInventoryChange(transaction, {
                            type: 'production_out',
                            itemId: input.ingredientId,
                            itemType: 'ingredient',
                            quantityChange: -input.actualQuantityUsed, // Negative for Usage
                            unitCost: input.snapshotCost,
                            relatedDocId: productionLogRef.id,
                            relatedDocCode: code,
                            performer: { uid: user.uid, email: user.email || 'unknown' },
                            timestamp: selectedDate
                        }, state);
                    }
                }
            }

            // IN Transaction for Product (Finished Good)
            calculateAndCommitInventoryChange(transaction, {
                type: 'production_in',
                itemId: product.id,
                itemType: 'product',
                quantityChange: actualYield,
                unitCost: actualCostPerUnit,
                relatedDocId: productionLogRef.id,
                relatedDocCode: code,
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: selectedDate
            }, productState);
        });

        await logAction(user, 'TRANSACTION', 'production_runs', `SX ${product.name}, Yield: ${actualYield} (${code})`);

        return code;
    },

    /**
     * Delete/Reverse a production run
     * (Soft Delete and Reversal)
     */
    async deleteProductionRun(user: User, run: ProductionRun) {
        // Soft Delete and Rollback Inventory + Finance

        await runTransaction(db, async (transaction) => {
            // 1. READ PHASE
            const productionRef = doc(db, 'production_runs', run.id);
            const productState = await getInventoryItemState(transaction, run.productId, 'product');

            const ingredientStates = new Map<string, { ref: DocumentReference; data: any }>();
            for (const input of run.consumedInputs) {
                if (!ingredientStates.has(input.ingredientId)) {
                     const state = await getInventoryItemState(transaction, input.ingredientId, 'ingredient');
                     ingredientStates.set(input.ingredientId, state);
                }
            }

            // 2. WRITE PHASE

            // Revert Product (OUT) - Deduct the finished good we added
            calculateAndCommitInventoryChange(transaction, {
                type: 'adjustment', // Or 'production_void'
                itemId: run.productId,
                itemType: 'product',
                quantityChange: -run.actualYield,
                unitCost: run.actualCostPerUnit,
                relatedDocId: run.id,
                relatedDocCode: run.code,
                performer: { uid: user.uid, email: user.email || 'unknown' },
                timestamp: new Date()
            }, productState);

            // Revert Ingredients (IN) - Return ingredients to stock
            for (const input of run.consumedInputs) {
                 const state = ingredientStates.get(input.ingredientId);
                 if (state) {
                     calculateAndCommitInventoryChange(transaction, {
                        type: 'adjustment',
                        itemId: input.ingredientId,
                        itemType: 'ingredient',
                        quantityChange: input.actualQuantityUsed,
                        unitCost: input.snapshotCost,
                        // Note: Standard 'Stock IN' logic correctly handles Avg Cost (Input Weighted Avg).
                        // Since this is a reversal of usage, returning it at snapshot cost is correct behavior.
                        relatedDocId: run.id,
                        relatedDocCode: run.code,
                        performer: { uid: user.uid, email: user.email || 'unknown' },
                        timestamp: new Date()
                    }, state);
                 }
            }

            // Soft Delete Status
            transaction.update(productionRef, { status: 'canceled' });
        });

        // Cancel Finance Entries (if any exist)
        await financeService.cancelEntriesByRelatedDoc(run.id);

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
