import { db } from '$lib/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { googleSheetService } from './googleSheetService';
import { catalogService } from './catalogService';
import { orderService } from './orderService';
import { auth } from '$lib/firebase';
import type { MasterPartner, MasterProduct, MasterIngredient, SalesOrder, SalesOrderItem } from '$lib/types/erp';

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
     * SYNC MASTER DATA (Products, Ingredients, Partners)
     */
    async syncMasterData(type: 'products' | 'ingredients' | 'partners') {
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
