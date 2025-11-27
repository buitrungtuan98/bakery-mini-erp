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
import type { Product, Ingredient } from '$lib/stores/masterDataStore';
import type { User } from 'firebase/auth';

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
        product: Product,
        productionDateStr: string,
        actualYield: number,
        inputs: ProductionInput[],
        ingredients: Ingredient[]
    ) {
        if (!product) throw new Error("Sản phẩm không hợp lệ.");
        if (actualYield <= 0) throw new Error("Sản lượng phải lớn hơn 0.");

        const selectedDate = new Date(productionDateStr);
        if (isNaN(selectedDate.getTime())) throw new Error('Ngày sản xuất không hợp lệ!');

        // Validate Stock
        for (const input of inputs) {
            const currentStock = ingredients.find(i => i.id === input.ingredientId)?.currentStock || 0;
            if (input.actualQuantityUsed > currentStock) {
                const ingName = ingredients.find(i => i.id === input.ingredientId)?.name;
                throw new Error(`Lỗi: ${ingName} không đủ tồn kho! Tồn: ${currentStock}, Cần: ${input.actualQuantityUsed}`);
            }
        }

        const totalActualCost = inputs.reduce((sum, input) => sum + (input.actualQuantityUsed * input.snapshotCost), 0);
        const actualCostPerUnit = (actualYield > 0 && totalActualCost > 0) ? totalActualCost / actualYield : 0;
        const code = await generateNextCode('production_runs', 'SX');

        await runTransaction(db, async (transaction) => {
            const ingRefs = inputs.map(input => doc(db, 'ingredients', input.ingredientId));
            const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));
            const productRef = doc(db, 'products', product.id);
            const productSnap = await transaction.get(productRef);

            // Deduct Ingredients
            ingSnaps.forEach((snap, index) => {
                if (!snap.exists()) throw new Error(`Lỗi: Nguyên liệu ID ${ingRefs[index].id} không tồn tại.`);
                const input = inputs[index];
                const currentStock = Number(snap.data()!.currentStock || 0);
                const newStock = currentStock - input.actualQuantityUsed;
                transaction.update(ingRefs[index], { currentStock: newStock });
            });

            // Add Product Stock
            if (!productSnap.exists()) throw new Error("Lỗi: Không tìm thấy sản phẩm trong CSDL.");
            const currentProductStock = Number(productSnap.data()!.currentStock || 0);
            const newProductStock = currentProductStock + actualYield;
            transaction.update(productRef, { currentStock: newProductStock });

            // Create Log
            const productionLogRef = doc(collection(db, 'production_runs'));
            transaction.set(productionLogRef, {
                code: code,
                productId: product.id,
                productName: product.name,
                theoreticalCostSnapshot: product.theoreticalCost,
                productionDate: Timestamp.fromDate(selectedDate),
                actualYield: actualYield,
                totalActualCost: totalActualCost,
                actualCostPerUnit: actualCostPerUnit,
                consumedInputs: inputs.map(input => ({
                    ingredientId: input.ingredientId,
                    actualQuantityUsed: input.actualQuantityUsed,
                    snapshotCost: input.snapshotCost
                })),
                createdBy: user.email,
                createdAt: serverTimestamp()
            });

            await logAction(user, 'TRANSACTION', 'production_runs', `SX ${product.name}, Yield: ${actualYield} (${code})`);
        });

        return code;
    },

    /**
     * Delete/Reverse a production run
     */
    async deleteProductionRun(user: User, run: ProductionRun) {
        await runTransaction(db, async (transaction) => {
            const productRef = doc(db, 'products', run.productId);
            const productSnap = await transaction.get(productRef);
            const ingRefs = run.consumedInputs.map((input: any) => doc(db, 'ingredients', input.ingredientId));
            const ingSnaps = await Promise.all(ingRefs.map(ref => transaction.get(ref)));

            // Revert Ingredients (Add back)
            ingSnaps.forEach((snap, index) => {
                if (!snap.exists()) return;
                const input = run.consumedInputs[index];
                const currentStock = Number(snap.data()!.currentStock || 0);
                const newStock = currentStock + input.actualQuantityUsed;
                transaction.update(ingRefs[index], { currentStock: newStock });
            });

            // Revert Product (Deduct)
            if (!productSnap.exists()) throw new Error("Lỗi: Sản phẩm thành phẩm không tồn tại.");
            const currentProductStock = Number(productSnap.data()!.currentStock || 0);
            const newProductStock = currentProductStock - run.actualYield;
            transaction.update(productRef, { currentStock: newProductStock });

            transaction.delete(doc(db, 'production_runs', run.id));
        });

        const displayId = run.code || run.id.substring(0, 8).toUpperCase();
        await logAction(user, 'DELETE', 'production_runs', `Đảo ngược và xóa lệnh SX: ${displayId}, Yield: ${run.actualYield}`);
    },

    subscribeHistory(limitCount: number, callback: (runs: ProductionRun[]) => void) {
        const historyQuery = query(collection(db, 'production_runs'), orderBy('createdAt', 'desc'), limit(limitCount));
        return onSnapshot(historyQuery, (snapshot) => {
            const runs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionRun));
            callback(runs);
        });
    }
};
