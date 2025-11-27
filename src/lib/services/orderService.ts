import { db } from '$lib/firebase';
import {
    collection,
    doc,
    runTransaction,
    serverTimestamp,
    Timestamp,
    query,
    where,
    orderBy,
    limit,
    onSnapshot,
    updateDoc
} from 'firebase/firestore';
import { generateNextCode } from '$lib/utils';
import { logAction } from '$lib/logger';
import { recordInventoryTransaction } from '$lib/services/inventoryService';
import type { User } from 'firebase/auth';
import type { SalesOrder, SalesOrderItem, MasterProduct, MasterPartner } from '$lib/types/erp';

// Legacy Type Alias for compatibility if needed
export type Order = SalesOrder;
export type OrderItem = SalesOrderItem;

export const orderService = {
    /**
     * Create a new sales order and update inventory
     */
    async createOrder(
        user: User,
        customer: MasterPartner | undefined,
        items: SalesOrderItem[],
        status: string,
        deliveryDateInput: string,
        products: MasterProduct[],
        shippingFee: number = 0,
        shippingAddress: string = '',
        shippingPhone: string = ''
    ) {
        if (!customer) throw new Error('Vui lòng chọn khách hàng.');
        const validItems = items.filter(i => i.productId && i.quantity > 0);
        if (validItems.length === 0) throw new Error('Phiếu bán hàng trống.');

        const code = await generateNextCode('sales_orders', 'DH');

        // Calculate totals
        // NOTE: SalesOrderItem now has costPrice (COGS)
        const totalRevenue = items.reduce((sum, item) => sum + (item.total || 0), 0) + shippingFee;
        const totalCOGS = items.reduce((sum, item) => sum + (item.costPrice || 0), 0);
        // Profit not strictly stored on Order model in new schema but implied.
        // We calculate totalAmount (Receivable) = subTotal + shipping - discount (handled in item total usually or separate)

        // In this simplified refactor, we assume item.total is final line total after discount.
        const subTotal = items.reduce((sum, item) => sum + (item.total || 0), 0);

        await runTransaction(db, async (transaction) => {

            // 1. Create Sales Order
            const orderRef = doc(collection(db, 'sales_orders'));
            const deliveryTimestamp = deliveryDateInput ? Timestamp.fromDate(new Date(deliveryDateInput)) : serverTimestamp();

            const newOrder: SalesOrder = {
                id: orderRef.id,
                code: code,
                createdAt: Timestamp.now(), // Will be overwritten by serverTimestamp() effectively
                deliveryDate: deliveryTimestamp,
                customerId: customer.id,
                customerName: customer.name,
                customerPhone: shippingPhone,
                shippingAddress: shippingAddress,
                status: status as any,
                paymentStatus: 'unpaid', // Default
                items: validItems.map(i => ({
                    productId: i.productId,
                    productName: products.find(p => p.id === i.productId)?.name || 'Unknown',
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    originalPrice: i.originalPrice,
                    total: i.total,
                    costPrice: i.costPrice
                })),
                subTotal: subTotal,
                discountAmount: 0, // Item level discount assumed baked into total for now
                shippingFee: shippingFee,
                totalAmount: totalRevenue,
                totalCost: totalCOGS,
                createdBy: user.email || 'system'
            };

            // Firestore needs plain objects, ensure no undefined
            transaction.set(orderRef, {
                ...newOrder,
                createdAt: serverTimestamp()
            });

            // 2. Inventory Transaction (OUT - Allocation)
            // We deduct stock immediately upon creation as per "Reservation" logic.
            for (const item of validItems) {
                await recordInventoryTransaction(transaction, {
                    type: 'sale',
                    itemId: item.productId,
                    itemType: 'product',
                    quantityChange: -item.quantity, // Deduct
                    unitCost: item.costPrice / item.quantity, // Approx Unit Cost
                    relatedDocId: orderRef.id,
                    relatedDocCode: code,
                    performer: { uid: user.uid, email: user.email || 'unknown' },
                    timestamp: new Date()
                });
            }

            await logAction(user, 'TRANSACTION', 'sales_orders', `Tạo đơn hàng ${code}`);
        });

        return code;
    },

    /**
     * Cancel an order and revert inventory
     */
    async cancelOrder(user: User, order: SalesOrder) {
        // Validation
        // if (order.status === 'canceled') ... logic checked in UI mostly but good to have here

        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'sales_orders', order.id);

            // Revert Stock (IN)
            for (const item of order.items) {
                // Determine unit cost for reversal? Use stored costPrice.
                const unitCost = item.quantity > 0 ? (item.costPrice / item.quantity) : 0;

                await recordInventoryTransaction(transaction, {
                    type: 'adjustment', // Reversal
                    itemId: item.productId,
                    itemType: 'product',
                    quantityChange: item.quantity, // Add back
                    unitCost: unitCost,
                    relatedDocId: order.id,
                    relatedDocCode: order.code,
                    performer: { uid: user.uid, email: user.email || 'unknown' },
                    timestamp: new Date()
                });
            }

            // Update Status
            transaction.update(orderRef, {
                status: 'canceled'
            });

            // Log cancellation details if needed in a separate log or audit trail
        });

        const displayId = order.code || order.id.substring(0, 8);
        await logAction(user, 'UPDATE', 'sales_orders', `Hủy đơn hàng: ${displayId}`);
    },

    /**
     * Update order status
     */
    async updateStatus(user: User, order: SalesOrder, newStatus: string) {
        const orderRef = doc(db, 'sales_orders', order.id);
        await updateDoc(orderRef, { status: newStatus });
        await logAction(user, 'UPDATE', 'sales_orders', `Cập nhật trạng thái ${order.code} -> ${newStatus}`);
    },

    /**
     * Subscribe to order history
     */
    subscribeHistory(limitCount: number, callback: (orders: SalesOrder[]) => void) {
        const orderQuery = query(collection(db, 'sales_orders'), orderBy('createdAt', 'desc'), limit(limitCount));
        return onSnapshot(orderQuery, (snapshot) => {
            const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalesOrder));
            callback(orders);
        });
    },

    /**
     * Subscribe to Daily Plan
     */
    subscribeDailyPlan(dateStr: string, statusFilter: string, products: MasterProduct[], callback: (items: any[]) => void) {
        const start = new Date(dateStr);
        start.setHours(0,0,0,0);
        const end = new Date(dateStr);
        end.setHours(23,59,59,999);

        const q = query(
            collection(db, 'sales_orders'),
            where('deliveryDate', '>=', Timestamp.fromDate(start)),
            where('deliveryDate', '<=', Timestamp.fromDate(end))
        );

        return onSnapshot(q, (snapshot) => {
            const tempMap = new Map<string, number>();

            snapshot.docs.forEach(doc => {
                const data = doc.data() as SalesOrder;
                if (data.status === 'canceled') return;
                if (statusFilter !== 'all_active' && data.status !== statusFilter) return;

                data.items.forEach(item => {
                    const curr = tempMap.get(item.productId) || 0;
                    tempMap.set(item.productId, curr + item.quantity);
                });
            });

            const result = [];
            for (const [pid, qty] of tempMap.entries()) {
                const prod = products.find(p => p.id === pid);
                const stock = prod?.currentStock || 0;
                result.push({
                    productId: pid,
                    name: prod?.name || 'Unknown',
                    ordered: qty,
                    stock: stock,
                    missing: stock < 0 ? Math.abs(stock) : 0
                });
            }

            callback(result.sort((a,b) => a.name.localeCompare(b.name)));
        });
    }
};
