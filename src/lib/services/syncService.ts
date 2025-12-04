import { googleSheetService } from './googleSheetService';
import { catalogService } from './catalogService';
import { orderService } from './orderService';
import { expenseService } from './expenseService';
import { inventoryService } from './inventoryService';
import { productionService } from './productionService';
import { auth, db } from '$lib/firebase';
import { collection, doc, setDoc, serverTimestamp, getDocs } from 'firebase/firestore';
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
     * SYNC MASTER DATA (Products, Ingredients, Partners, Categories, Assets)
     */
    async syncMasterData(type: 'products' | 'ingredients' | 'partners' | 'categories' | 'assets') {
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

            if (type === 'products') {
                collectionName = 'master_products';
                sheetName = 'Products';
                headers = ['ID', 'Code', 'Name', 'Unit', 'Price', 'CostPrice', 'AvgCost', 'ItemsJSON'];
            } else if (type === 'ingredients') {
                collectionName = 'master_ingredients';
                sheetName = 'Ingredients';
                headers = ['ID', 'Code', 'Name', 'BaseUnit', 'SupplierID', 'AvgCost'];
            } else if (type === 'partners') {
                collectionName = 'master_partners';
                sheetName = 'Partners';
                headers = ['ID', 'Code', 'Name', 'Type', 'Phone', 'Address', 'Email', 'CustomerType'];
            } else if (type === 'categories') {
                collectionName = 'master_expense_categories';
                sheetName = 'ExpenseCategories';
                headers = ['ID', 'Name'];
            } else if (type === 'assets') {
                collectionName = 'master_assets';
                sheetName = 'Assets';
                headers = ['ID', 'Code', 'Name', 'Category', 'Status', 'OriginalPrice', 'PurchaseDate'];
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
                    if (type === 'products') {
                        row = [
                            item.id,
                            item.code,
                            item.name,
                            item.unit || '',
                            item.sellingPrice || 0,
                            item.costPrice || 0,
                            item.avgCost || 0,
                            JSON.stringify(item.items || [])
                        ];
                    } else if (type === 'ingredients') {
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

            // 4. FILL GAP: Sheet -> Firestore (Add missing to Firestore)
            let addedToFirestore = 0;
            for (const row of sheetRows) {
                const id = row[0];
                const code = row[1];
                if (!id) continue; // Skip empty rows

                if (!firestoreMap.has(id)) {
                    // Item exists in Sheet but not Firestore -> Create
                    this.log(type, `Found new item in Sheet: ${row[2]} (${code})`, 'info');

                    try {
                        if (type === 'products') {
                            const data = {
                                name: row[2],
                                unit: row[3],
                                sellingPrice: Number(row[4]) || 0,
                                costPrice: Number(row[5]) || 0,
                                // avgCost is read-only usually, managed by system
                                items: row[7] ? JSON.parse(row[7]) : []
                            };
                            await catalogService.createProduct(user, data, { forceId: id, forceCode: code });
                        } else if (type === 'ingredients') {
                            const data = {
                                name: row[2],
                                baseUnit: row[3],
                                supplierId: row[4]
                            };
                            await catalogService.createIngredient(user, data, { forceId: id, forceCode: code });
                        } else if (type === 'partners') {
                            const data = {
                                name: row[2],
                                type: row[3] as any,
                                phone: row[4],
                                address: row[5],
                                email: row[6],
                                customerType: row[7]
                            };
                            await catalogService.createPartner(user, data, { forceId: id, forceCode: code });
                        } else if (type === 'categories') {
                            // code is name effectively for categories in some systems, but here id is key.
                            // Name is row[1]. Code (row[1] in loop) is Name actually for this type?
                            // Wait, headers are ID, Name. So code variable (row[1]) is Name.
                            await expenseService.addCategory(user, row[1], { forceId: id });
                        } else if (type === 'assets') {
                            // Manual asset creation via setDoc since no dedicated service method for "createAsset" with overrides easily accessible yet
                            // Or adapt logic.
                             await setDoc(doc(db, 'master_assets', id), {
                                code: code, // row[1]
                                name: row[2],
                                category: row[3],
                                status: row[4],
                                originalPrice: Number(row[5]),
                                purchaseDate: row[6] ? new Date(row[6]) : new Date(),
                                createdAt: serverTimestamp(),
                                createdBy: user.email
                            });
                        }
                        addedToFirestore++;
                    } catch (e: any) {
                        this.log(type, `Failed to add ${row[2]}: ${e.message}`, 'error');
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

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Finance', ['ID', 'Code', 'Date', 'Type', 'Amount', 'Category', 'Description', 'SupplierID']);

            const sheetRows = await googleSheetService.readSheet(this.spreadsheetId, 'Finance!A2:H');
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
                        log.supplierId || ''
                    ]);
                }
            }
             if (rowsToAdd.length > 0) {
                await googleSheetService.appendData(this.spreadsheetId, 'Finance', rowsToAdd);
                this.log('finance', `Exported ${rowsToAdd.length} expenses to Sheet`, 'success');
            } else {
                 this.log('finance', `No missing expenses in Sheet`);
            }

            // 3. FILL GAP: Sheet -> Firestore
            let importedCount = 0;
            for (const row of sheetRows) {
                const id = row[0];
                if (!id) continue;
                if (!firestoreMap.has(id)) {
                    // Import
                    const code = row[1];
                    const dateStr = row[2];
                    const amount = Number(row[4]);
                    const catName = row[5];
                    const desc = row[6];
                    const supId = row[7];

                    // Find Category ID by Name (approx match) or just use name
                    // Service requires ID.
                    const cat = categories.find(c => c.name === catName);
                    if (!cat) {
                         this.log('finance', `Skipping ${code}: Category ${catName} not found`, 'error');
                         continue;
                    }

                    try {
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
                        importedCount++;
                    } catch (e: any) {
                         this.log('finance', `Failed to import ${code}: ${e.message}`, 'error');
                    }
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

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Imports', ['ID', 'Code', 'Date', 'SupplierID', 'TotalAmount']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ImportItems', ['ImportID', 'IngredientID', 'Quantity', 'Price']);

            const sheetImports = await googleSheetService.readSheet(this.spreadsheetId, 'Imports!A2:E');
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
                        doc.totalAmount
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

            // 3. FILL GAP: Sheet -> Firestore
            let importedCount = 0;
            for (const row of sheetImports) {
                const id = row[0];
                if (!id) continue;
                if (!firestoreMap.has(id)) {
                    const code = row[1];
                    const dateStr = row[2];
                    const supplierId = row[3];
                    // const total = row[4];

                    const rawItems = sheetItemsMap.get(id) || [];
                    if (rawItems.length === 0) continue;

                    const importItems: ImportItem[] = [];
                    for (const iRow of rawItems) {
                        const ingId = iRow[1];
                        const qty = Number(iRow[2]);
                        const price = Number(iRow[3]); // Line total

                        importItems.push({
                            ingredientId: ingId,
                            quantity: qty,
                            price: price
                        });
                    }

                    try {
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
                        importedCount++;
                    } catch (e: any) {
                         this.log('imports', `Failed to import ${code}: ${e.message}`, 'error');
                    }
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

            await googleSheetService.ensureSheet(this.spreadsheetId, 'Production', ['ID', 'Code', 'Date', 'ProductID', 'Yield']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'ProductionInputs', ['ProductionID', 'IngredientID', 'Quantity', 'Cost']);

            const sheetRuns = await googleSheetService.readSheet(this.spreadsheetId, 'Production!A2:E');
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
                        run.actualYield
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

            // 3. FILL GAP: Sheet -> Firestore
            let importedCount = 0;
            for (const row of sheetRuns) {
                const id = row[0];
                if (!id) continue;
                if (!firestoreMap.has(id)) {
                    const code = row[1];
                    const dateStr = row[2];
                    const productId = row[3];
                    const yieldQty = Number(row[4]);

                    const rawInputs = sheetInputMap.get(id) || [];
                    if (rawInputs.length === 0) continue;

                    const inputs: ProductionInput[] = [];
                    for (const iRow of rawInputs) {
                        inputs.push({
                            ingredientId: iRow[1],
                            actualQuantityUsed: Number(iRow[2]),
                            snapshotCost: Number(iRow[3]),
                            theoreticalQuantity: 0 // Not synced, recalc? or ignore. Service uses snapshotCost.
                        });
                    }

                    const product = products.find(p => p.id === productId);
                    if (!product) {
                        this.log('production', `Skipping ${code}: Product ${productId} not found`, 'error');
                        continue;
                    }

                    try {
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
                        importedCount++;
                    } catch (e: any) {
                         this.log('production', `Failed to import ${code}: ${e.message}`, 'error');
                    }
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
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrders', ['ID', 'Code', 'Date', 'CustomerID', 'Status', 'TotalAmount']);
            await googleSheetService.ensureSheet(this.spreadsheetId, 'SalesOrderItems', ['OrderID', 'ProductID', 'Quantity', 'UnitPrice', 'Total']);

            // Fetch Sheets
            const sheetOrders = await googleSheetService.readSheet(this.spreadsheetId, 'SalesOrders!A2:F');
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
                        order.totalAmount
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

            // 3. FILL GAP: Sheet -> Firestore
            let importedCount = 0;
            for (const row of sheetOrders) {
                const orderId = row[0];
                const code = row[1];
                const dateStr = row[2];
                const customerId = row[3];
                const status = row[4];

                if (!orderId) continue;

                if (!firestoreMap.has(orderId)) {
                    this.log('sales', `Found new order in Sheet: ${code}`, 'info');

                    // Validate Customer
                    const customer = partnerMap.get(customerId);
                    if (!customer) {
                        this.log('sales', `Skipping ${code}: Customer ID ${customerId} not found`, 'error');
                        continue;
                    }

                    // Build Items
                    const rawItems = sheetItemsMap.get(orderId) || [];
                    if (rawItems.length === 0) {
                         this.log('sales', `Skipping ${code}: No items found`, 'error');
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
                            this.log('sales', `Skipping ${code}: Product ID ${pid} not found`, 'error');
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
                        // Create Order
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
                                forceId: orderId,
                                forceCreatedAt: new Date(dateStr)
                            }
                        );
                        importedCount++;
                    } catch (e: any) {
                         this.log('sales', `Failed to import ${code}: ${e.message}`, 'error');
                    }
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
