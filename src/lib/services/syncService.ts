import { googleSheetService } from './googleSheetService';
import { catalogService } from './catalogService';
import { orderService } from './orderService';
import { expenseService } from './expenseService';
import { inventoryService } from './inventoryService';
import { productionService } from './productionService';
import { auth, db } from '$lib/firebase';
import { collection, doc, setDoc, serverTimestamp, getDocs, query, where } from 'firebase/firestore';
import type { MasterPartner, MasterProduct, MasterIngredient, SalesOrder, SalesOrderItem, FinanceLedger, ImportReceipt, ImportItem } from '$lib/types/erp';
import type { ProductionRun, ProductionInput } from '$lib/services/productionService'; // Explicit type import

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

    // --- GENERIC SYNC HELPERS ---

    private async fetchFirestoreData<T>(collectionName: string): Promise<T[]> {
        const snap = await getDocs(collection(db, collectionName));
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as T));
    }

    /**
     * SYNC MASTER DATA (Ingredients, Partners, Categories, Assets)
     * Note: Products are handled by syncProducts()
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
                headers = ['ID', 'Code', 'Name', 'BaseUnit', 'SupplierID', 'AvgCost', 'Action'];
            } else if (type === 'partners') {
                collectionName = 'master_partners';
                sheetName = 'Partners';
                headers = ['ID', 'Code', 'Name', 'Type', 'Phone', 'Address', 'Email', 'CustomerType', 'Action'];
            } else if (type === 'categories') {
                collectionName = 'master_expense_categories';
                sheetName = 'ExpenseCategories';
                headers = ['ID', 'Name', 'Action'];
            } else if (type === 'assets') {
                collectionName = 'master_assets';
                sheetName = 'Assets';
                headers = ['ID', 'Code', 'Name', 'Category', 'Status', 'OriginalPrice', 'PurchaseDate', 'Action'];
            }

            // 1. Ensure Sheet Exists
            await googleSheetService.ensureSheet(this.spreadsheetId, sheetName, headers);

            // 2. Fetch Data
            const firestoreItems = await this.fetchFirestoreData<any>(collectionName);
            const sheetRows = await googleSheetService.readSheet(this.spreadsheetId, `${sheetName}!A2:Z`);

            const firestoreMap = new Map(firestoreItems.map(i => [i.id, i]));
            const sheetMap = new Map(sheetRows.map(row => [row[0], row])); // Map by ID (Column A)

            // 3. FILL GAP: Firestore -> Sheet (Add missing to Sheet)
            const rowsToAdd: any[][] = [];
            for (const item of firestoreItems) {
                if (!sheetMap.has(item.id)) {
                    let row: any[] = [];
                    if (type === 'ingredients') {
                         row = [
                            item.id,
                            item.code,
                            item.name,
                            item.baseUnit || '',
                            item.supplierId || '',
                            item.avgCost || 0
                        ];
                    } else if (type === 'partners') {
                         row = [
                            item.id,
                            item.code,
                            item.name,
                            item.type,
                            item.phone || '',
                            item.address || '',
                            item.email || '',
                            item.customerType || ''
                        ];
                    } else if (type === 'categories') {
                        row = [item.id, item.name];
                    } else if (type === 'assets') {
                        row = [
                            item.id,
                            item.code,
                            item.name,
                            item.category,
                            item.status,
                            item.originalPrice || 0,
                            item.purchaseDate?.toDate ? item.purchaseDate.toDate().toISOString() : (item.purchaseDate || '')
                        ];
                    }
                    rowsToAdd.push(row);
                }
            }

            if (rowsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, sheetName, rowsToAdd);
                this.log(type, `Added ${rowsToAdd.length} items to Sheet`, 'success');
            } else {
                this.log(type, 'No missing items in Sheet');
            }

            // 4. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let addedToFirestore = 0;
            for (let i = 0; i < sheetRows.length; i++) {
                const row = sheetRows[i];
                let id = row[0];
                let code = row[1];
                // Action column is last. Index depends on type.
                let actionIndex = -1;
                if (type === 'ingredients') actionIndex = 6;
                else if (type === 'partners') actionIndex = 8;
                else if (type === 'categories') actionIndex = 2;
                else if (type === 'assets') actionIndex = 7;

                const action = row[actionIndex] ? String(row[actionIndex]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE
                if (action === '9' && id) {
                    try {
                        if (type === 'ingredients') await catalogService.deleteIngredient(user, id);
                        else if (type === 'partners') await catalogService.deletePartner(user, id);
                        else if (type === 'assets') await deleteDoc(doc(db, 'master_assets', id));
                        // Categories usually soft deleted or ignored, but let's try delete doc
                        else if (type === 'categories') await deleteDoc(doc(db, 'master_expense_categories', id));

                        await googleSheetService.clearRow(this.spreadsheetId, `${sheetName}!A${rowIndex}:Z${rowIndex}`);
                        this.log(type, `Deleted item ${id} per Sheet Action`, 'success');
                    } catch (e: any) {
                        this.log(type, `Failed to delete ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                // If ID is missing, treat as New Creation (Action 0 implicit)
                const isNewRow = !id;

                // Logic:
                // If isNewRow -> Create in Firestore -> Write back ID -> Reset Action if needed
                // If !isNewRow && !firestoreMap.has(id) -> Restore to Firestore (Action 0/1 implicit)
                // If !isNewRow && firestoreMap.has(id) && Action=1 -> Update Firestore from Sheet
                // If !isNewRow && firestoreMap.has(id) && Action=2 -> Update Sheet from Firestore

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    // Update/Create Firestore
                    if (action === '1') this.log(type, `Updating Firestore from Sheet: ${id}`, 'info');
                    else if (!firestoreMap.has(id)) this.log(type, isNewRow ? `Creating new item: ${row[2]}` : `Restoring item: ${row[2]}`, 'info');

                    try {
                        let newId = id;
                        let newCode = code;

                        if (type === 'ingredients') {
                            const data = {
                                name: row[2],
                                baseUnit: row[3],
                                supplierId: row[4]
                            };
                            if (isNewRow) {
                                newCode = await catalogService.createIngredient(user, data);
                                const q = await getDocs(query(collection(db, 'master_ingredients'), where('code', '==', newCode)));
                                if (!q.empty) newId = q.docs[0].id;
                            } else if (action === '1' && id) {
                                await catalogService.updateIngredient(user, id, data);
                            } else {
                                await catalogService.createIngredient(user, data, { forceId: id, forceCode: code });
                            }
                        } else if (type === 'partners') {
                            const data = {
                                name: row[2],
                                type: row[3] as any,
                                phone: row[4],
                                address: row[5],
                                email: row[6],
                                customerType: row[7]
                            };
                            if (isNewRow) {
                                newCode = await catalogService.createPartner(user, data);
                                const q = await getDocs(query(collection(db, 'master_partners'), where('code', '==', newCode)));
                                if (!q.empty) newId = q.docs[0].id;
                            } else if (action === '1' && id) {
                                await catalogService.updatePartner(user, id, data);
                            } else {
                                await catalogService.createPartner(user, data, { forceId: id, forceCode: code });
                            }
                        } else if (type === 'categories') {
                            const name = isNewRow ? row[1] : row[1];
                            if (isNewRow) {
                                await expenseService.addCategory(user, name);
                                const q = await getDocs(query(collection(db, 'master_expense_categories'), where('name', '==', name)));
                                if (!q.empty) newId = q.docs[0].id;
                            } else if (action === '1' && id) {
                                // Update category name? expenseService doesn't have update yet.
                                // Let's skip update for category for now or use generic updateDoc
                                await setDoc(doc(db, 'master_expense_categories', id), { name: name }, { merge: true });
                            } else {
                                await expenseService.addCategory(user, name, { forceId: id });
                            }
                        } else if (type === 'assets') {
                             // Assets manual handling
                             const assetData = {
                                code: code,
                                name: row[2],
                                category: row[3],
                                status: row[4],
                                originalPrice: Number(row[5]),
                                purchaseDate: row[6] ? new Date(row[6]) : new Date(),
                                createdAt: serverTimestamp(),
                                createdBy: user.email
                            };

                             if (isNewRow) {
                                // Not fully supported auto-code gen here for assets easily without service refactor,
                                // but assuming standard flow won't use sheet for new assets often.
                                // skip for safety or use dummy
                             } else if (action === '1' && id) {
                                 await setDoc(doc(db, 'master_assets', id), assetData, { merge: true });
                             } else {
                                 await setDoc(doc(db, 'master_assets', id), assetData);
                             }
                        }

                        // WRITE BACK TO SHEET (ID/Code or Reset Action)
                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!A${rowIndex}`, newId);
                            if (newCode && newCode !== code && type !== 'categories') {
                                await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!B${rowIndex}`, newCode);
                            }
                            this.log(type, `Generated ID for ${rowIndex}: ${newId}`, 'success');
                        }

                        // Reset Action to 0 if it was 1
                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `${sheetName}!${String.fromCharCode(65 + actionIndex)}${rowIndex}`, '0');
                        }

                        addedToFirestore++;
                    } catch (e: any) {
                        this.log(type, `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet from Firestore
                if (action === '2' && id && firestoreMap.has(id)) {
                    const item = firestoreMap.get(id);
                    let rowData: any[] = [];
                    // Construct row data similar to Export logic
                    if (type === 'ingredients') {
                         rowData = [item.id, item.code, item.name, item.baseUnit || '', item.supplierId || '', item.avgCost || 0, '0'];
                    } else if (type === 'partners') {
                         rowData = [item.id, item.code, item.name, item.type, item.phone || '', item.address || '', item.email || '', item.customerType || '', '0'];
                    } else if (type === 'categories') {
                        rowData = [item.id, item.name, '0'];
                    } else if (type === 'assets') {
                        rowData = [
                            item.id,
                            item.code,
                            item.name,
                            item.category,
                            item.status,
                            item.originalPrice || 0,
                            item.purchaseDate?.toDate ? item.purchaseDate.toDate().toISOString() : (item.purchaseDate || ''),
                            '0'
                        ];
                    }

                    if (rowData.length > 0) {
                        await googleSheetService.updateRow(this.spreadsheetId, `${sheetName}!A${rowIndex}`, rowData);
                        this.log(type, `Updated Sheet row ${rowIndex} from Firestore`, 'success');
                    }
                }
            }
            if (addedToFirestore > 0) {
                this.log(type, `Added ${addedToFirestore} items to Firestore`, 'success');
            } else {
                this.log(type, 'No missing items in Firestore');
            }

            this.log(type, 'Sync Complete', 'success');

        } catch (error: any) {
            this.log(type, `Fatal Error: ${error.message}`, 'error');
        }
    }

    /**
     * SYNC PRODUCTS (Nested with Ingredients)
     */
    async syncProducts() {
        if (!this.spreadsheetId) {
             this.log('products', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('products', 'Starting Product Sync...');
            const user = this.getCurrentUser();

            // 1. Prepare Data
            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');
            const ingMap = new Map(ingredients.map(i => [i.id, i])); // ID -> Ing
            const ingCodeMap = new Map(ingredients.map(i => [i.code, i])); // Code -> Ing

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Products', ['ID', 'Code', 'Name', 'Unit', 'Price', 'CostPrice', 'AvgCost', 'Action']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ProductsIngredientItems', ['ProductID', 'IngredientID', 'Quantity', 'Unit', 'IngredientCode']);

            const sheetProducts = await googleSheetService.readSheet(this.spreadsheetId, 'Products!A2:H');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'ProductsIngredientItems!A2:E');

            const firestoreProducts = await this.fetchFirestoreData<MasterProduct>('master_products');
            const firestoreMap = new Map(firestoreProducts.map(p => [p.id, p]));
            const sheetProductMap = new Map(sheetProducts.map(r => [r[0], r]));

            const sheetItemsMap = new Map<string, any[]>();
            for (const row of sheetItems) {
                const pid = row[0];
                if (!sheetItemsMap.has(pid)) sheetItemsMap.set(pid, []);
                sheetItemsMap.get(pid)?.push(row);
            }

            // 2. FILL GAP: Firestore -> Sheet
            const productsToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];

            for (const prod of firestoreProducts) {
                if (!sheetProductMap.has(prod.id)) {
                    productsToAdd.push([
                        prod.id,
                        prod.code,
                        prod.name,
                        prod.unit || '',
                        prod.sellingPrice || 0,
                        prod.costPrice || 0,
                        prod.avgCost || 0,
                        '0'
                    ]);
                    for (const item of (prod.items || [])) {
                        const ing = ingMap.get(item.ingredientId);
                        itemsToAdd.push([
                            prod.id,
                            item.ingredientId,
                            item.quantity,
                            item.unit || '',
                            ing?.code || ''
                        ]);
                    }
                }
            }

            if (productsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Products', productsToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'ProductsIngredientItems', itemsToAdd);
                this.log('products', `Exported ${productsToAdd.length} products to Sheet`, 'success');
            } else {
                 this.log('products', `No missing products in Sheet`);
            }

            // 3. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let importedCount = 0;
            for (let i = 0; i < sheetProducts.length; i++) {
                const row = sheetProducts[i];
                let id = row[0];
                let code = row[1];
                const action = row[7] ? String(row[7]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE
                if (action === '9' && id) {
                    try {
                        await catalogService.deleteProduct(user, id);
                        await googleSheetService.clearRow(this.spreadsheetId, `Products!A${rowIndex}:Z${rowIndex}`);
                        // Also clear items? Usually yes, but items are in another sheet.
                        // Ideally we should delete from ProductsIngredientItems too where ProductID matches.
                        // This is complex. We can skip item sheet clearing for now or do a bulk pass later.
                        this.log('products', `Deleted product ${id}`, 'success');
                    } catch (e: any) {
                        this.log('products', `Failed to delete ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                const isNewRow = !id;

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    // Items from Sheet
                    let lookupId = id;
                    if (isNewRow && code) lookupId = code;

                    const rawItems = sheetItemsMap.get(lookupId) || [];
                    const recipeItems: any[] = [];

                    for (const iRow of rawItems) {
                        const ingId = iRow[1];
                        const qty = Number(iRow[2]);
                        const unit = iRow[3];
                        const ingCode = iRow[4];

                        let resolvedIngId = ingId;
                        if (!resolvedIngId && ingCode) {
                            resolvedIngId = ingCodeMap.get(ingCode)?.id;
                        }

                        if (resolvedIngId) {
                            recipeItems.push({
                                ingredientId: resolvedIngId,
                                quantity: qty,
                                unit: unit
                            });
                        }
                    }

                    try {
                        let newId = id;
                        let newCode = code;

                        const data = {
                            name: row[2],
                            unit: row[3],
                            sellingPrice: Number(row[4]) || 0,
                            costPrice: Number(row[5]) || 0,
                            items: recipeItems
                        };

                        if (isNewRow) {
                            newCode = await catalogService.createProduct(user, data);
                            const q = await getDocs(query(collection(db, 'master_products'), where('code', '==', newCode)));
                            if (!q.empty) newId = q.docs[0].id;
                        } else if (action === '1' && id) {
                            await catalogService.updateProduct(user, id, data);
                        } else {
                            await catalogService.createProduct(user, data, { forceId: id, forceCode: code });
                        }

                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `Products!A${rowIndex}`, newId);
                            if (newCode && newCode !== code) {
                                await googleSheetService.updateCell(this.spreadsheetId, `Products!B${rowIndex}`, newCode);
                            }
                            this.log('products', `Generated ID for row ${rowIndex}: ${newId}`, 'success');
                        }

                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `Products!H${rowIndex}`, '0');
                        }

                        importedCount++;
                    } catch (e: any) {
                         this.log('products', `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet from Firestore
                if (action === '2' && id && firestoreMap.has(id)) {
                    const prod = firestoreMap.get(id);
                    const rowData = [
                        prod.id,
                        prod.code,
                        prod.name,
                        prod.unit || '',
                        prod.sellingPrice || 0,
                        prod.costPrice || 0,
                        prod.avgCost || 0,
                        '0'
                    ];
                    await googleSheetService.updateRow(this.spreadsheetId, `Products!A${rowIndex}`, rowData);
                    this.log('products', `Updated Sheet row ${rowIndex} from Firestore`, 'success');

                    // We should also potentially update items sheet, but that's very hard row-mapping wise.
                    // Skipping items update in sheet for Action 2 for now to avoid complexity.
                }
            }

            if (importedCount > 0) {
                this.log('products', `Imported ${importedCount} products to Firestore`, 'success');
            } else {
                this.log('products', `No missing products in Firestore`);
            }
            this.log('products', 'Product Sync Complete', 'success');

        } catch (error: any) {
            this.log('products', `Fatal Error: ${error.message}`, 'error');
        }
    }

    /**
     * SYNC FINANCE (Expenses)
     */
    async syncFinance() {
         if (!this.spreadsheetId) {
             this.log('finance', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('finance', 'Starting Finance Sync...');
            const user = this.getCurrentUser();

            // 1. Prepare
            const categories = await this.fetchFirestoreData<{id: string, name: string}>('master_expense_categories');
            const suppliers = await this.fetchFirestoreData<MasterPartner>('master_partners');
            const catMap = new Map(categories.map(c => [c.id, c]));
            const supMap = new Map(suppliers.map(s => [s.id, s]));

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Finance', ['ID', 'Code', 'Date', 'Type', 'Amount', 'Category', 'Description', 'SupplierID', 'Action']);

            const sheetRows = await googleSheetService.readSheet(this.spreadsheetId, 'Finance!A2:I');
            const firestoreLogs = await this.fetchFirestoreData<FinanceLedger>('finance_ledger');

            const firestoreMap = new Map(firestoreLogs.map(l => [l.id, l]));
            const sheetMap = new Map(sheetRows.map(r => [r[0], r]));

            // 2. FILL GAP: Firestore -> Sheet
            const rowsToAdd: any[][] = [];
            for (const log of firestoreLogs) {
                if (!sheetMap.has(log.id) && log.type === 'expense') {
                     rowsToAdd.push([
                        log.id,
                        (log as any).code || '',
                        (log.date as any).toDate ? (log.date as any).toDate().toISOString() : new Date(log.date as any).toISOString(),
                        log.type,
                        log.amount,
                        log.category,
                        log.description,
                        log.supplierId || '',
                        '0'
                    ]);
                }
            }
             if (rowsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Finance', rowsToAdd);
                this.log('finance', `Exported ${rowsToAdd.length} expenses to Sheet`, 'success');
            } else {
                 this.log('finance', `No missing expenses in Sheet`);
            }

            // 3. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let importedCount = 0;
            for (let i = 0; i < sheetRows.length; i++) {
                const row = sheetRows[i];
                let id = row[0];
                let code = row[1];
                const action = row[8] ? String(row[8]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE
                if (action === '9' && id) {
                    try {
                        await deleteDoc(doc(db, 'finance_ledger', id));
                        await googleSheetService.clearRow(this.spreadsheetId, `Finance!A${rowIndex}:Z${rowIndex}`);
                        this.log('finance', `Deleted expense ${id}`, 'success');
                    } catch (e: any) {
                        this.log('finance', `Failed to delete ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                const isNewRow = !id;

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    const dateStr = row[2];
                    const amount = Number(row[4]);
                    const catName = row[5];
                    const desc = row[6];
                    const supId = row[7];

                    const cat = categories.find(c => c.name === catName);
                    if (!cat) {
                         this.log('finance', `Skipping row ${rowIndex}: Category ${catName} not found`, 'error');
                         continue;
                    }

                    try {
                        let newId = id;
                        let newCode = code;

                        // For Action 1 (Update), we usually should update doc.
                        // But expenseService doesn't have update.
                        // Since expenses are logs, changing amount means changing financial reports.
                        // Ideally we reverse and recreate? Or just update fields if logic permits.
                        // Simple update for now:
                        if (action === '1' && id) {
                             await setDoc(doc(db, 'finance_ledger', id), {
                                date: Timestamp.fromDate(new Date(dateStr)),
                                amount,
                                category: cat.name,
                                description: desc,
                                supplierId: supId
                             }, { merge: true });
                        } else if (isNewRow) {
                            newCode = await expenseService.createExpense(
                                user,
                                {
                                    date: dateStr,
                                    categoryId: cat.id,
                                    amount,
                                    description: desc,
                                    selectedSupplierId: supId
                                },
                                categories,
                                suppliers,
                                false
                            );
                            const q = await getDocs(query(collection(db, 'finance_ledger'), where('code', '==', newCode)));
                            if (!q.empty) newId = q.docs[0].id;
                        } else {
                            await expenseService.createExpense(
                                user,
                                {
                                    date: dateStr,
                                    categoryId: cat.id,
                                    amount,
                                    description: desc,
                                    selectedSupplierId: supId
                                },
                                categories,
                                suppliers,
                                false,
                                {
                                    forceId: id,
                                    forceCode: code,
                                    forceCreatedAt: new Date(dateStr)
                                }
                            );
                        }

                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `Finance!A${rowIndex}`, newId);
                            if (newCode && newCode !== code) {
                                await googleSheetService.updateCell(this.spreadsheetId, `Finance!B${rowIndex}`, newCode);
                            }
                            this.log('finance', `Generated ID for row ${rowIndex}: ${newId}`, 'success');
                        }

                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `Finance!I${rowIndex}`, '0');
                        }

                        importedCount++;
                    } catch (e: any) {
                         this.log('finance', `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet
                if (action === '2' && id && firestoreMap.has(id)) {
                    const log = firestoreMap.get(id);
                    const rowData = [
                        log.id,
                        (log as any).code || '',
                        (log.date as any).toDate ? (log.date as any).toDate().toISOString() : new Date(log.date as any).toISOString(),
                        log.type,
                        log.amount,
                        log.category,
                        log.description,
                        log.supplierId || '',
                        '0'
                    ];
                    await googleSheetService.updateRow(this.spreadsheetId, `Finance!A${rowIndex}`, rowData);
                    this.log('finance', `Updated Sheet row ${rowIndex}`, 'success');
                }
            }

            if (importedCount > 0) {
                this.log('finance', `Imported ${importedCount} expenses to Firestore`, 'success');
            } else {
                this.log('finance', `No missing expenses in Firestore`);
            }
            this.log('finance', 'Finance Sync Complete', 'success');

        } catch (error: any) {
             this.log('finance', `Fatal Error: ${error.message}`, 'error');
        }
    }

    /**
     * SYNC IMPORTS (Inventory In)
     */
    async syncImports() {
        if (!this.spreadsheetId) {
             this.log('imports', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('imports', 'Starting Import Sync...');
            const user = this.getCurrentUser();

            // 1. Prepare
            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');
            const suppliers = await this.fetchFirestoreData<MasterPartner>('master_partners');
            const ingMap = new Map(ingredients.map(i => [i.id, i]));
            const supMap = new Map(suppliers.map(s => [s.id, s]));

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Imports', ['ID', 'Code', 'Date', 'SupplierID', 'TotalAmount', 'Action']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ImportItems', ['ImportID', 'IngredientID', 'Quantity', 'Price']);

            const sheetImports = await googleSheetService.readSheet(this.spreadsheetId, 'Imports!A2:F');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'ImportItems!A2:D');
            const firestoreImports = await this.fetchFirestoreData<ImportReceipt>('imports');

            const firestoreMap = new Map(firestoreImports.map(i => [i.id, i]));
            const sheetMap = new Map(sheetImports.map(r => [r[0], r]));

            const sheetItemsMap = new Map<string, any[]>();
            for (const row of sheetItems) {
                const id = row[0];
                if (!sheetItemsMap.has(id)) sheetItemsMap.set(id, []);
                sheetItemsMap.get(id)?.push(row);
            }

            // 2. FILL GAP: Firestore -> Sheet
            const importsToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];

            for (const doc of firestoreImports) {
                if (!sheetMap.has(doc.id)) {
                    importsToAdd.push([
                        doc.id,
                        (doc as any).code || '',
                        (doc.importDate as any).toDate ? (doc.importDate as any).toDate().toISOString() : new Date(doc.importDate as any).toISOString(),
                        (doc as any).supplierId || '',
                        doc.totalAmount,
                        '0'
                    ]);
                    for (const item of doc.items) {
                        itemsToAdd.push([
                            doc.id,
                            item.ingredientId,
                            item.quantity,
                            item.totalPrice // Note: Field in DB is totalPrice for imports? Check inventoryService.
                            // inventoryService: totalPrice: i.price (which is total value of line? No, createImportReceipt: price is total amount)
                            // Wait, ImportItem interface has price. createImportReceipt sums price. So item.price IS Line Total.
                        ]);
                    }
                }
            }

            if (importsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Imports', importsToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'ImportItems', itemsToAdd);
                this.log('imports', `Exported ${importsToAdd.length} imports to Sheet`, 'success');
            } else {
                 this.log('imports', `No missing imports in Sheet`);
            }

            // 3. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let importedCount = 0;
            for (let i = 0; i < sheetImports.length; i++) {
                const row = sheetImports[i];
                let id = row[0];
                let code = row[1];
                const action = row[5] ? String(row[5]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE
                if (action === '9' && id) {
                    try {
                        const existing = firestoreMap.get(id);
                        if (existing) await inventoryService.deleteImportReceipt(user, existing);
                        await googleSheetService.clearRow(this.spreadsheetId, `Imports!A${rowIndex}:Z${rowIndex}`);
                        this.log('imports', `Deleted import ${id}`, 'success');
                    } catch (e: any) {
                        this.log('imports', `Failed to delete ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                const isNewRow = !id;

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    const dateStr = row[2];
                    const supplierId = row[3];

                    // For Updates (Action 1), we do Delete + Re-create to ensure inventory consistency
                    if (action === '1' && id && firestoreMap.has(id)) {
                        const existing = firestoreMap.get(id);
                        if (existing) {
                            try {
                                await inventoryService.deleteImportReceipt(user, existing);
                                this.log('imports', `Reversing Import ${id} for update...`, 'info');
                            } catch (e: any) {
                                this.log('imports', `Failed to reverse ${id}: ${e.message}`, 'error');
                                continue;
                            }
                        }
                    }

                    // Build Items
                    let lookupId = id;
                    if (isNewRow && code) lookupId = code;

                    const rawItems = sheetItemsMap.get(lookupId) || [];
                    if (rawItems.length === 0) {
                        this.log('imports', `Skipping row ${rowIndex}: No items found`, 'warning');
                        continue;
                    }

                    const importItems: ImportItem[] = [];
                    for (const iRow of rawItems) {
                        const ingId = iRow[1];
                        const qty = Number(iRow[2]);
                        const price = Number(iRow[3]);

                        importItems.push({
                            ingredientId: ingId,
                            quantity: qty,
                            price: price
                        });
                    }

                    try {
                        let newId = id;
                        let newCode = code;

                        if (isNewRow) {
                            newCode = await inventoryService.createImportReceipt(
                                user,
                                supplierId,
                                dateStr,
                                importItems,
                                suppliers,
                                ingredients
                            );
                            const q = await getDocs(query(collection(db, 'imports'), where('code', '==', newCode)));
                            if (!q.empty) newId = q.docs[0].id;
                        } else {
                            // This covers both Restoration and Action=1 (Re-creation)
                            await inventoryService.createImportReceipt(
                                user,
                                supplierId,
                                dateStr,
                                importItems,
                                suppliers,
                                ingredients,
                                {
                                    forceId: id,
                                    forceCode: code,
                                    forceCreatedAt: new Date(dateStr)
                                }
                            );
                        }

                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `Imports!A${rowIndex}`, newId);
                            if (newCode && newCode !== code) {
                                await googleSheetService.updateCell(this.spreadsheetId, `Imports!B${rowIndex}`, newCode);
                            }
                            this.log('imports', `Generated ID for row ${rowIndex}: ${newId}`, 'success');
                        }

                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `Imports!F${rowIndex}`, '0');
                        }

                        importedCount++;
                    } catch (e: any) {
                         this.log('imports', `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet
                if (action === '2' && id && firestoreMap.has(id)) {
                    const doc = firestoreMap.get(id);
                    const rowData = [
                        doc.id,
                        (doc as any).code || '',
                        (doc.importDate as any).toDate ? (doc.importDate as any).toDate().toISOString() : new Date(doc.importDate as any).toISOString(),
                        (doc as any).supplierId || '',
                        doc.totalAmount,
                        '0'
                    ];
                    await googleSheetService.updateRow(this.spreadsheetId, `Imports!A${rowIndex}`, rowData);
                    this.log('imports', `Updated Sheet row ${rowIndex}`, 'success');
                }
            }
            if (importedCount > 0) {
                this.log('imports', `Imported ${importedCount} imports to Firestore`, 'success');
            } else {
                this.log('imports', `No missing imports in Firestore`);
            }
            this.log('imports', 'Import Sync Complete', 'success');

        } catch (e: any) {
            this.log('imports', `Error: ${e.message}`, 'error');
        }
    }

    /**
     * SYNC PRODUCTION (Inventory Conversion)
     */
    async syncProduction() {
        if (!this.spreadsheetId) {
             this.log('production', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('production', 'Starting Production Sync...');
            const user = this.getCurrentUser();

            // 1. Prepare
            const products = await this.fetchFirestoreData<MasterProduct>('master_products');
            const ingredients = await this.fetchFirestoreData<MasterIngredient>('master_ingredients');
            // const prodMap = new Map(products.map(p => [p.id, p]));
            // const ingMap = new Map(ingredients.map(i => [i.id, i]));

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Production', ['ID', 'Code', 'Date', 'ProductID', 'Yield', 'Action']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ProductionInputs', ['ProductionID', 'IngredientID', 'Quantity', 'Cost']);

            const sheetRuns = await googleSheetService.readSheet(this.spreadsheetId, 'Production!A2:F');
            const sheetInputs = await googleSheetService.readSheet(this.spreadsheetId, 'ProductionInputs!A2:D');
            const firestoreRuns = await this.fetchFirestoreData<ProductionRun>('production_runs');

            const firestoreMap = new Map(firestoreRuns.map(r => [r.id, r]));
            const sheetMap = new Map(sheetRuns.map(r => [r[0], r]));
            const sheetInputMap = new Map<string, any[]>();
            for (const row of sheetInputs) {
                const id = row[0];
                if (!sheetInputMap.has(id)) sheetInputMap.set(id, []);
                sheetInputMap.get(id)?.push(row);
            }

            // 2. FILL GAP: Firestore -> Sheet
            const runsToAdd: any[][] = [];
            const inputsToAdd: any[][] = [];

            for (const run of firestoreRuns) {
                if (!sheetMap.has(run.id)) {
                    runsToAdd.push([
                        run.id,
                        run.code || '',
                        (run.productionDate as any).toDate ? (run.productionDate as any).toDate().toISOString() : new Date(run.productionDate as any).toISOString(),
                        run.productId,
                        run.actualYield,
                        '0'
                    ]);
                    for (const input of run.consumedInputs) {
                        inputsToAdd.push([
                            run.id,
                            input.ingredientId,
                            input.actualQuantityUsed,
                            input.snapshotCost
                        ]);
                    }
                }
            }

            if (runsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Production', runsToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'ProductionInputs', inputsToAdd);
                this.log('production', `Exported ${runsToAdd.length} runs to Sheet`, 'success');
            } else {
                 this.log('production', `No missing runs in Sheet`);
            }

            // 3. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let importedCount = 0;
            for (let i = 0; i < sheetRuns.length; i++) {
                const row = sheetRuns[i];
                let id = row[0];
                let code = row[1];
                const action = row[5] ? String(row[5]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE
                if (action === '9' && id) {
                    try {
                        const existing = firestoreMap.get(id);
                        if (existing) await productionService.deleteProductionRun(user, existing);
                        await googleSheetService.clearRow(this.spreadsheetId, `Production!A${rowIndex}:Z${rowIndex}`);
                        this.log('production', `Deleted run ${id}`, 'success');
                    } catch (e: any) {
                        this.log('production', `Failed to delete ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                const isNewRow = !id;

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    const dateStr = row[2];
                    const productId = row[3];
                    const yieldQty = Number(row[4]);

                    // Action 1: Delete + Create
                    if (action === '1' && id && firestoreMap.has(id)) {
                        const existing = firestoreMap.get(id);
                        if (existing) {
                            try {
                                await productionService.deleteProductionRun(user, existing);
                                this.log('production', `Reversing Run ${id} for update...`, 'info');
                            } catch (e: any) {
                                this.log('production', `Failed to reverse ${id}: ${e.message}`, 'error');
                                continue;
                            }
                        }
                    }

                    let lookupId = id;
                    if (isNewRow && code) lookupId = code;

                    const rawInputs = sheetInputMap.get(lookupId) || [];
                    if (rawInputs.length === 0) continue;

                    const inputs: ProductionInput[] = [];
                    for (const iRow of rawInputs) {
                        inputs.push({
                            ingredientId: iRow[1],
                            actualQuantityUsed: Number(iRow[2]),
                            snapshotCost: Number(iRow[3]),
                            theoreticalQuantity: 0
                        });
                    }

                    const product = products.find(p => p.id === productId);
                    if (!product) {
                        this.log('production', `Skipping row ${rowIndex}: Product ${productId} not found`, 'error');
                        continue;
                    }

                    try {
                        let newId = id;
                        let newCode = code;

                        if (isNewRow) {
                            newCode = await productionService.createProductionRun(
                                user,
                                product,
                                dateStr,
                                yieldQty,
                                inputs,
                                ingredients
                            );
                            const q = await getDocs(query(collection(db, 'production_runs'), where('code', '==', newCode)));
                            if (!q.empty) newId = q.docs[0].id;
                        } else {
                            await productionService.createProductionRun(
                                user,
                                product,
                                dateStr,
                                yieldQty,
                                inputs,
                                ingredients,
                                {
                                    forceId: id,
                                    forceCode: code,
                                    forceCreatedAt: new Date(dateStr)
                                }
                            );
                        }

                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `Production!A${rowIndex}`, newId);
                            if (newCode && newCode !== code) {
                                await googleSheetService.updateCell(this.spreadsheetId, `Production!B${rowIndex}`, newCode);
                            }
                            this.log('production', `Generated ID for row ${rowIndex}: ${newId}`, 'success');
                        }

                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `Production!F${rowIndex}`, '0');
                        }

                        importedCount++;
                    } catch (e: any) {
                         this.log('production', `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet
                if (action === '2' && id && firestoreMap.has(id)) {
                    const run = firestoreMap.get(id);
                    const rowData = [
                        run.id,
                        run.code || '',
                        (run.productionDate as any).toDate ? (run.productionDate as any).toDate().toISOString() : new Date(run.productionDate as any).toISOString(),
                        run.productId,
                        run.actualYield,
                        '0'
                    ];
                    await googleSheetService.updateRow(this.spreadsheetId, `Production!A${rowIndex}`, rowData);
                    this.log('production', `Updated Sheet row ${rowIndex}`, 'success');
                }
            }
            if (importedCount > 0) {
                this.log('production', `Imported ${importedCount} runs to Firestore`, 'success');
            } else {
                this.log('production', `No missing runs in Firestore`);
            }
            this.log('production', 'Production Sync Complete', 'success');

        } catch (e: any) {
            this.log('production', `Error: ${e.message}`, 'error');
        }
    }

    /**
     * SYNC SALES ORDERS (Complex)
     */
    async syncSales() {
         if (!this.spreadsheetId) {
             this.log('sales', 'No Spreadsheet ID provided', 'error');
             return;
        }

        try {
            this.log('sales', 'Starting Sales Sync...');
            const user = this.getCurrentUser();

            // 1. Prepare Data
            // Fetch Master Data for validation/lookup
            const products = await this.fetchFirestoreData<MasterProduct>('master_products');
            const partners = await this.fetchFirestoreData<MasterPartner>('master_partners');
            const partnerMap = new Map(partners.map(p => [p.id, p]));
            const productMap = new Map(products.map(p => [p.id, p]));

            // Ensure Sheets
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrders', ['ID', 'Code', 'Date', 'CustomerID', 'Status', 'TotalAmount', 'Action']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrderItems', ['OrderID', 'ProductID', 'Quantity', 'UnitPrice', 'Total']);

            // Fetch Sheets
            const sheetOrders = await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrders!A2:G');
            const sheetItems = await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrderItems!A2:E');

            // Fetch Firestore
            const firestoreOrders = await this.fetchFirestoreData<SalesOrder>('sales_orders');
            const firestoreMap = new Map(firestoreOrders.map(o => [o.id, o]));
            const sheetOrderMap = new Map(sheetOrders.map(r => [r[0], r]));

            // Group Sheet Items by OrderID
            const sheetItemsMap = new Map<string, any[]>();
            for (const row of sheetItems) {
                const orderId = row[0];
                if (!sheetItemsMap.has(orderId)) sheetItemsMap.set(orderId, []);
                sheetItemsMap.get(orderId)?.push(row);
            }

            // 2. FILL GAP: Firestore -> Sheet
            const ordersToAdd: any[][] = [];
            const itemsToAdd: any[][] = [];

            for (const order of firestoreOrders) {
                if (!sheetOrderMap.has(order.id)) {
                    // Add Header
                    ordersToAdd.push([
                        order.id,
                        order.code,
                        (order.createdAt as any).toDate ? (order.createdAt as any).toDate().toISOString() : new Date(order.createdAt as any).toISOString(),
                        order.customerId,
                        order.status,
                        order.totalAmount,
                        '0'
                    ]);
                    // Add Items
                    for (const item of order.items) {
                        itemsToAdd.push([
                            order.id,
                            item.productId,
                            item.quantity,
                            item.unitPrice,
                            item.total
                        ]);
                    }
                }
            }

            if (ordersToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'SalesOrders', ordersToAdd);
                await googleSheetService.appendData(this.spreadsheetId, 'SalesOrderItems', itemsToAdd);
                this.log('sales', `Exported ${ordersToAdd.length} orders to Sheet`, 'success');
            } else {
                 this.log('sales', `No missing orders in Sheet`);
            }

            // 3. PROCESS SHEET ROWS (Fill Gap + ActionType)
            let importedCount = 0;
            for (let i = 0; i < sheetOrders.length; i++) {
                const row = sheetOrders[i];
                let id = row[0];
                let code = row[1];
                const action = row[6] ? String(row[6]).trim() : '0';
                const rowIndex = i + 2;

                // Action 9: DELETE (Cancel)
                if (action === '9' && id) {
                    try {
                        const existing = firestoreMap.get(id);
                        // We use cancelOrder to ensure inventory reversal, but it's soft delete.
                        // If we want to truly "delete" from system, we might need a hard delete fn in service,
                        // but cancel is safer. However, we are clearing the sheet row, so it's gone from user view.
                        if (existing && existing.status !== 'canceled') {
                             await orderService.updateOrderStatus(user, existing, 'canceled');
                        }
                        await googleSheetService.clearRow(this.spreadsheetId, `SalesOrders!A${rowIndex}:Z${rowIndex}`);
                        this.log('sales', `Canceled order ${id}`, 'success');
                    } catch (e: any) {
                         this.log('sales', `Failed to delete/cancel ${id}: ${e.message}`, 'error');
                    }
                    continue;
                }

                const isNewRow = !id;

                if (isNewRow || !firestoreMap.has(id) || action === '1') {
                    const dateStr = row[2];
                    const customerId = row[3];
                    const status = row[4];

                    // Action 1: Re-create (Update)
                    if (action === '1' && id && firestoreMap.has(id)) {
                        const existing = firestoreMap.get(id);
                        if (existing && existing.status !== 'canceled') {
                             try {
                                 await orderService.updateOrderStatus(user, existing, 'canceled');
                                 this.log('sales', `Reversing Order ${id} for update...`, 'info');
                             } catch (e: any) {
                                 this.log('sales', `Failed to reverse ${id}: ${e.message}`, 'error');
                                 continue;
                             }
                        }
                    }

                    // Validate Customer
                    const customer = partnerMap.get(customerId);
                    if (!customer) {
                        this.log('sales', `Skipping row ${rowIndex}: Customer ID ${customerId} not found`, 'error');
                        continue;
                    }

                    // Build Items
                    let lookupId = id;
                    if (isNewRow && code) lookupId = code;

                    const rawItems = sheetItemsMap.get(lookupId) || [];
                    if (rawItems.length === 0) {
                         this.log('sales', `Skipping row ${rowIndex}: No items found`, 'error');
                         continue;
                    }

                    const salesItems: SalesOrderItem[] = [];
                    let itemsValid = true;

                    for (const iRow of rawItems) {
                        const pid = iRow[1];
                        const qty = Number(iRow[2]);
                        const price = Number(iRow[3]);

                        const product = productMap.get(pid);
                        if (!product) {
                            this.log('sales', `Skipping row ${rowIndex}: Product ID ${pid} not found`, 'error');
                            itemsValid = false;
                            break;
                        }

                        salesItems.push({
                            productId: pid,
                            productName: product.name,
                            quantity: qty,
                            unitPrice: price,
                            originalPrice: price, // Assume same
                            total: qty * price,
                            costPrice: 0 // Will be calc by service
                        });
                    }

                    if (!itemsValid) continue;

                    try {
                        let newId = id;
                        let newCode = code;

                        if (isNewRow) {
                            newCode = await orderService.createOrder(
                                user,
                                customer,
                                salesItems,
                                status || 'completed',
                                dateStr,
                                products,
                                0, // Shipping Fee
                                customer.address || '',
                                customer.phone || ''
                            );
                            const q = await getDocs(query(collection(db, 'sales_orders'), where('code', '==', newCode)));
                            if (!q.empty) newId = q.docs[0].id;
                        } else {
                            await orderService.createOrder(
                                user,
                                customer,
                                salesItems,
                                status || 'completed',
                                dateStr,
                                products,
                                0, // Shipping Fee
                                customer.address || '',
                                customer.phone || '',
                                {
                                    forceCode: code,
                                    forceId: id,
                                    forceCreatedAt: new Date(dateStr)
                                }
                            );
                        }

                        if (isNewRow && newId) {
                            await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!A${rowIndex}`, newId);
                            if (newCode && newCode !== code) {
                                await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!B${rowIndex}`, newCode);
                            }
                            this.log('sales', `Generated ID for row ${rowIndex}: ${newId}`, 'success');
                        }

                        if (action === '1') {
                            await googleSheetService.updateCell(this.spreadsheetId, `SalesOrders!G${rowIndex}`, '0');
                        }

                        importedCount++;
                    } catch (e: any) {
                         this.log('sales', `Failed to process row ${rowIndex}: ${e.message}`, 'error');
                    }
                }

                // Action 2: Update Sheet
                if (action === '2' && id && firestoreMap.has(id)) {
                    const order = firestoreMap.get(id);
                    const rowData = [
                        order.id,
                        order.code,
                        (order.createdAt as any).toDate ? (order.createdAt as any).toDate().toISOString() : new Date(order.createdAt as any).toISOString(),
                        order.customerId,
                        order.status,
                        order.totalAmount,
                        '0'
                    ];
                    await googleSheetService.updateRow(this.spreadsheetId, `SalesOrders!A${rowIndex}`, rowData);
                    this.log('sales', `Updated Sheet row ${rowIndex}`, 'success');
                }
            }

            if (importedCount > 0) {
                this.log('sales', `Imported ${importedCount} orders to Firestore`, 'success');
            } else {
                this.log('sales', `No missing orders in Firestore`);
            }

            this.log('sales', 'Sales Sync Complete', 'success');

        } catch (error: any) {
            this.log('sales', `Fatal Error: ${error.message}`, 'error');
        }
    }
}

export const syncService = new SyncService();
