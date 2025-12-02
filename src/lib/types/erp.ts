export type Timestamp = { toDate: () => Date } | Date;

// --- MASTER DATA ---

export interface MasterEntity {
    id: string;
    code: string; // Unique human-readable ID (e.g. SP-001, KH-001)
    name: string;
    createdAt?: Timestamp;
    updatedAt?: Timestamp;
}

export interface MasterProduct extends MasterEntity {
    sellingPrice: number;
    costPrice: number; // Theoretical cost based on recipe
    avgCost?: number; // Weighted Average Cost (Real Production Cost)
    currentStock: number;
    estimatedYieldQty?: number; // Standard yield per batch
    minStock: number;
    unit?: string;
    items: RecipeItem[]; // Embedded recipe (Legacy name 'items' preserved for UI compatibility)
    isActive?: boolean;
}

export interface RecipeItem {
    ingredientId: string;
    ingredientName?: string; // Snapshot
    quantity: number;
    unit?: string;
}

export interface MasterIngredient extends MasterEntity {
    baseUnit: string;
    currentStock: number;
    avgCost: number; // Weighted Average Cost
    minStock: number;
    manufacturerId?: string;
    manufacturerName?: string;
    supplierId?: string; // Preferred supplier
    isActive?: boolean;
}

export interface MasterPartner extends MasterEntity {
    type: 'customer' | 'supplier' | 'manufacturer';
    phone?: string;
    address?: string;
    email?: string;
    taxId?: string;
    customerType?: 'sỉ' | 'lẻ';
    customPrices?: { productId: string; price: number }[];
}

// --- TRANSACTION DATA ---

export interface InventoryTransaction {
    id: string;
    type: 'import' | 'sale' | 'production_in' | 'production_out' | 'waste' | 'adjustment';
    date: Timestamp;

    // Affected Item
    itemId: string; // Product or Ingredient ID
    itemType: 'product' | 'ingredient';
    itemName: string; // Snapshot

    quantity: number; // Positive (IN) or Negative (OUT)
    unitCost: number; // Cost at time of transaction
    totalValue: number;

    // Links
    relatedDocId?: string; // OrderID, ImportID, ProductionRunID
    relatedDocCode?: string;

    performerId: string; // User ID
    performerName: string;
    status?: 'active' | 'canceled';
}

export interface SalesOrder {
    id: string;
    code: string;
    createdAt: Timestamp;
    deliveryDate: Timestamp;

    // Customer Snapshot
    customerId: string;
    customerName: string;
    customerPhone?: string;
    shippingAddress: string;

    status: 'open' | 'cooking' | 'delivering' | 'delivered' | 'completed' | 'canceled';
    paymentStatus: 'unpaid' | 'paid' | 'partial';

    items: SalesOrderItem[];

    // Financials
    subTotal: number;
    discountAmount: number;
    discountReason?: string;
    shippingFee: number;
    totalAmount: number; // Final receivable
    totalCost: number; // COGS

    createdBy: string;
}

export interface SalesOrderItem {
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number; // Selling price at that moment
    originalPrice: number; // Base price
    total: number;
    costPrice: number; // COGS at moment of sale
}

// --- FINANCE ---

export interface FinanceLedger {
    id: string;
    date: Timestamp;
    type: 'revenue' | 'expense';
    category: string; // 'Sales', 'COGS', 'Rent', 'Utilities'
    amount: number;
    description: string;
    relatedDocId?: string;
    recordedBy: string;
    status?: 'active' | 'canceled';
}
