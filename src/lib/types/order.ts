export interface OrderItem {
	productId: string;
	productName?: string;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
	lineCOGS: number;
	initialPrice: number;
    originalBasePrice?: number;
}

export interface Order {
	id: string;
	code?: string;
	createdAt: { toDate: () => Date };
    deliveryDate?: { toDate: () => Date };
	customerId: string;
	customerInfo: { name: string, type?: 'sỉ'|'lẻ', phone?: string };
	totalRevenue: number;
	totalProfit: number;
	status: 'open' | 'cooking' | 'delivering' | 'delivered' | 'completed' | 'canceled';
	shippingAddress: string;
	items: OrderItem[];
}
