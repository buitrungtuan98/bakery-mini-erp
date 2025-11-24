import { writable, type Writable } from 'svelte/store';
import { collection, onSnapshot, query, orderBy, type DocumentData } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { onDestroy } from 'svelte';

// --- Types ---
export interface Ingredient {
    id: string;
    code: string;
    name: string;
    baseUnit: string;
    currentStock: number;
    minStock: number;
    avgCost: number;
    manufacturerId: string;
    manufacturerName: string;
    createdAt?: any;
}

export interface Product {
    id: string;
    name: string;
    sellingPrice: number;
    items: any[];
    theoreticalCost: number;
    estimatedYieldQty: number;
    currentStock: number;
}

export interface Partner {
    id: string;
    name: string;
    type: 'supplier' | 'customer' | 'manufacturer';
    phone?: string;
    address?: string;
    customerType?: 'sỉ' | 'lẻ'; // Thêm trường này
    customPrices?: { productId: string; price: number; }[]; // Thêm trường này nếu cần
}

// --- Generic Store Creator ---
function createFirestoreStore<T>(collectionName: string, orderByField: string = 'name') {
    const { subscribe, set, update } = writable<T[]>([]);
    let unsubscribe: (() => void) | null = null;
    let loaded = false;

    return {
        subscribe,
        init: () => {
            if (loaded && unsubscribe) return; // Đã load rồi thì không load lại

            console.log(`[Store] Initializing subscription for ${collectionName}...`);
            const q = query(collection(db, collectionName), orderBy(orderByField));

            unsubscribe = onSnapshot(q, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
                set(data);
                loaded = true;
                console.log(`[Store] Loaded ${data.length} items from ${collectionName}.`);
            }, (error) => {
                console.error(`[Store] Error loading ${collectionName}:`, error);
            });
        },
        reset: () => {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            set([]);
            loaded = false;
        }
    };
}

// --- Exported Stores ---
// Singleton instances - Dữ liệu sẽ được cache trong RAM suốt phiên làm việc
export const ingredientStore = createFirestoreStore<Ingredient>('ingredients', 'code');
export const productStore = createFirestoreStore<Product>('products', 'name');
export const partnerStore = createFirestoreStore<Partner>('partners', 'name');

// --- Helper để init tất cả (dùng ở layout) ---
export function initMasterData() {
    ingredientStore.init();
    productStore.init();
    partnerStore.init();
}
