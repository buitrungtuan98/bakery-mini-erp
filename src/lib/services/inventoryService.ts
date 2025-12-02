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
    where,
    type DocumentReference,
    type DocumentSnapshot
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import { financeService } from '$lib/services/financeService';
import type { User } from 'firebase/auth';
import type { MasterIngredient, InventoryTransaction, MasterPartner, MasterProduct } from '$lib/types/erp';

// Re-export specific types if needed by UI
export type { MasterIngredient, MasterPartner, InventoryTransaction };

export interface ImportItem {
    ingredientId: string;
    quantity: number;
    price: number;
    // temp properties for UI
    tempIngredient?: MasterIngredient;
}

export interface ImportReceipt {
    id: string;
    code?: string;
    supplierName: string;
    totalAmount: number;
    createdAt: { toDate: () => Date };
    importDate: { toDate: () => Date };
    items: any[];
    status?: 'active' | 'canceled';
}

// --- CORE INVENTORY ENGINE ---

/**
 * Helper to fetch the current state of an inventory item (Product or Ingredient)
 * Used to ensure all Reads are done before Writes in a Transaction.
 */
export async function getInventoryItemState(
    t: any,
    itemId: string,
    itemType: 'product' | 'ingredient'
): Promise<{ ref: DocumentReference; data: any; snap: DocumentSnapshot }> {
    const collectionName = itemType === 'product' ? 'master_products' : 'master_ingredients';
    const itemRef = doc(db, collectionName, itemId);
    const itemSnap = await t.get(itemRef);

    if (!itemSnap.exists()) {
        throw new Error(`Item ${itemId} not found in ${collectionName}`);
    }

    return { ref: itemRef, data: itemSnap.data(), snap: itemSnap };
}

/**
 * Calculates new stock/cost and performs the update (Write).
 * Must be called after all reads are complete.
 */
export function calculateAndCommitInventoryChange(
    t: any,
    details: {
        type: InventoryTransaction['type'];
        itemId: string;
        itemType: 'product' | 'ingredient';
        quantityChange: number;
        unitCost: number;
        valueChange?: number; // Optional: Explicit value change for Reversals/Corrections
        relatedDocId?: string;
        relatedDocCode?: string;
        performer: { uid: string; email: string };
        timestamp: Date;
    },
    currentState: { ref: DocumentReference; data: any }
) {
    const itemData = currentState.data;
    const currentStock = Number(itemData.currentStock || 0);
    const currentAvgCost = Number(itemData.avgCost || 0);

    // Calculate New State
    let newStock = currentStock + details.quantityChange;
    let newAvgCost = currentAvgCost;

    // Weighted Average Cost Logic
    // Applied if it's an Ingredient OR Product AND (it's an Import/Production IN OR we are explicitly reversing value)
    if (details.itemType === 'ingredient' || details.itemType === 'product') {
        const valueChange = details.valueChange !== undefined
            ? details.valueChange
            : (details.quantityChange > 0 ? details.quantityChange * details.unitCost : 0);

        // If valueChange is explicitly provided OR it's a standard positive import/production in
        if (details.valueChange !== undefined || details.quantityChange > 0) {
            const oldValue = currentStock * currentAvgCost;
            if (newStock > 0) {
                newAvgCost = (oldValue + valueChange) / newStock;
            } else {
                 newAvgCost = 0; // Reset if stock hits 0
            }
        }
    }

    // Update Master Data Snapshot
    t.update(currentState.ref, {
        currentStock: newStock,
        avgCost: Math.round(newAvgCost)
    });

    // Create Transaction Log
    const logRef = doc(collection(db, 'inventory_transactions'));
    const logData: InventoryTransaction = {
        id: logRef.id,
        type: details.type,
        date: Timestamp.fromDate(details.timestamp),
        itemId: details.itemId,
        itemType: details.itemType,
        itemName: itemData.name,
        quantity: details.quantityChange,
        unitCost: details.unitCost,
        totalValue: details.quantityChange * details.unitCost,
        relatedDocId: details.relatedDocId,
        relatedDocCode: details.relatedDocCode,
        performerId: details.performer.uid,
        performerName: details.performer.email || 'System'
    };
    t.set(logRef, logData);
}

/**
 * Validates and records a single inventory transaction atomically.
 * Updates the Master Data (Snapshot) and creates a Log entry.
 * NOTE: This calls Read then Write immediately.
 * DO NOT use this inside a loop if you have other writes before this function.
 * Use `getInventoryItemState` and `calculateAndCommitInventoryChange` separately for batch ops.
 */
export async function recordInventoryTransaction(
    t: any, // Firestore Transaction Object
    details: {
        type: InventoryTransaction['type'];
        itemId: string;
        itemType: 'product' | 'ingredient';
        quantityChange: number; // + for IN, - for OUT
        unitCost: number; // Cost at this moment
        relatedDocId?: string;
        relatedDocCode?: string;
        performer: { uid: string; email: string };
        timestamp: Date;
    }
) {
    const state = await getInventoryItemState(t, details.itemId, details.itemType);
    calculateAndCommitInventoryChange(t, details, state);
}

// --- SERVICE ---

export const inventoryService = {
    /**
     * Create Import Receipt and Update Stock using the Core Engine
     */
    async createImportReceipt(
        user: User,
        supplierId: string,
        importDateStr: string,
        items: ImportItem[],
        suppliers: MasterPartner[],
        ingredients: MasterIngredient[]
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

            // 1. READ PHASE: Fetch all ingredient states first
            const ingredientStates = new Map<string, { ref: DocumentReference; data: any }>();
            for (const item of validItems) {
                // Deduplicate reads if same ingredient appears multiple times (rare but possible)
                if (!ingredientStates.has(item.ingredientId)) {
                    const state = await getInventoryItemState(transaction, item.ingredientId, 'ingredient');
                    ingredientStates.set(item.ingredientId, state);
                }
            }

            // 2. WRITE PHASE
            // Create Import Record
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

            // Update Stock for each item using pre-fetched state
            for (const item of validItems) {
                const unitCost = item.quantity > 0 ? (item.price / item.quantity) : 0;
                const state = ingredientStates.get(item.ingredientId);

                if (state) {
                    calculateAndCommitInventoryChange(transaction, {
                        type: 'import',
                        itemId: item.ingredientId,
                        itemType: 'ingredient',
                        quantityChange: item.quantity,
                        unitCost: unitCost,
                        relatedDocId: importRef.id,
                        relatedDocCode: code,
                        performer: { uid: user.uid, email: user.email || 'unknown' },
                        timestamp: selectedDate
                    }, state);
                }
            }
        });

        // Log Action (Moved outside transaction)
        await logAction(user, 'TRANSACTION', 'imports', `Tạo phiếu nhập ${code}`);

        return code;
    },

    async deleteImportReceipt(user: User, importReceipt: ImportReceipt) {
        // Soft Delete and Rollback Inventory + Finance

        await runTransaction(db, async (transaction) => {
             // 1. Read Import Doc to check status (if needed, but we trust input for now)
             const importRef = doc(db, 'imports', importReceipt.id);

             // 2. Read Ingredient States
             const ingredientStates = new Map<string, { ref: DocumentReference; data: any }>();
             for (const item of importReceipt.items) {
                 if (!ingredientStates.has(item.ingredientId)) {
                     const state = await getInventoryItemState(transaction, item.ingredientId, 'ingredient');
                     ingredientStates.set(item.ingredientId, state);
                 }
             }

             // 3. Revert Inventory (Stock OUT, Value OUT)
             for (const item of importReceipt.items) {
                 const state = ingredientStates.get(item.ingredientId);
                 if (state) {
                     // Reverse Quantity: -item.quantity
                     // Reverse Value: -item.totalPrice
                     // Calculate unitCost for log purposes (though valueChange overrides logic)
                     const unitCost = item.quantity > 0 ? (item.totalPrice / item.quantity) : 0;

                     calculateAndCommitInventoryChange(transaction, {
                        type: 'adjustment', // or 'import_void'
                        itemId: item.ingredientId,
                        itemType: 'ingredient',
                        quantityChange: -item.quantity,
                        unitCost: unitCost,
                        valueChange: -item.totalPrice, // Force Value Reversal
                        relatedDocId: importReceipt.id,
                        relatedDocCode: importReceipt.code,
                        performer: { uid: user.uid, email: user.email || 'unknown' },
                        timestamp: new Date()
                    }, state);
                 }
             }

             // 4. Update Import Status
             transaction.update(importRef, { status: 'canceled' });
        });

        // 5. Cancel Finance Entries (Outside Transaction as it runs its own batch)
        await financeService.cancelEntriesByRelatedDoc(importReceipt.id);

        const displayId = importReceipt.code || importReceipt.id;
        await logAction(user, 'DELETE', 'imports', `Hủy phiếu nhập và hoàn tác kho: ${displayId}`);
    },

    subscribeHistory(callback: (receipts: ImportReceipt[]) => void) {
        const q = query(collection(db, 'imports'), orderBy('createdAt', 'desc'));
        return onSnapshot(q, (snapshot) => {
            const receipts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ImportReceipt));
            callback(receipts);
        });
    },

    async fetchSuppliers() {
        const supplierQuery = query(collection(db, 'master_partners'), where('type', '==', 'supplier'), orderBy('name'));
        const supplierSnap = await getDocs(supplierQuery);
        return supplierSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MasterPartner));
    },

    async fetchIngredients() {
        const ingSnap = await getDocs(query(collection(db, 'master_ingredients'), orderBy('code')));
        return ingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MasterIngredient));
    }
};
