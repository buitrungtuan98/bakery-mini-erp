import { writable } from 'svelte/store';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '$lib/firebase';
import type { MasterIngredient, MasterProduct, MasterPartner } from '$lib/types/erp';

// --- Generic Store Creator ---
function createFirestoreStore<T>(collectionName: string, orderByField: string = 'name') {
    const { subscribe, set } = writable<T[]>([]);
    const loading = writable<boolean>(true);

    let unsubscribe: (() => void) | null = null;
    let loaded = false;

    return {
        subscribe,
        loading: { subscribe: loading.subscribe },
        init: () => {
            if (loaded && unsubscribe) return;

            loading.set(true);
            const q = query(collection(db, collectionName), orderBy(orderByField));

            unsubscribe = onSnapshot(q, (snapshot) => {
                const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as T));
                set(data);
                loaded = true;
                loading.set(false);
            }, (error) => {
                console.error(`[Store] Error loading ${collectionName}:`, error);
                loading.set(false);
            });
        },
        reset: () => {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            set([]);
            loading.set(true);
            loaded = false;
        }
    };
}

// --- Exported Stores (Updated to New Schema) ---
// Note: We use the *New* collection names here.
// Since this is a "Fresh Start", these will be empty initially.

export const ingredientStore = createFirestoreStore<MasterIngredient>('master_ingredients', 'code'); // Order by Code usually better for ingredients
export const productStore = createFirestoreStore<MasterProduct>('master_products', 'name');
export const partnerStore = createFirestoreStore<MasterPartner>('master_partners', 'name');

// Legacy Type Exports for compatibility during transition (Alias to new types)
export type Ingredient = MasterIngredient;
export type Product = MasterProduct;
export type Partner = MasterPartner;

export function initMasterData() {
    ingredientStore.init();
    productStore.init();
    partnerStore.init();
}
