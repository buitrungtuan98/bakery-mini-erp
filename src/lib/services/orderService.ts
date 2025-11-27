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
import type { Order, OrderItem } from '$lib/types/order';
import type { Product, Partner } from '$lib/stores/masterDataStore';
import type { User } from 'firebase/auth';

export const orderService = {
    /**
     * Create a new sales order and update inventory
     */
    async createOrder(
        user: User,
        customer: Partner | undefined,
        items: OrderItem[],
        status: string,
        deliveryDateInput: string,
        products: Product[],
        shippingFee: number = 0,
        shippingAddress: string = '',
        shippingPhone: string = ''
    ) {
        if (!customer) throw new Error('Vui lòng chọn khách hàng.');
        const validItems = items.filter(i => i.productId && i.quantity > 0);
        if (validItems.length === 0) throw new Error('Phiếu bán hàng trống.');

        const code = await generateNextCode('orders', 'DH');

        // Calculate totals
        const totalRevenue = items.reduce((sum, item) => sum + (item.lineTotal || 0), 0) + shippingFee;
        const totalCOGS = items.reduce((sum, item) => sum + (item.lineCOGS || 0), 0);
        const totalProfit = totalRevenue - totalCOGS;

        await runTransaction(db, async (transaction) => {
            // Check and update stock
            const productRefs = validItems.map(item => doc(db, 'products', item.productId));
            const productSnaps = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            productSnaps.forEach((snap, index) => {
                const item = validItems[index];
                const productRef = productRefs[index];
                if (!snap.exists()) throw new Error(`Lỗi: Sản phẩm ID ${item.productId} không tồn tại.`);

                const currentStock = Number(snap.data()?.currentStock || 0);
                const newStock = currentStock - item.quantity;

                transaction.update(productRef, { currentStock: newStock });
            });

            // Create Order
            const orderRef = doc(collection(db, 'orders'));
            const deliveryTimestamp = deliveryDateInput ? Timestamp.fromDate(new Date(deliveryDateInput)) : serverTimestamp();

            transaction.set(orderRef, {
                code: code,
                customerId: customer.id,
                customerInfo: {
                    name: customer.name,
                    type: customer.customerType,
                    phone: shippingPhone
                },
                shippingAddress: shippingAddress,
                status: status,
                deliveryDate: deliveryTimestamp,
                items: validItems.map(i => ({
                    productId: i.productId,
                    productName: products.find(p => p.id === i.productId)?.name,
                    quantity: i.quantity,
                    unitPrice: i.unitPrice,
                    lineTotal: i.lineTotal,
                    lineCOGS: i.lineCOGS
                })),
                totalRevenue: totalRevenue,
                totalCOGS: totalCOGS,
                totalProfit: totalProfit,
                shippingFee: shippingFee,
                createdBy: user.email,
                createdAt: serverTimestamp()
            });

            await logAction(user, 'TRANSACTION', 'orders', `Tạo đơn hàng ${code}`);
        });

        return code;
    },

    /**
     * Cancel an order and revert inventory
     */
    async cancelOrder(user: User, order: Order) {
        const orderDate = order.createdAt.toDate().toDateString();
        const todayDate = new Date().toDateString();

        // Business Rule: Can only cancel today's orders
        if (orderDate !== todayDate) throw new Error("Chỉ có thể hủy đơn hàng trong ngày đã tạo.");
        if (order.status === 'canceled') throw new Error("Đơn hàng này đã bị hủy.");

        await runTransaction(db, async (transaction) => {
            const orderRef = doc(db, 'orders', order.id);

            // Revert Stock
            for (const item of order.items) {
                const productRef = doc(db, 'products', item.productId);
                const productSnap = await transaction.get(productRef);
                if (!productSnap.exists()) continue;

                const currentStock = Number(productSnap.data()?.currentStock || 0);
                const newStock = currentStock + item.quantity;
                transaction.update(productRef, { currentStock: newStock });
            }

            // Update Status
            transaction.update(orderRef, {
                status: 'canceled',
                canceledBy: user.email,
                canceledAt: serverTimestamp()
            });
        });

        const displayId = order.code || order.id.substring(0, 8);
        await logAction(user, 'UPDATE', 'orders', `Hủy đơn hàng: ${displayId}`);
    },

    /**
     * Update order status
     */
    async updateStatus(user: User, order: Order, newStatus: string) {
        const orderRef = doc(db, 'orders', order.id);
        await updateDoc(orderRef, { status: newStatus });
        await logAction(user, 'UPDATE', 'orders', `Cập nhật trạng thái ${order.code} -> ${newStatus}`);
    },

    /**
     * Subscribe to order history
     */
    subscribeHistory(limitCount: number, callback: (orders: Order[]) => void) {
        const orderQuery = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(limitCount));
        return onSnapshot(orderQuery, (snapshot) => {
            const orders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order));
            callback(orders);
        });
    },

    /**
     * Subscribe to Daily Plan
     */
    subscribeDailyPlan(dateStr: string, statusFilter: string, products: Product[], callback: (items: any[]) => void) {
        const start = new Date(dateStr);
        start.setHours(0,0,0,0);
        const end = new Date(dateStr);
        end.setHours(23,59,59,999);

        const q = query(
            collection(db, 'orders'),
            where('deliveryDate', '>=', Timestamp.fromDate(start)),
            where('deliveryDate', '<=', Timestamp.fromDate(end))
        );

        return onSnapshot(q, (snapshot) => {
            const tempMap = new Map<string, number>();

            snapshot.docs.forEach(doc => {
                const data = doc.data() as Order;
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
