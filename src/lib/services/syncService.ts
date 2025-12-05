import { googleSheetService } from './googleSheetService';
import { catalogService } from './catalogService';
import { orderService } from './orderService';
import { expenseService } from './expenseService';
import { inventoryService } from './inventoryService';
import { productionService } from './productionService';
import { auth, db } from '$lib/firebase';
import { collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp, getDocs, query, where, Timestamp } from 'firebase/firestore';
import type { MasterPartner, MasterProduct, MasterIngredient, SalesOrder, SalesOrderItem, FinanceLedger, ImportReceipt, ImportItem } from '$lib/types/erp';
import type { ProductionRun, ProductionInput } from '$lib/services/productionService';

interface SyncLog {
    timestamp: Date;
    type: string;
    message: string;
    status: 'success' | 'error' | 'info';
}

class SyncService {
    private logs: SyncLog[] = [];
    private spreadsheetId: string = '';

    setSpreadsheetId(id: string) {
        this.spreadsheetId = id;
    }

    getLogs() {
        return this.logs;
    }

    clearLogs() {
        this.logs = [];
    }

    private log(type: string, message: string, status: 'success' | 'error' | 'info' = 'info') {
        this.logs.push({ timestamp: new Date(), type, message, status });
        console.log(`[SyncService][${type}] ${message}`);
    }

    private getCurrentUser() {
        if (!auth.currentUser) throw new Error('Not authenticated');
        return auth.currentUser;
    }

    private async fetchFirestoreData<T>(collectionName: string): Promise<T[]> {
        const snap = await getDocs(collection(db, collectionName));
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as T));
    }

    /**
     * Helper to parse Action Type from the last column.
     * Defaults to 0 if invalid or missing.
     */
    private getActionType(row: any[], actionColIndex: number): number {
        if (row.length <= actionColIndex) return 0;
        const val = parseInt(row[actionColIndex]);
        return isNaN(val) ? 0 : val;
    }

    /**
     * SYNC MASTER DATA (Ingredients, Partners, Categories, Assets)
     */
    async syncMasterData(type: 'products' | 'ingredients' | 'partners' | 'categories' | 'assets') {
        if (type === 'products') {
            return this.syncProducts();
        }

        if (!this.spreadsheetId) {
             this.log(type, 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log(type, 'Starting sync...');
            const user = this.getCurrentUser();
            let collectionName = '';
            let sheetName = '';
            let headers: string[] = [];

            if (type === 'ingredients') {
                collectionName = 'master_ingredients';
                sheetName = 'Ingredients';
                headers = ['ID', 'Code', 'Name', 'BaseUnit', 'SupplierID', 'AvgCost', 'ActionType'];
            } else if (type === 'partners') {
                collectionName = 'master_partners';
                sheetName = 'Partners';
                headers = ['ID', 'Code', 'Name', 'Type', 'Phone', 'Address', 'Email', 'CustomerType', 'ActionType'];
            } else if (type === 'categories') {
                collectionName = 'master_expense_categories';
                sheetName = 'ExpenseCategories';
                headers = ['ID', 'Name', 'ActionType'];
            } else if (type === 'assets') {
                collectionName = 'master_assets';
                sheetName = 'Assets';
                headers = ['ID', 'Code', 'Name', 'Category', 'Status', 'OriginalPrice', 'PurchaseDate', 'ActionType'];
            }

            const actionColIndex = headers.length - 1;

            // 1. Ensure Sheet Exists
            await googleSheetService.ensureSheet(this.spreadsheetId, sheetName, headers);

            // 2. Fetch Data
            const firestoreItems = await this.fetchFirestoreData<any>(collectionName);
            const sheetRows = await googleSheetService.readSheet(this.spreadsheetId, `${sheetName}!A2:Z`);
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, sheetName);

            if (sheetId === null) throw new Error(`Could not find Sheet ID for ${sheetName}`);

            const firestoreMap = new Map(firestoreItems.map(i => [i.id, i]));
            const sheetMap = new Map(sheetRows.map(row => [row[0], row]));

            const rowsToDelete: number[] = [];

            // 3. PROCESS SHEET ACTIONS (Updates, Deletes, Firestore Sync)
            for (let i = 0; i < sheetRows.length; i++) {
                const row = sheetRows[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2; // 1-based, + header

                if (actionType === 9) {
                    // DELETE
                    if (firestoreItem) {
                        await deleteDoc(doc(db, collectionName, id));
                        this.log(type, `Deleted Firestore doc ${id}`, 'success');
                    }
                    rowsToDelete.push(i); // 0-based index relative to data range start? No, deleteRow takes absolute index?
                    // deleteRow takes 0-based index of the sheet.
                    // Data starts at Row 2 (Index 1).
                    // So if loop index i=0, it is Row 2 (Index 1).
                    // rowsToDelete should store absolute indices.
                } else if (actionType === 1) {
                    // UPDATE FROM SHEET TO FIRESTORE
                    if (id) {
                        const updates: any = {};
                        if (type === 'ingredients') {
                            updates.code = row[1];
                            updates.name = row[2];
                            updates.baseUnit = row[3];
                            updates.supplierId = row[4];
                            updates.avgCost = Number(row[5]);
                        } else if (type === 'partners') {
                            updates.code = row[1];
                            updates.name = row[2];
                            updates.type = row[3];
                            updates.phone = row[4];
                            updates.address = row[5];
                            updates.email = row[6];
                            updates.customerType = row[7];
                        } else if (type === 'categories') {
                            updates.name = row[1];
                        } else if (type === 'assets') {
                            updates.code = row[1];
                            updates.name = row[2];
                            updates.category = row[3];
                            updates.status = row[4];
                            updates.originalPrice = Number(row[5]);
                            updates.purchaseDate = row[6] ? new Date(row[6]) : new Date();
                        }

                        if (firestoreItem) {
                            await updateDoc(doc(db, collectionName, id), updates);
                            this.log(type, `Updated Firestore doc ${id}`, 'success');
                        } else {
                            // Create if missing (treat as force create with ID)
                            if (type === 'ingredients') await catalogService.createIngredient(user, updates, { forceId: id, forceCode: row[1] });
                            else if (type === 'partners') await catalogService.createPartner(user, updates, { forceId: id, forceCode: row[1] });
                            else if (type === 'categories') await expenseService.addCategory(user, updates.name, { forceId: id });
                            else if (type === 'assets') await setDoc(doc(db, 'master_assets', id), { ...updates, createdAt: serverTimestamp(), createdBy: user.email });
                            this.log(type, `Created Firestore doc ${id} from Sheet`, 'success');
                        }
                        // Reset ActionType
                        await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!${String.fromCharCode(65 + actionColIndex)}${rowIndex}`, 0);
                    }
                } else if (actionType === 2) {
                    // UPDATE FROM FIRESTORE TO SHEET
                    if (firestoreItem) {
                        const newRow = [...row]; // Copy
                        // Fill data
                        if (type === 'ingredients') {
                            newRow[1] = firestoreItem.code;
                            newRow[2] = firestoreItem.name;
                            newRow[3] = firestoreItem.baseUnit || '';
                            newRow[4] = firestoreItem.supplierId || '';
                            newRow[5] = firestoreItem.avgCost || 0;
                        } else if (type === 'partners') {
                            newRow[1] = firestoreItem.code;
                            newRow[2] = firestoreItem.name;
                            newRow[3] = firestoreItem.type;
                            newRow[4] = firestoreItem.phone || '';
                            newRow[5] = firestoreItem.address || '';
                            newRow[6] = firestoreItem.email || '';
                            newRow[7] = firestoreItem.customerType || '';
                        } else if (type === 'categories') {
                            newRow[1] = firestoreItem.name;
                        } else if (type === 'assets') {
                            newRow[1] = firestoreItem.code;
                            newRow[2] = firestoreItem.name;
                            newRow[3] = firestoreItem.category;
                            newRow[4] = firestoreItem.status;
                            newRow[5] = firestoreItem.originalPrice || 0;
                            newRow[6] = firestoreItem.purchaseDate?.toDate ? firestoreItem.purchaseDate.toDate().toISOString() : (firestoreItem.purchaseDate || '');
                        }
                        // Reset Action
                        newRow[actionColIndex] = 0;
                        await googleSheetService.updateRow(this.spreadsheetId, `${sheetName}!A${rowIndex}`, newRow);
                        this.log(type, `Updated Sheet row ${rowIndex} from Firestore`, 'success');
                    }
                } else {
                    // ACTION = 0 (Default Sync)
                    // Logic: Create Missing + Update Firestore -> Sheet
                    if (firestoreItem) {
                         // Check if update needed? Blind update is safer to ensure consistency
                        const newRow = [...row];
                        let changed = false;

                        // Construct Expected Row
                        let expectedRow: any[] = [];
                        if (type === 'ingredients') {
                            expectedRow = [
                                firestoreItem.id, firestoreItem.code, firestoreItem.name,
                                firestoreItem.baseUnit || '', firestoreItem.supplierId || '', firestoreItem.avgCost || 0
                            ];
                        } else if (type === 'partners') {
                            expectedRow = [
                                firestoreItem.id, firestoreItem.code, firestoreItem.name, firestoreItem.type,
                                firestoreItem.phone || '', firestoreItem.address || '', firestoreItem.email || '', firestoreItem.customerType || ''
                            ];
                        } else if (type === 'categories') {
                            expectedRow = [firestoreItem.id, firestoreItem.name];
                        } else if (type === 'assets') {
                            expectedRow = [
                                firestoreItem.id, firestoreItem.code, firestoreItem.name, firestoreItem.category, firestoreItem.status,
                                firestoreItem.originalPrice || 0, firestoreItem.purchaseDate?.toDate ? firestoreItem.purchaseDate.toDate().toISOString() : (firestoreItem.purchaseDate || '')
                            ];
                        }

                        // Compare columns (excluding ActionType)
                        for (let k = 0; k < expectedRow.length; k++) {
                            // Simple loose comparison
                            if (String(row[k]) !== String(expectedRow[k])) {
                                changed = true;
                                break;
                            }
                        }

                        if (changed) {
                            expectedRow[actionColIndex] = 0; // Ensure 0
                            await googleSheetService.updateRow(this.spreadsheetId, `${sheetName}!A${rowIndex}`, expectedRow);
                            // this.log(type, `Synced Row ${rowIndex} from Firestore`, 'info');
                        }
                    } else if (id) {
                         // Exists in Sheet (with ID), missing in Firestore -> Create in Firestore
                         // Reuse Action=1 logic essentially
                         // But if ID is empty, it's a "New Row" handled later
                        this.log(type, `Restoring missing item to Firestore: ${row[2]}`, 'info');
                        // ... (Logic same as Action 1 Create, essentially)
                        try {
                             const updates: any = {};
                             // ... Mapping ...
                             if (type === 'ingredients') {
                                updates.name = row[2]; updates.baseUnit = row[3]; updates.supplierId = row[4]; updates.avgCost = Number(row[5]);
                                await catalogService.createIngredient(user, updates, { forceId: id, forceCode: row[1] });
                            } else if (type === 'partners') {
                                updates.name = row[2]; updates.type = row[3]; updates.phone = row[4]; updates.address = row[5]; updates.email = row[6]; updates.customerType = row[7];
                                await catalogService.createPartner(user, updates, { forceId: id, forceCode: row[1] });
                            } else if (type === 'categories') {
                                await expenseService.addCategory(user, row[1], { forceId: id });
                            } else if (type === 'assets') {
                                // ...
                                 await setDoc(doc(db, 'master_assets', id), {
                                    code: row[1], name: row[2], category: row[3], status: row[4],
                                    originalPrice: Number(row[5]),
                                    purchaseDate: row[6] ? new Date(row[6]) : new Date(),
                                    createdAt: serverTimestamp(), createdBy: user.email
                                });
                            }
                        } catch (e: any) { this.log(type, `Failed to restore ${row[2]}: ${e.message}`, 'error'); }
                    } else {
                         // ID is empty -> New Item logic handled in "Fill Gap: Sheet -> Firestore" phase
                    }
                }
            }

            // 4. EXECUTE DELETIONS (Reverse Order)
            // rowsToDelete contains loop indices (0 to N-1).
            // Actual Sheet Index = loop_index + 2 (Header + 1-based)?
            // Wait. loop i=0 -> Row 2.
            // deleteRow takes 0-based index. Row 1 is index 0. Row 2 is index 1.
            // So deleteIndex = i + 1.
            // Sort descending
            const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
            for (const idx of absoluteIndices) {
                await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
                this.log(type, `Deleted Sheet Row Index ${idx}`, 'info');
            }

            // 5. FILL GAP: Firestore -> Sheet (Add missing)
            // Since we processed updates in the loop, we only need to add items that were NOT in the Sheet Map originally.
            const rowsToAdd: any[][] = [];
            for (const item of firestoreItems) {
                if (!sheetMap.has(item.id)) {
                    let row: any[] = [];
                    // ... Mapping ...
                    if (type === 'ingredients') {
                         row = [item.id, item.code, item.name, item.baseUnit || '', item.supplierId || '', item.avgCost || 0, 0];
                    } else if (type === 'partners') {
                         row = [item.id, item.code, item.name, item.type, item.phone || '', item.address || '', item.email || '', item.customerType || '', 0];
                    } else if (type === 'categories') {
                        row = [item.id, item.name, 0];
                    } else if (type === 'assets') {
                        row = [item.id, item.code, item.name, item.category, item.status, item.originalPrice || 0,
                            item.purchaseDate?.toDate ? item.purchaseDate.toDate().toISOString() : (item.purchaseDate || ''), 0];
                    }
                    rowsToAdd.push(row);
                }
            }

            if (rowsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, sheetName, rowsToAdd);
                this.log(type, `Added ${rowsToAdd.length} missing items to Sheet`, 'success');
            }

            // 6. FILL GAP: Sheet -> Firestore (New Items with Empty ID)
            // These were skipped in the main loop (id check)
            let addedToFirestore = 0;
            // Re-read sheet? Or use original data?
            // If we deleted rows, indices shifted. But new rows (empty ID) are likely at the bottom or intermingled.
            // Using original `sheetRows` is safe for DATA, but updating the cell ID requires knowing the NEW index.
            // If deletions occurred, the indices of subsequent rows changed.
            // Strategy: Re-read Sheet if deletions occurred? Or calculate offset.
            // Simplest: Re-read Sheet.
            if (rowsToDelete.length > 0) {
                 const currentSheetRows = await googleSheetService.readSheet(this.spreadsheetId, `${sheetName}!A2:Z`);
                 // Process new rows
                 for (let i = 0; i < currentSheetRows.length; i++) {
                     const row = currentSheetRows[i];
                     if (!row[0]) { // Missing ID
                         await this.createNewItemInFirestore(type, row, i + 2, sheetName, user); // Helper method needed
                         addedToFirestore++;
                     }
                 }
            } else {
                 // Use original rows
                 for (let i = 0; i < sheetRows.length; i++) {
                     const row = sheetRows[i];
                     if (!row[0]) {
                         await this.createNewItemInFirestore(type, row, i + 2, sheetName, user);
                         addedToFirestore++;
                     }
                 }
            }

            if (addedToFirestore > 0) this.log(type, `Created ${addedToFirestore} new items`, 'success');
            this.log(type, 'Sync Complete', 'success');

        } catch (error: any) {
            this.log(type, `Fatal Error: ${error.message}`, 'error');
        }
    }

    // Helper for creating new items (refactored from original code)
    private async createNewItemInFirestore(type: string, row: any[], rowIndex: number, sheetName: string, user: any) {
         try {
            let newId = '';
            let newCode = '';

            if (type === 'ingredients') {
                newCode = await catalogService.createIngredient(user, { name: row[2], baseUnit: row[3], supplierId: row[4] });
                const q = await getDocs(query(collection(db, 'master_ingredients'), where('code', '==', newCode)));
                if (!q.empty) newId = q.docs[0].id;
            } else if (type === 'partners') {
                newCode = await catalogService.createPartner(user, { name: row[2], type: row[3], phone: row[4], address: row[5], email: row[6], customerType: row[7] });
                const q = await getDocs(query(collection(db, 'master_partners'), where('code', '==', newCode)));
                if (!q.empty) newId = q.docs[0].id;
            } else if (type === 'categories') {
                await expenseService.addCategory(user, row[1]);
                const q = await getDocs(query(collection(db, 'master_expense_categories'), where('name', '==', row[1])));
                if (!q.empty) newId = q.docs[0].id;
            }
            // Assets creation from sheet missing ID is tricky, skipped for now or same logic

            if (newId) {
                await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!A${rowIndex}`, newId);
                if (newCode && type !== 'categories') {
                     await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!B${rowIndex}`, newCode);
                }
            }
         } catch(e: any) {
             console.error(e);
         }
    }

    /**
     * SYNC PRODUCTS
     */
    async syncProducts() {
        if (!this.spreadsheetId) {
             this.log('products', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('products', 'Starting Product Sync...');
            const user = this.getCurrentUser();

            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');
            const ingMap = new Map(ingredients.map(i => [i.id, i]));
            const ingCodeMap = new Map(ingredients.map(i => [i.code, i]));

            const headers = ['ID', 'Code', 'Name', 'Unit', 'Price', 'CostPrice', 'AvgCost', 'ActionType'];
            const actionColIndex = 7;

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Products', headers);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ProductsIngredientItems', ['ProductID', 'IngredientID', 'Quantity', 'Unit', 'IngredientCode']);

            const sheetProducts = await googleSheetService.readSheet(this.spreadsheetId, 'Products!A2:H');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'ProductsIngredientItems!A2:E');
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, 'Products');

            const firestoreProducts = await this.fetchFirestoreData<MasterProduct>('master_products');
            const firestoreMap = new Map(firestoreProducts.map(p => [p.id, p]));
            const sheetProductMap = new Map(sheetProducts.map(r => [r[0], r]));

            const sheetItemsMap = new Map<string, any[]>();
            for (const row of sheetItems) {
                const pid = row[0];
                if (!sheetItemsMap.has(pid)) sheetItemsMap.set(pid, []);
                sheetItemsMap.get(pid)?.push(row);
            }

            const rowsToDelete: number[] = [];

            // PROCESS ACTIONS
            for (let i = 0; i < sheetProducts.length; i++) {
                const row = sheetProducts[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2;

                if (actionType === 9) {
                    if (firestoreItem) await deleteDoc(doc(db, 'master_products', id));
                    rowsToDelete.push(i);
                } else if (actionType === 1 && id && firestoreItem) {
                     // Update Header Fields
                     await updateDoc(doc(db, 'master_products', id), {
                         name: row[2],
                         unit: row[3],
                         sellingPrice: Number(row[4]),
                         costPrice: Number(row[5])
                     });
                     // Note: We are NOT updating recipe items from 'ProductsIngredientItems' here automatically unless we implement that logic.
                     // Current scope: Entity level sync.
                     await googleSheetService.updateCell(this.spreadsheetId, `Products!H${rowIndex}`, 0);
                     this.log('products', `Updated Product ${id} header`, 'success');
                } else if (actionType === 2 && firestoreItem) {
                     // Firestore -> Sheet
                     const newRow = [...row];
                     newRow[1] = firestoreItem.code;
                     newRow[2] = firestoreItem.name;
                     newRow[3] = firestoreItem.unit || '';
                     newRow[4] = firestoreItem.sellingPrice || 0;
                     newRow[5] = firestoreItem.costPrice || 0;
                     newRow[6] = firestoreItem.avgCost || 0;
                     newRow[7] = 0;
                     await googleSheetService.updateRow(this.spreadsheetId, `Products!A${rowIndex}`, newRow);
                } else if ((actionType === 0 || !actionType) && firestoreItem) {
                     // Default Sync: Firestore -> Sheet
                     const expectedRow = [
                         firestoreItem.id, firestoreItem.code, firestoreItem.name, firestoreItem.unit || '',
                         firestoreItem.sellingPrice || 0, firestoreItem.costPrice || 0, firestoreItem.avgCost || 0
                     ];
                     let changed = false;
                     for (let k = 0; k < expectedRow.length; k++) {
                         if (String(row[k]) !== String(expectedRow[k])) { changed = true; break; }
                     }
                     if (changed) {
                         const newRow = [...row];
                         for(let k=0; k<expectedRow.length; k++) newRow[k] = expectedRow[k];
                         newRow[actionColIndex] = 0;
                         await googleSheetService.updateRow(this.spreadsheetId, `Products!A${rowIndex}`, newRow);
                     }
                }
            }

            // Execute Deletions
            if (sheetId !== null && rowsToDelete.length > 0) {
                 const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
                 for (const idx of absoluteIndices) await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
            }

            // Fill Gap: Firestore -> Sheet (New Products)
            const productsToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];
            for (const prod of firestoreProducts) {
                if (!sheetProductMap.has(prod.id)) {
                    productsToAdd.push([prod.id, prod.code, prod.name, prod.unit || '', prod.sellingPrice || 0, prod.costPrice || 0, prod.avgCost || 0, 0]);
                    for (const item of (prod.items || [])) {
                        const ing = ingMap.get(item.ingredientId);
                        itemsToAdd.push([prod.id, item.ingredientId, item.quantity, item.unit || '', ing?.code || '']);
                    }
                }
            }
            if (productsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Products', productsToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'ProductsIngredientItems', itemsToAdd);
            }

            // Fill Gap: Sheet -> Firestore (New Products)
            // Re-read if deletions occurred
            const currentRows = (rowsToDelete.length > 0) ? await googleSheetService.readSheet(this.spreadsheetId, 'Products!A2:H') : sheetProducts;
            for (let i = 0; i < currentRows.length; i++) {
                const row = currentRows[i];
                if (!row[0]) {
                     // Create Logic
                     // ... (Use existing logic or helper)
                     // Re-use logic from previous implementation:
                    const rowIndex = (rowsToDelete.length > 0) ? i + 2 : i + 2; // Be careful if using cached vs fresh
                    // If we use currentRows (fresh), i maps to current row. Row 2 is index 0. So rowIndex = i + 2.

                    // We need items from map. But items map keys are BY ID? or BY CODE?
                    // If ID is empty, user might have used Code in Items sheet? Or empty ID in items sheet?
                    // Previous logic tried to look up by Code if ID was new.
                    let lookupKey = row[1]; // Code
                    const rawItems = sheetItemsMap.get(lookupKey) || [];
                    // ... create logic ...
                     const recipeItems: any[] = [];
                    for (const iRow of rawItems) {
                        // ... resolve ingredients ...
                         let resolvedIngId = iRow[1];
                        if (!resolvedIngId && iRow[4]) resolvedIngId = ingCodeMap.get(iRow[4])?.id;
                        if (resolvedIngId) recipeItems.push({ ingredientId: resolvedIngId, quantity: Number(iRow[2]), unit: iRow[3] });
                    }
                     const data = { name: row[2], unit: row[3], sellingPrice: Number(row[4]), costPrice: Number(row[5]), items: recipeItems };
                     const newCode = await catalogService.createProduct(user, data);
                     const q = await getDocs(query(collection(db, 'master_products'), where('code', '==', newCode)));
                     if (!q.empty) {
                         const newId = q.docs[0].id;
                         await googleSheetService.updateCell(this.spreadsheetId, `Products!A${rowIndex}`, newId);
                         await googleSheetService.updateCell(this.spreadsheetId, `Products!B${rowIndex}`, newCode);
                     }
                }
            }

            this.log('products', 'Product Sync Complete', 'success');
        } catch (error: any) {
            this.log('products', `Fatal Error: ${error.message}`, 'error');
        }
    }

    /**
     * SYNC FINANCE
     */
    async syncFinance() {
         if (!this.spreadsheetId) {
             this.log('finance', 'No Spreadsheet ID provided', 'error');
             return;
        }
        try {
            this.log('finance', 'Starting Finance Sync...');
            const user = this.getCurrentUser();
            const categories = await this.fetchFirestoreData<{id: string, name: string}>('master_expense_categories');
            const suppliers = await this.fetchFirestoreData<MasterPartner>('master_partners');

            const headers = ['ID', 'Code', 'Date', 'Type', 'Amount', 'Category', 'Description', 'SupplierID', 'ActionType'];
            const actionColIndex = 8;
            await googleSheetService.ensureSheet(this.spreadsheetId, 'Finance', headers);

            const sheetRows = await googleSheetService.readSheet(this.spreadsheetId, 'Finance!A2:I');
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, 'Finance');
            const firestoreLogs = await this.fetchFirestoreData<FinanceLedger>('finance_ledger');
            const firestoreMap = new Map(firestoreLogs.map(l => [l.id, l]));
            const sheetMap = new Map(sheetRows.map(r => [r[0], r]));
            const rowsToDelete: number[] = [];

            // ACTIONS
            for (let i = 0; i < sheetRows.length; i++) {
                const row = sheetRows[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2;

                if (actionType === 9) {
                     if (firestoreItem) await deleteDoc(doc(db, 'finance_ledger', id));
                     rowsToDelete.push(i);
                } else if (actionType === 1 && id && firestoreItem) {
                     // Update
                     await updateDoc(doc(db, 'finance_ledger', id), {
                         date: new Date(row[2]),
                         amount: Number(row[4]),
                         description: row[6],
                         supplierId: row[7]
                     });
                     await googleSheetService.updateCell(this.spreadsheetId, `Finance!I${rowIndex}`, 0);
                } else if (actionType === 2 && firestoreItem) {
                     const newRow = [...row];
                     newRow[2] = (firestoreItem.date as any).toDate ? (firestoreItem.date as any).toDate().toISOString() : new Date(firestoreItem.date as any).toISOString();
                     newRow[4] = firestoreItem.amount;
                     newRow[5] = firestoreItem.category;
                     newRow[6] = firestoreItem.description;
                     newRow[7] = firestoreItem.supplierId || '';
                     newRow[8] = 0;
                     await googleSheetService.updateRow(this.spreadsheetId, `Finance!A${rowIndex}`, newRow);
                } else if ((actionType === 0 || !actionType) && firestoreItem) {
                     const dateStr = (firestoreItem.date as any).toDate ? (firestoreItem.date as any).toDate().toISOString() : new Date(firestoreItem.date as any).toISOString();
                     const expectedRow = [
                         firestoreItem.id, (firestoreItem as any).code || '', dateStr, firestoreItem.type,
                         firestoreItem.amount, firestoreItem.category, firestoreItem.description, firestoreItem.supplierId || ''
                     ];
                     let changed = false;
                     for (let k = 0; k < expectedRow.length; k++) {
                         if (String(row[k]) !== String(expectedRow[k])) { changed = true; break; }
                     }
                     if (changed) {
                         const newRow = [...row];
                         for(let k=0; k<expectedRow.length; k++) newRow[k] = expectedRow[k];
                         newRow[actionColIndex] = 0;
                         await googleSheetService.updateRow(this.spreadsheetId, `Finance!A${rowIndex}`, newRow);
                     }
                }
            }

            if (sheetId !== null && rowsToDelete.length > 0) {
                 const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
                 for (const idx of absoluteIndices) await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
            }

            // Fill Gap: Firestore -> Sheet
             const rowsToAdd: any[][] = [];
            for (const log of firestoreLogs) {
                if (!sheetMap.has(log.id) && log.type === 'expense') {
                     rowsToAdd.push([
                        log.id, (log as any).code || '', (log.date as any).toDate ? (log.date as any).toDate().toISOString() : new Date(log.date as any).toISOString(),
                        log.type, log.amount, log.category, log.description, log.supplierId || '', 0
                    ]);
                }
            }
             if (rowsToAdd.length > 0) await googleSheetService.appendData(this.spreadsheetId, 'Finance', rowsToAdd);

             // Fill Gap: Sheet -> Firestore
             const currentRows = (rowsToDelete.length > 0) ? await googleSheetService.readSheet(this.spreadsheetId, 'Finance!A2:I') : sheetRows;
             for(let i=0; i<currentRows.length; i++) {
                 if (!currentRows[i][0]) {
                     // Create Expense
                     const row = currentRows[i];
                     const cat = categories.find(c => c.name === row[5]);
                     if (cat) {
                         const code = await expenseService.createExpense(user, { date: row[2], categoryId: cat.id, amount: Number(row[4]), description: row[6], selectedSupplierId: row[7] }, categories, suppliers, false);
                         const q = await getDocs(query(collection(db, 'finance_ledger'), where('code', '==', code)));
                         if(!q.empty) {
                             const id = q.docs[0].id;
                             await googleSheetService.updateCell(this.spreadsheetId, `Finance!A${i+2}`, id);
                             await googleSheetService.updateCell(this.spreadsheetId, `Finance!B${i+2}`, code);
                         }
                     }
                 }
             }

            this.log('finance', 'Finance Sync Complete', 'success');
        } catch (error: any) {
             this.log('finance', `Fatal Error: ${error.message}`, 'error');
        }
    }

    /**
     * SYNC IMPORTS
     */
    async syncImports() {
        if (!this.spreadsheetId) { this.log('imports', 'No Spreadsheet ID', 'error'); return; }
        try {
            this.log('imports', 'Starting Import Sync...');
            const user = this.getCurrentUser();
            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');
            const suppliers = await this.fetchFirestoreData<MasterPartner>('master_partners');

            const headers = ['ID', 'Code', 'Date', 'SupplierID', 'TotalAmount', 'ActionType'];
            const actionColIndex = 5;
            await googleSheetService.ensureSheet(this.spreadsheetId, 'Imports', headers);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ImportItems', ['ImportID', 'IngredientID', 'Quantity', 'Price']);

            const sheetImports = await googleSheetService.readSheet(this.spreadsheetId, 'Imports!A2:F');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'ImportItems!A2:D');
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, 'Imports');

            const firestoreImports = await this.fetchFirestoreData<ImportReceipt>('imports');
            const firestoreMap = new Map(firestoreImports.map(i => [i.id, i]));
            const sheetMap = new Map(sheetImports.map(r => [r[0], r]));

            const rowsToDelete: number[] = [];

            for (let i = 0; i < sheetImports.length; i++) {
                const row = sheetImports[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2;

                if (actionType === 9) {
                    if (firestoreItem) await inventoryService.cancelImport(user, id); // Use service to handle inventory reversal
                    rowsToDelete.push(i);
                } else if (actionType === 1 && id && firestoreItem) {
                     // Update Header?? Imports are usually immutable. But maybe date/supplier?
                     // Changing Supplier or Date might be okay. Changing Amount without items?
                     // Let's assume just update fields.
                     await updateDoc(doc(db, 'imports', id), { supplierId: row[3], importDate: new Date(row[2]) });
                     await googleSheetService.updateCell(this.spreadsheetId, `Imports!F${rowIndex}`, 0);
                } else if (actionType === 2 && firestoreItem) {
                    const newRow = [...row];
                    newRow[2] = (firestoreItem.importDate as any).toDate ? (firestoreItem.importDate as any).toDate().toISOString() : new Date(firestoreItem.importDate as any).toISOString();
                    newRow[3] = firestoreItem.supplierId || '';
                    newRow[4] = firestoreItem.totalAmount;
                    newRow[5] = 0;
                    await googleSheetService.updateRow(this.spreadsheetId, `Imports!A${rowIndex}`, newRow);
                } else if ((actionType === 0 || !actionType) && firestoreItem) {
                    const dateStr = (firestoreItem.importDate as any).toDate ? (firestoreItem.importDate as any).toDate().toISOString() : new Date(firestoreItem.importDate as any).toISOString();
                    const expectedRow = [firestoreItem.id, (firestoreItem as any).code, dateStr, firestoreItem.supplierId || '', firestoreItem.totalAmount];
                    let changed = false;
                    for (let k=0; k<expectedRow.length; k++) if (String(row[k]) !== String(expectedRow[k])) { changed = true; break; }
                    if (changed) {
                        const newRow = [...row];
                        for(let k=0; k<expectedRow.length; k++) newRow[k] = expectedRow[k];
                        newRow[actionColIndex] = 0;
                        await googleSheetService.updateRow(this.spreadsheetId, `Imports!A${rowIndex}`, newRow);
                    }
                }
            }

            if (sheetId !== null && rowsToDelete.length > 0) {
                 const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
                 for (const idx of absoluteIndices) await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
            }

            // Fill Gap: Firestore -> Sheet
            const importsToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];
            for (const doc of firestoreImports) {
                if (!sheetMap.has(doc.id)) {
                    importsToAdd.push([
                        doc.id, (doc as any).code || '', (doc.importDate as any).toDate ? (doc.importDate as any).toDate().toISOString() : new Date(doc.importDate as any).toISOString(),
                        (doc as any).supplierId || '', doc.totalAmount, 0
                    ]);
                    for (const item of doc.items) itemsToAdd.push([doc.id, item.ingredientId, item.quantity, item.totalPrice]);
                }
            }
            if (importsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Imports', importsToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'ImportItems', itemsToAdd);
            }

            // Fill Gap: Sheet -> Firestore
            const sheetItemsMap = new Map<string, any[]>();
             for (const row of sheetItems) {
                const id = row[0];
                if (!sheetItemsMap.has(id)) sheetItemsMap.set(id, []);
                sheetItemsMap.get(id)?.push(row);
            }

            const currentRows = (rowsToDelete.length > 0) ? await googleSheetService.readSheet(this.spreadsheetId, 'Imports!A2:F') : sheetImports;
            for(let i=0; i<currentRows.length; i++) {
                if (!currentRows[i][0]) {
                     const row = currentRows[i];
                     let lookupKey = row[1]; // Code
                     const rawItems = sheetItemsMap.get(lookupKey) || [];
                     const importItems: ImportItem[] = rawItems.map(r => ({ ingredientId: r[1], quantity: Number(r[2]), price: Number(r[3]) }));

                     if (importItems.length > 0) {
                         const code = await inventoryService.createImportReceipt(user, row[3], row[2], importItems, suppliers, ingredients);
                         const q = await getDocs(query(collection(db, 'imports'), where('code', '==', code)));
                         if(!q.empty) {
                             const id = q.docs[0].id;
                             await googleSheetService.updateCell(this.spreadsheetId, `Imports!A${i+2}`, id);
                             await googleSheetService.updateCell(this.spreadsheetId, `Imports!B${i+2}`, code);
                         }
                     }
                }
            }

            this.log('imports', 'Import Sync Complete', 'success');
        } catch (e: any) { this.log('imports', `Error: ${e.message}`, 'error'); }
    }

    /**
     * SYNC PRODUCTION
     */
    async syncProduction() {
         if (!this.spreadsheetId) { this.log('production', 'No ID', 'error'); return; }
         try {
            this.log('production', 'Starting Production Sync...');
            const user = this.getCurrentUser();
            const products = await this.fetchFirestoreData<MasterProduct>('master_products');
            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');

            const headers = ['ID', 'Code', 'Date', 'ProductID', 'Yield', 'ActionType'];
            const actionColIndex = 5;
            await googleSheetService.ensureSheet(this.spreadsheetId, 'Production', headers);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ProductionInputs', ['ProductionID', 'IngredientID', 'Quantity', 'Cost']);

            const sheetRuns = await googleSheetService.readSheet(this.spreadsheetId, 'Production!A2:F');
            const sheetInputs = await googleSheetService.readSheet(this.spreadsheetId, 'ProductionInputs!A2:D');
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, 'Production');
            const firestoreRuns = await this.fetchFirestoreData<ProductionRun>('production_runs');
            const firestoreMap = new Map(firestoreRuns.map(r => [r.id, r]));
            const sheetMap = new Map(sheetRuns.map(r => [r[0], r]));

            const rowsToDelete: number[] = [];
            for (let i = 0; i < sheetRuns.length; i++) {
                const row = sheetRuns[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2;

                if (actionType === 9) {
                     if (firestoreItem) await productionService.cancelProductionRun(user, id);
                     rowsToDelete.push(i);
                } else if (actionType === 1 && id && firestoreItem) {
                     // Update ??
                     await updateDoc(doc(db, 'production_runs', id), {
                         productionDate: new Date(row[2]),
                         actualYield: Number(row[4])
                     });
                     await googleSheetService.updateCell(this.spreadsheetId, `Production!F${rowIndex}`, 0);
                } else if (actionType === 2 && firestoreItem) {
                    const newRow = [...row];
                    newRow[2] = (firestoreItem.productionDate as any).toDate ? (firestoreItem.productionDate as any).toDate().toISOString() : new Date(firestoreItem.productionDate as any).toISOString();
                    newRow[3] = firestoreItem.productId;
                    newRow[4] = firestoreItem.actualYield;
                    newRow[5] = 0;
                    await googleSheetService.updateRow(this.spreadsheetId, `Production!A${rowIndex}`, newRow);
                } else if ((actionType === 0 || !actionType) && firestoreItem) {
                     const dateStr = (firestoreItem.productionDate as any).toDate ? (firestoreItem.productionDate as any).toDate().toISOString() : new Date(firestoreItem.productionDate as any).toISOString();
                     const expectedRow = [firestoreItem.id, firestoreItem.code, dateStr, firestoreItem.productId, firestoreItem.actualYield];
                     let changed = false;
                     for (let k=0; k<expectedRow.length; k++) if (String(row[k]) !== String(expectedRow[k])) { changed = true; break; }
                     if (changed) {
                         const newRow = [...row];
                         for(let k=0; k<expectedRow.length; k++) newRow[k] = expectedRow[k];
                         newRow[actionColIndex] = 0;
                         await googleSheetService.updateRow(this.spreadsheetId, `Production!A${rowIndex}`, newRow);
                     }
                }
            }

            if (sheetId !== null && rowsToDelete.length > 0) {
                 const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
                 for (const idx of absoluteIndices) await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
            }

            // Gap: Firestore -> Sheet
             const runsToAdd: any[][] = [];
             const inputsToAdd: any[][] = [];
             for (const run of firestoreRuns) {
                 if (!sheetMap.has(run.id)) {
                     runsToAdd.push([run.id, run.code || '', (run.productionDate as any).toDate ? (run.productionDate as any).toDate().toISOString() : new Date(run.productionDate as any).toISOString(), run.productId, run.actualYield, 0]);
                     for (const input of run.consumedInputs) inputsToAdd.push([run.id, input.ingredientId, input.actualQuantityUsed, input.snapshotCost]);
                 }
             }
             if (runsToAdd.length > 0) {
                 await googleSheetService.appendData(this.spreadsheetId, 'Production', runsToAdd);
                 await googleSheetService.appendData(this.spreadsheetId, 'ProductionInputs', inputsToAdd);
             }

             // Gap: Sheet -> Firestore
             const sheetInputMap = new Map<string, any[]>();
             for (const row of sheetInputs) { const id = row[0]; if (!sheetInputMap.has(id)) sheetInputMap.set(id, []); sheetInputMap.get(id)?.push(row); }

             const currentRows = (rowsToDelete.length > 0) ? await googleSheetService.readSheet(this.spreadsheetId, 'Production!A2:F') : sheetRuns;
             for (let i = 0; i < currentRows.length; i++) {
                 if (!currentRows[i][0]) {
                     const row = currentRows[i];
                     const lookupKey = row[1];
                     const rawInputs = sheetInputMap.get(lookupKey) || [];
                     const inputs: ProductionInput[] = rawInputs.map(r => ({ ingredientId: r[1], actualQuantityUsed: Number(r[2]), snapshotCost: Number(r[3]), theoreticalQuantity: 0 }));
                     const product = products.find(p => p.id === row[3]);
                     if (product && inputs.length > 0) {
                         const code = await productionService.createProductionRun(user, product, row[2], Number(row[4]), inputs, ingredients);
                         const q = await getDocs(query(collection(db, 'production_runs'), where('code', '==', code)));
                         if (!q.empty) {
                             await googleSheetService.updateCell(this.spreadsheetId, `Production!A${i+2}`, q.docs[0].id);
                             await googleSheetService.updateCell(this.spreadsheetId, `Production!B${i+2}`, code);
                         }
                     }
                 }
             }
             this.log('production', 'Production Sync Complete', 'success');
         } catch(e: any) { this.log('production', `Error: ${e.message}`, 'error'); }
    }

    /**
     * SYNC SALES
     */
    async syncSales() {
         if (!this.spreadsheetId) { this.log('sales', 'No ID', 'error'); return; }
         try {
            this.log('sales', 'Starting Sales Sync...');
            const user = this.getCurrentUser();
            const products = await this.fetchFirestoreData<MasterProduct>('master_products');
            const partners = await this.fetchFirestoreData<MasterPartner>('master_partners');
            const partnerMap = new Map(partners.map(p => [p.id, p]));
            const productMap = new Map(products.map(p => [p.id, p]));

            const headers = ['ID', 'Code', 'Date', 'CustomerID', 'Status', 'TotalAmount', 'ActionType'];
            const actionColIndex = 6;
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrders', headers);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrderItems', ['OrderID', 'ProductID', 'Quantity', 'UnitPrice', 'Total']);

            const sheetOrders = await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrders!A2:G');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrderItems!A2:E');
            const sheetId = await googleSheetService.getSheetId(this.spreadsheetId, 'SalesOrders');
            const firestoreOrders = await this.fetchFirestoreData<SalesOrder>('sales_orders');
            const firestoreMap = new Map(firestoreOrders.map(o => [o.id, o]));
            const sheetMap = new Map(sheetOrders.map(r => [r[0], r]));

            const rowsToDelete: number[] = [];

            for (let i = 0; i < sheetOrders.length; i++) {
                const row = sheetOrders[i];
                const id = row[0];
                const actionType = this.getActionType(row, actionColIndex);
                const firestoreItem = firestoreMap.get(id);
                const rowIndex = i + 2;

                if (actionType === 9) {
                     if (firestoreItem) await orderService.cancelOrder(user, id);
                     rowsToDelete.push(i);
                } else if (actionType === 1 && id && firestoreItem) {
                     // Update: Status changes mainly
                     const updates: any = {};
                     if (row[4] !== firestoreItem.status) {
                         await orderService.updateOrderStatus(user, id, row[4]);
                     }
                     // Update Date if changed (careful with timestamp)
                     const newDate = new Date(row[2]);
                     const oldDate = (firestoreItem.createdAt as any).toDate ? (firestoreItem.createdAt as any).toDate() : new Date(firestoreItem.createdAt as any);
                     if (newDate.getTime() !== oldDate.getTime()) {
                         updates.createdAt = newDate;
                     }

                     if (Object.keys(updates).length > 0) {
                         await updateDoc(doc(db, 'sales_orders', id), updates);
                     }

                     await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!G${rowIndex}`, 0);
                } else if (actionType === 2 && firestoreItem) {
                     const newRow = [...row];
                     newRow[2] = (firestoreItem.createdAt as any).toDate ? (firestoreItem.createdAt as any).toDate().toISOString() : new Date(firestoreItem.createdAt as any).toISOString();
                     newRow[3] = firestoreItem.customerId;
                     newRow[4] = firestoreItem.status;
                     newRow[5] = firestoreItem.totalAmount;
                     newRow[6] = 0;
                     await googleSheetService.updateRow(this.spreadsheetId, `SalesOrders!A${rowIndex}`, newRow);
                } else if ((actionType === 0 || !actionType) && firestoreItem) {
                     const dateStr = (firestoreItem.createdAt as any).toDate ? (firestoreItem.createdAt as any).toDate().toISOString() : new Date(firestoreItem.createdAt as any).toISOString();
                     const expectedRow = [firestoreItem.id, firestoreItem.code, dateStr, firestoreItem.customerId, firestoreItem.status, firestoreItem.totalAmount];
                     let changed = false;
                     for (let k=0; k<expectedRow.length; k++) if (String(row[k]) !== String(expectedRow[k])) { changed = true; break; }
                     if (changed) {
                         const newRow = [...row];
                         for(let k=0; k<expectedRow.length; k++) newRow[k] = expectedRow[k];
                         newRow[actionColIndex] = 0;
                         await googleSheetService.updateRow(this.spreadsheetId, `SalesOrders!A${rowIndex}`, newRow);
                     }
                }
            }

            if (sheetId !== null && rowsToDelete.length > 0) {
                 const absoluteIndices = rowsToDelete.map(i => i + 1).sort((a, b) => b - a);
                 for (const idx of absoluteIndices) await googleSheetService.deleteRow(this.spreadsheetId, sheetId, idx);
            }

            // Gap: Firestore -> Sheet
            const ordersToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];
            for (const order of firestoreOrders) {
                if (!sheetMap.has(order.id)) {
                    ordersToAdd.push([
                        order.id, order.code, (order.createdAt as any).toDate ? (order.createdAt as any).toDate().toISOString() : new Date(order.createdAt as any).toISOString(),
                        order.customerId, order.status, order.totalAmount, 0
                    ]);
                    for (const item of order.items) itemsToAdd.push([order.id, item.productId, item.quantity, item.unitPrice, item.total]);
                }
            }
            if (ordersToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'SalesOrders', ordersToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'SalesOrderItems', itemsToAdd);
            }

            // Gap: Sheet -> Firestore
            const sheetItemsMap = new Map<string, any[]>();
            for (const row of sheetItems) { const id = row[0]; if (!sheetItemsMap.has(id)) sheetItemsMap.set(id, []); sheetItemsMap.get(id)?.push(row); }

            const currentRows = (rowsToDelete.length > 0) ? await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrders!A2:G') : sheetOrders;
            for (let i = 0; i < currentRows.length; i++) {
                if (!currentRows[i][0]) {
                     const row = currentRows[i];
                     const lookupKey = row[1];
                     const rawItems = sheetItemsMap.get(lookupKey) || [];
                     const salesItems: SalesOrderItem[] = [];
                     for (const r of rawItems) {
                         const p = productMap.get(r[1]);
                         if (p) salesItems.push({ productId: p.id, productName: p.name, quantity: Number(r[2]), unitPrice: Number(r[3]), originalPrice: Number(r[3]), total: Number(r[4]), costPrice: 0 });
                     }
                     const customer = partnerMap.get(row[3]);
                     if (customer && salesItems.length > 0) {
                         const code = await orderService.createOrder(user, customer, salesItems, row[4] || 'completed', row[2], products, 0, customer.address || '', customer.phone || '');
                         const q = await getDocs(query(collection(db, 'sales_orders'), where('code', '==', code)));
                         if (!q.empty) {
                             await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!A${i+2}`, q.docs[0].id);
                             await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!B${i+2}`, code);
                         }
                     }
                }
            }
            this.log('sales', 'Sales Sync Complete', 'success');
         } catch(e: any) { this.log('sales', `Error: ${e.message}`, 'error'); }
    }
}

export const syncService = new SyncService();
